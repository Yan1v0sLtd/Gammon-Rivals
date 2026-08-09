import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {DangerButton} from "../../components/DangerButton"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {formatDate} from "../../lib/formatDate"

type AdminRoleRow = Database["public"]["Tables"]["admin_roles"]["Row"]
type AdminEmailRoleRow = Database["public"]["Tables"]["admin_email_allowlist"]["Row"]
type AdminRole = AdminRoleRow["role"]
type AuditEntry = Database["public"]["Tables"]["admin_audit_log"]["Row"]

type RoleDraft = {
  profile_id: string, role: AdminRole, note: string,
}

type EmailRoleDraft = {
  email: string, role: AdminRole, note: string,
}

type Props = {
  readonly adminEmailRoles: readonly AdminEmailRoleRow[],
  readonly adminRoles: readonly AdminRoleRow[],
  readonly audit: readonly AuditEntry[],
  readonly emailRoleDraft: EmailRoleDraft,
  readonly roleDraft: RoleDraft,
  readonly roleOptions: readonly AdminRole[],
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly selectedEmailRole: AdminEmailRoleRow | null,
  readonly currentUserEmail: string,
  readonly onEmailRoleDraftChange: (draft: EmailRoleDraft) => void,
  readonly onRoleDraftChange: (draft: RoleDraft) => void,
  readonly onSaveAdminEmailRole: () => void,
  readonly onSaveAdminRole: () => void,
  readonly onDeleteAdminEmailRole: (row: AdminEmailRoleRow) => void,
}

/**
 * Admin Access BO — the operator allowlist + role management panels.
 * Purely presentational: it renders the admin email / role tables, the
 * audit log, and the grant forms from data the parent (Admin) already
 * owns. No data fetching here.
 */
export function AdminAccessAdmin({
  adminEmailRoles,
  adminRoles,
  audit,
  emailRoleDraft,
  roleDraft,
  roleOptions,
  canManage,
  savingKey,
  selectedEmailRole,
  currentUserEmail,
  onEmailRoleDraftChange,
  onRoleDraftChange,
  onSaveAdminEmailRole,
  onSaveAdminRole,
  onDeleteAdminEmailRole,
}: Props) {
  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <div className="space-y-4">
      <ConfigTable
        rows={adminEmailRoles.map((row) => [row.email, row.role, row.note ?? "", formatDate(row.created_at)])}
        title="Admin emails"
        onRowClick={(index) => {
          onEmailRoleDraftChange({
            email: adminEmailRoles[index].email,
            role: adminEmailRoles[index].role,
            note: adminEmailRoles[index].note ?? "",
          })
        }}/>
      <ConfigTable
        rows={adminRoles.map((row) => [row.profile_id, row.role, row.note ?? "", formatDate(row.created_at)])}
        title="Admin roles"
        onRowClick={(index) => {
          onRoleDraftChange({
            profile_id: adminRoles[index].profile_id,
            role: adminRoles[index].role,
            note: adminRoles[index].note ?? "",
          })
        }}/>
      <ConfigTable
        rows={audit.map((entry) => [formatDate(entry.created_at), entry.action, `${entry.entity_table} · ${entry.entity_id}`, entry.actor_profile_id ?? "system"])}
        title="Audit log"/>
    </div>
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Grant admin email</h2>
        <div className="mt-3 space-y-3">
          <Field
            label="Email"
            value={emailRoleDraft.email}
            onChange={(email) => {
              onEmailRoleDraftChange({
                ...emailRoleDraft,
                email,
              })
            }}/>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
            Role
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
              value={emailRoleDraft.role}
              onChange={(event) => {
                onEmailRoleDraftChange({
                  ...emailRoleDraft,
                  role: event.target.value as AdminRole,
                })
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
              onEmailRoleDraftChange({
                ...emailRoleDraft,
                note,
              })
            }}/>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton
              disabled={!canManage || savingKey === "email-role"}
              onClick={onSaveAdminEmailRole}>
              Save email
            </PrimaryButton>
            <SecondaryButton onClick={() => {
              onEmailRoleDraftChange({
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
                if (selectedEmailRole) onDeleteAdminEmailRole(selectedEmailRole)
              }}>
              Remove
            </DangerButton>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Grant profile role</h2>
        <div className="mt-3 space-y-3">
          <Field
            label="Profile id"
            value={roleDraft.profile_id}
            onChange={(profile_id) => {
              onRoleDraftChange({
                ...roleDraft,
                profile_id,
              })
            }}/>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
            Role
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
              value={roleDraft.role}
              onChange={(event) => {
                onRoleDraftChange({
                  ...roleDraft,
                  role: event.target.value as AdminRole,
                })
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
              onRoleDraftChange({
                ...roleDraft,
                note,
              })
            }}/>
          <PrimaryButton
            disabled={!canManage || savingKey === "role"}
            onClick={onSaveAdminRole}>
            Save role
          </PrimaryButton>
        </div>
      </div>
    </div>
  </div>)
}
