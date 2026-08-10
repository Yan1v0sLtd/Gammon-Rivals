import {useEffect, useState} from "react"

import {ConfigTable} from "../../components/ConfigTable"
import {DangerButton} from "../../components/DangerButton"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {useConfirm} from "../../components/useConfirm"
import {emptyToNull} from "../../lib/emptyToNull"
import {formatDate} from "../../lib/formatDate"
import {normalizeEmail} from "../../lib/normalizeEmail"

import styles from "./AdminAccessAdmin.module.css"
import {
  useDeleteAdminEmailRoleMutation,
  useGetAdminEmailRolesQuery,
  useGetAdminRolesQuery,
  useGetAuditLogQuery,
  useUpsertAdminEmailRoleMutation,
  useUpsertAdminRoleMutation,
} from "./AdminAccessApi"
import type {AdminEmailRoleRow, AdminRole} from "./AdminAccessData"

type RoleDraft = {
  profile_id: string,
  role: AdminRole,
  note: string,
}

type EmailRoleDraft = {
  email: string,
  role: AdminRole,
  note: string,
}

type Props = {
  readonly canManage: boolean,
  readonly currentUserId: string | null,
  readonly currentUserEmail: string,
  readonly roleOptions: readonly AdminRole[],
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Admin Access BO — the operator allowlist + role management panels.
 * Owns its own data: it fetches the admin email / role tables and the
 * audit log via RTK Query, keeps the grant drafts in local state, and
 * saves through the Admin Access mutations (whose `AdminAccess` tag
 * invalidation refetches all three queries together — the database
 * triggers also append audit rows on role/allowlist writes). Query and
 * mutation failures are reported up through `onError` for page-level
 * display. No direct Supabase calls here.
 */
export function AdminAccessAdmin({
  canManage,
  currentUserId,
  currentUserEmail,
  roleOptions,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: adminEmailRoles = [],
    error: emailRolesError,
    isLoading: emailRolesLoading,
  } = useGetAdminEmailRolesQuery()
  const {
    data: adminRoles = [],
    error: adminRolesError,
    isLoading: adminRolesLoading,
  } = useGetAdminRolesQuery()
  const {
    data: audit = [],
    error: auditError,
    isLoading: auditLoading,
  } = useGetAuditLogQuery()

  const [upsertAdminRole] = useUpsertAdminRoleMutation()
  const [upsertAdminEmailRole] = useUpsertAdminEmailRoleMutation()
  const [deleteAdminEmailRole] = useDeleteAdminEmailRoleMutation()

  const [roleDraft, setRoleDraft] = useState<RoleDraft>({
    profile_id: "",
    role: "viewer",
    note: "",
  })
  const [emailRoleDraft, setEmailRoleDraft] = useState<EmailRoleDraft>({
    email: "contact@yanivos.com",
    role: "owner",
    note: "Initial owner email",
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const {
    confirm,
    confirmUI,
  } = useConfirm()

  // Surface fetch failures through the page-level error reporter so a
  // failed query is never silently rendered as an empty table.
  useEffect(() => {
    if (emailRolesError) onError(emailRolesError)
  }, [emailRolesError, onError])
  useEffect(() => {
    if (adminRolesError) onError(adminRolesError)
  }, [adminRolesError, onError])
  useEffect(() => {
    if (auditError) onError(auditError)
  }, [auditError, onError])

  const selectedEmailRole = adminEmailRoles.find((row) => row.email === normalizeEmail(emailRoleDraft.email)) ?? null

  async function saveAdminRole() {
    if (!canManage) return
    setSavingKey("role")
    // Clear any stale page-level error before the save, mirroring the old
    // Admin handler's setDataError(null) so a fresh save doesn't leave a
    // previous failure on screen.
    onBeforeSave()
    try {
      await upsertAdminRole({
        profile_id: roleDraft.profile_id.trim(),
        role: roleDraft.role,
        note: emptyToNull(roleDraft.note),
        created_by: currentUserId,
      }).unwrap()
      setRoleDraft({
        profile_id: "",
        role: "viewer",
        note: "",
      })
    }
    catch (err) {
      onError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function saveAdminEmailRole() {
    if (!canManage) return
    const email = normalizeEmail(emailRoleDraft.email)
    if (!email.includes("@")) {
      onError("Enter a valid email address.")
      return
    }
    setSavingKey("email-role")
    onBeforeSave()
    try {
      await upsertAdminEmailRole({
        email,
        role: emailRoleDraft.role,
        note: emptyToNull(emailRoleDraft.note),
        created_by: currentUserId,
      }).unwrap()
      setEmailRoleDraft({
        email: "",
        role: "viewer",
        note: "",
      })
    }
    catch (err) {
      onError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  async function deleteEmailRole(row: AdminEmailRoleRow) {
    if (!canManage) return
    if (row.email === currentUserEmail) {
      onError("You can't remove the admin email you are currently using.")
      return
    }
    const confirmed = await confirm({
      title: `Remove admin access for ${row.email}?`,
      confirmLabel: "Remove access",
      tone: "danger",
    })
    if (!confirmed) return

    setSavingKey(`email-role-delete-${row.email}`)
    onBeforeSave()
    try {
      await deleteAdminEmailRole(row.email).unwrap()
      setEmailRoleDraft({
        email: "",
        role: "viewer",
        note: "",
      })
    }
    catch (err) {
      onError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  const initialLoading = adminRolesLoading || emailRolesLoading || auditLoading

  return (<>
    {confirmUI}
    {initialLoading ? (<div
      className={styles.loadingCard}>
      Loading…
    </div>) : (<div className={styles.layout}>
      <div className={styles.column}>
        <ConfigTable
          rows={adminEmailRoles.map((row) => [row.email, row.role, row.note ?? "", formatDate(row.created_at)])}
          title="Admin emails"
          onRowClick={(index) => {
            setEmailRoleDraft({
              email: adminEmailRoles[index].email,
              role: adminEmailRoles[index].role,
              note: adminEmailRoles[index].note ?? "",
            })
          }}/>
        <ConfigTable
          rows={adminRoles.map((row) => [row.profile_id, row.role, row.note ?? "", formatDate(row.created_at)])}
          title="Admin roles"
          onRowClick={(index) => {
            setRoleDraft({
              profile_id: adminRoles[index].profile_id,
              role: adminRoles[index].role,
              note: adminRoles[index].note ?? "",
            })
          }}/>
        <ConfigTable
          rows={audit.map((entry) => [formatDate(entry.created_at), entry.action, `${entry.entity_table} · ${entry.entity_id}`, entry.actor_profile_id ?? "system"])}
          title="Audit log"/>
      </div>
      <div className={styles.column}>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Grant admin email</h2>
          <div className={styles.panelBody}>
            <Field
              label="Email"
              value={emailRoleDraft.email}
              onChange={(email) => {
                setEmailRoleDraft((d) => ({
                  ...d,
                  email,
                }))
              }}/>
            <label className={styles.roleLabel}>
              Role
              <select
                className={styles.roleSelect}
                value={emailRoleDraft.role}
                onChange={(event) => {
                  setEmailRoleDraft((d) => ({
                    ...d,
                    role: event.target.value as AdminRole,
                  }))
                }}>
                {roleOptions.map((option) => (<option
                  key={option}
                  value={option}>{option}</option>))}
              </select>
            </label>
            <Field
              label="Note"
              value={emailRoleDraft.note}
              onChange={(note) => {
                setEmailRoleDraft((d) => ({
                  ...d,
                  note,
                }))
              }}/>
            <div className={styles.buttonRow}>
              <PrimaryButton
                disabled={!canManage || savingKey === "email-role"}
                onClick={() => {
                  void saveAdminEmailRole()
                }}>
                Save email
              </PrimaryButton>
              <SecondaryButton onClick={() => {
                setEmailRoleDraft({
                  email: "",
                  role: "viewer",
                  note: "",
                })
              }}>
                New
              </SecondaryButton>
              <DangerButton
                disabled={!canManage || !selectedEmailRole || selectedEmailRole.email === currentUserEmail || savingKey === `email-role-delete-${selectedEmailRole?.email ?? ""}`}
                onClick={() => {
                  if (selectedEmailRole) void deleteEmailRole(selectedEmailRole)
                }}>
                Remove
              </DangerButton>
            </div>
          </div>
        </div>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Grant profile role</h2>
          <div className={styles.panelBody}>
            <Field
              label="Profile id"
              value={roleDraft.profile_id}
              onChange={(profile_id) => {
                setRoleDraft((d) => ({
                  ...d,
                  profile_id,
                }))
              }}/>
            <label className={styles.roleLabel}>
              Role
              <select
                className={styles.roleSelect}
                value={roleDraft.role}
                onChange={(event) => {
                  setRoleDraft((d) => ({
                    ...d,
                    role: event.target.value as AdminRole,
                  }))
                }}>
                {roleOptions.map((option) => (<option
                  key={option}
                  value={option}>{option}</option>))}
              </select>
            </label>
            <Field
              label="Note"
              value={roleDraft.note}
              onChange={(note) => {
                setRoleDraft((d) => ({
                  ...d,
                  note,
                }))
              }}/>
            <PrimaryButton
              disabled={!canManage || savingKey === "role"}
              onClick={() => {
                void saveAdminRole()
              }}>
              Save role
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>)}
  </>)
}
