import {useEffect, useMemo, useState} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import {DangerButton} from "../../components/DangerButton"
import {EmptyState} from "../../components/EmptyState"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {StatusPill} from "../../components/StatusPill"
import {TextArea} from "../../components/TextArea"
import {useConfirm} from "../../components/useConfirm"
import {accountType} from "../../lib/accountType.ts"
import {emptyToNull} from "../../lib/emptyToNull"
import {formatDate} from "../../lib/formatDate.ts"
import {formatNumber} from "../../lib/formatNumber.ts"
import {moneyFromCents} from "../../lib/moneyFromCents.ts"
import {requiredNumber} from "../../lib/requiredNumber"
import {useOnlineUsersWatcher} from "../../lib/useOnlineUsersWatcher.ts"

import styles from "./UsersAdmin.module.css"
import {
  useAdjustWalletMutation,
  useGetUserDetailQuery,
  useGetUsersQuery,
  useHardDeleteUsersMutation,
  useSoftDeleteUsersMutation,
  useToggleSuspensionMutation,
  useUpdateProfileMutation,
} from "./UsersApi"
import type {AdminUser, ProfileDraft, WalletDraft} from "./UsersData"

type Props = {
  readonly canManage: boolean,
  readonly currentUserId: string | null,
  /** Owned by Admin.tsx: the RTP Analytics deep link writes it, so the
   *  selection must survive section navigation. The feature reports its
   *  own row clicks / delete-clears back through onSelectedUserIdChange. */
  readonly selectedUserId: string | null,
  readonly onSelectedUserIdChange: (profileId: string | null) => void,
  readonly onError: (err: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Users BO admin — the live user directory + per-user inspector.
 * Owns the user-list query (with attached wallets), the per-selection
 * inspector query, the online presence widget, and all drafts/selection
 * helpers. The selection itself (selectedUserId) lives in Admin.tsx so
 * the RTP Analytics deep link can jump here with a user pre-selected.
 */
export function UsersAdmin({
  canManage,
  currentUserId,
  selectedUserId,
  onSelectedUserIdChange,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: users = [],
    error: usersError,
  } = useGetUsersQuery()
  // Effective selection: the deep-linked id when it's still in the
  // (latest-120) list, otherwise the newest user — matches the old
  // loadAdminData restore, which fell back to the first row.
  const selectedUser = users.find((row) => row.id === selectedUserId) ?? users[0] ?? null
  const {
    data: selectedUserDetail,
    error: detailError,
  } = useGetUserDetailQuery(selectedUser?.id ?? skipToken)

  // Read failures surface through the page-level banner: a failed query
  // otherwise falls back to its default and renders as empty data,
  // indistinguishable from a genuinely empty directory.
  useEffect(() => {
    if (usersError) onError(usersError)
    else if (detailError) onError(detailError)
  }, [usersError, detailError, onError])
  const onlineUsers = useOnlineUsersWatcher(true)
  // Non-blocking confirm/prompt dialogs for the two delete flows.
  // Separate hook instance from Admin.tsx's (which still serves Shop).
  const {
    confirm,
    prompt,
    confirmUI,
  } = useConfirm()
  const [checkedUserIds, setCheckedUserIds] = useState<Set<string>>(() => new Set())
  const [userSearch, setUserSearch] = useState("")
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    level: "1",
    xp: "0",
    rating: "1500",
    admin_note: "",
    suspension_reason: "",
  })
  const [walletDraft, setWalletDraft] = useState<WalletDraft>({
    currency: "coins",
    amount: "",
    reason: "",
  })
  // Per-action busy flag, mirroring the old shared savingKey values.
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [updateProfile] = useUpdateProfileMutation()
  const [toggleSuspension] = useToggleSuspensionMutation()
  const [adjustWallet] = useAdjustWalletMutation()
  const [softDeleteUsers] = useSoftDeleteUsersMutation()
  const [hardDeleteUsers] = useHardDeleteUsersMutation()

  // Form drafts mirror the selected row. The old code re-seeded the
  // drafts after every save/refresh from the freshly loaded row, so a
  // successful save (or a refetch) resets mid-edit input.
  useEffect(() => {
    if (!selectedUser) return
    setProfileDraft({
      level: selectedUser.level.toString(),
      xp: selectedUser.xp.toString(),
      rating: selectedUser.rating.toString(),
      admin_note: selectedUser.admin_note ?? "",
      suspension_reason: selectedUser.suspension_reason ?? "",
    })
  }, [selectedUser])

  // Keep checked ids limited to the visible list, as the old
  // loadAdminData prune did after every refresh.
  useEffect(() => {
    setCheckedUserIds((current) => {
      const visibleIds = new Set(users.map((row) => row.id))
      const next = new Set([...current].filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [users])

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return users
    return users.filter((row) => [row.display_name, row.id, row.rating.toString(), row.level.toString(), accountType(row)]
      .join(" ")
      .toLowerCase()
      .includes(query))
  }, [userSearch, users])

  const selectableFilteredUserIds = filteredUsers
    .filter((row) => row.id !== currentUserId)
    .map((row) => row.id)
  const checkedUserCount = checkedUserIds.size
  const allFilteredUsersChecked = selectableFilteredUserIds.length > 0 && selectableFilteredUserIds.every((id) => checkedUserIds.has(id))

  function selectUser(nextUser: AdminUser) {
    onSelectedUserIdChange(nextUser.id)
  }

  function toggleCheckedUser(profileId: string, checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current)
      if (checked) next.add(profileId); else next.delete(profileId)
      return next
    })
  }

  function toggleAllFilteredUsers(checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current)
      for (const profileId of selectableFilteredUserIds) {
        if (checked) next.add(profileId); else next.delete(profileId)
      }
      return next
    })
  }

  async function handleHardDelete(profileIds: string[]) {
    if (!canManage) return
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== currentUserId)
    if (uniqueIds.length === 0) {
      onError("Select at least one user that is not your current admin profile.")
      return
    }

    const confirmed = await confirm({
      title: `Hard delete ${uniqueIds.length === 1 ? "this user" : `${uniqueIds.length} users`}?`,
      message: "This is IRREVERSIBLE — the auth.users row is removed and all related " + "wallet / inventory / match data is cascade-deleted from the database.\n\n" + "Type DELETE to confirm.",
      requireWord: "DELETE",
      confirmLabel: "Hard delete",
      tone: "danger",
    })
    if (!confirmed) return

    setPendingKey("user-delete")
    onBeforeSave()
    try {
      await hardDeleteUsers(uniqueIds).unwrap()
      setCheckedUserIds(new Set())
      if (selectedUser && uniqueIds.includes(selectedUser.id)) {
        onSelectedUserIdChange(null)
      }
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function handleSoftDelete(profileIds: string[]) {
    if (!canManage) return
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== currentUserId)
    if (uniqueIds.length === 0) {
      onError("Select at least one user that is not your current admin profile.")
      return
    }

    const note = await prompt({
      title: `Delete ${uniqueIds.length === 1 ? "this user" : `${uniqueIds.length} users`}?`,
      message: "They will be removed from the live user list, but their data remains " + "recoverable in the database. Add an optional note for the audit trail:",
      defaultValue: "Back Office soft delete",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (note === null) return

    setPendingKey("user-delete")
    onBeforeSave()
    try {
      await softDeleteUsers({
        profileIds: uniqueIds,
        note,
        deletedBy: currentUserId,
      }).unwrap()
      setCheckedUserIds(new Set())
      if (selectedUser && uniqueIds.includes(selectedUser.id)) {
        onSelectedUserIdChange(null)
      }
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function saveProfile() {
    if (!canManage || !selectedUser) return
    setPendingKey("profile")
    onBeforeSave()
    try {
      await updateProfile({
        userId: selectedUser.id,
        payload: {
          level: requiredNumber(profileDraft.level, "Level"),
          xp: requiredNumber(profileDraft.xp, "XP"),
          rating: requiredNumber(profileDraft.rating, "Rating"),
          admin_note: emptyToNull(profileDraft.admin_note),
          suspension_reason: selectedUser.is_suspended ? emptyToNull(profileDraft.suspension_reason) : null,
          suspended_at: selectedUser.is_suspended ? (selectedUser.suspended_at ?? new Date().toISOString()) : null,
        },
      }).unwrap()
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function toggleSuspensionFor(target: AdminUser) {
    if (!canManage) return
    setPendingKey(`suspend-${target.id}`)
    onBeforeSave()
    try {
      const next = !target.is_suspended
      await toggleSuspension({
        targetProfileId: target.id,
        isSuspended: next,
        suspensionReason: next ? emptyToNull(profileDraft.suspension_reason) ?? "Admin suspension" : null,
      }).unwrap()
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function applyWalletChange() {
    if (!canManage || !selectedUser) return
    setPendingKey("wallet")
    onBeforeSave()
    try {
      const amount = requiredNumber(walletDraft.amount, "Amount")
      await adjustWallet({
        targetProfileId: selectedUser.id,
        currencyCode: walletDraft.currency,
        deltaAmount: amount,
        adjustmentReason: walletDraft.reason,
      }).unwrap()
      setWalletDraft({
        currency: "coins",
        amount: "",
        reason: "",
      })
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  return (<div className={styles.layout}>
    {confirmUI}
    <div className={styles.panel}>
      {/* Live online users widget. The dot pulses to make
            * "live" obvious; counts come straight from the
            * Realtime presence channel so the moment a player
            * closes their tab the WebSocket drops and the
            * count ticks down within a few seconds. */}
      <div className={styles.onlineWidget}>
        <div className={styles.onlineLabel}>
          <span className={styles.pulseWrap}>
            <span className={styles.ping}/>
            <span className={styles.dot}/>
          </span>
          <span className={styles.onlineLabelText}>
            Live online
          </span>
        </div>
        <div className={styles.countGroup}>
          <span className={styles.countNumber}>
            {onlineUsers.total}
          </span>
          <span className={styles.countUnit}>total</span>
        </div>
        <div className={styles.countGroupBordered}>
          <span className={styles.countNumberSecondary}>
            {onlineUsers.registered}
          </span>
          <span className={styles.countUnit}>registered</span>
        </div>
        <div className={styles.countGroupBordered}>
          <span className={styles.countNumberSecondary}>
            {onlineUsers.guests}
          </span>
          <span className={styles.countUnit}>guests</span>
        </div>
      </div>
      <div className={styles.searchHeader}>
        <h2 className={styles.sectionTitle}>Users</h2>
        <input
          className={styles.searchInput}
          placeholder="Search name, id, level, rating"
          value={userSearch}
          onChange={(event) => {
            setUserSearch(event.target.value)
          }}/>
      </div>
      <div className={styles.selectionBar}>
        <span>
          {checkedUserCount > 0 ? `${checkedUserCount} selected` : `${filteredUsers.length} live users shown`}
        </span>
        <div className={styles.selectionActions}>
          <DangerButton
            disabled={!canManage || checkedUserCount === 0 || pendingKey === "user-delete"}
            onClick={() => {
              void handleSoftDelete([...checkedUserIds])
            }}>
            Delete selected
          </DangerButton>
          {/* Hard delete — purges auth.users + cascades. Used to
                  clear shell/test users that pile up during dev.
                  Type-DELETE confirm is inside hardDeleteUsers. */}
          <DangerButton
            disabled={!canManage || checkedUserCount === 0 || pendingKey === "user-delete"}
            onClick={() => {
              void handleHardDelete([...checkedUserIds])
            }}>
            Hard delete (irreversible)
          </DangerButton>
        </div>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              <th className={styles.th}>
                <input
                  aria-label="Select all visible users"
                  checked={allFilteredUsersChecked}
                  className={styles.checkbox}
                  disabled={selectableFilteredUserIds.length === 0}
                  type="checkbox"
                  onChange={(event) => {
                    toggleAllFilteredUsers(event.target.checked)
                  }}/>
              </th>
              <th className={styles.th}>Player</th>
              <th className={styles.th}>Account</th>
              <th className={styles.th}>Level</th>
              <th className={styles.th}>Wallet</th>
              <th className={styles.th}>Rating</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((row) => (<tr
              key={row.id}
              className={`${styles.row} ${row.id === selectedUser?.id ? styles.rowSelected : ""}`}
              onClick={() => {
                selectUser(row)
              }}>
              <td className={styles.td}>
                <input
                  aria-label={`Select ${row.display_name}`}
                  checked={checkedUserIds.has(row.id)}
                  className={styles.checkbox}
                  disabled={row.id === currentUserId}
                  type="checkbox"
                  onChange={(event) => {
                    toggleCheckedUser(row.id, event.target.checked)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                  }}/>
              </td>
              <td className={styles.td}>
                <div className={styles.playerName}>{row.display_name}</div>
                <div className={styles.playerId}>{row.id}</div>
              </td>
              <td className={styles.td}>{accountType(row)}</td>
              <td className={styles.td}>L{row.level} · {formatNumber(row.xp)} XP</td>
              <td className={styles.td}>
                {formatNumber(row.wallet?.coins)} coins · {formatNumber(row.wallet?.gems)} gems
              </td>
              <td className={styles.td}>{formatNumber(row.rating)}</td>
              <td className={styles.td}>
                {row.is_suspended ? <StatusPill enabled={false}/> : <StatusPill enabled/>}
              </td>
              <td className={styles.td}>
                <div className={styles.rowActions}>
                  <button
                    className={styles.rowDelete}
                    disabled={!canManage || row.id === currentUserId || pendingKey === "user-delete"}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleSoftDelete([row.id])
                    }}>
                    Delete
                  </button>
                  <button
                    className={styles.rowHard}
                    disabled={!canManage || row.id === currentUserId || pendingKey === "user-delete"}
                    title="Hard delete (irreversible)"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleHardDelete([row.id])
                    }}>
                    Hard
                  </button>
                </div>
              </td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>

    <div className={styles.rightColumn}>
      {!selectedUser ? (<EmptyState
        text="Select a user to inspect their profile, wallet, inventory, and match history."/>) : (<>
        <div className={styles.panel}>
          <div className={styles.inspectorHeader}>
            <div>
              <h2 className={styles.inspectorName}>{selectedUser.display_name}</h2>
              <div className={styles.inspectorAccount}>
                {accountType(selectedUser)}
              </div>
              <div className={styles.inspectorId}>{selectedUser.id}</div>
            </div>
            <div className={styles.inspectorActions}>
              <StatusPill enabled={!selectedUser.is_suspended}/>
              <DangerButton
                disabled={!canManage || selectedUser.id === currentUserId || pendingKey === "user-delete"}
                onClick={() => {
                  void handleSoftDelete([selectedUser.id])
                }}>
                Delete user
              </DangerButton>
              <DangerButton
                disabled={!canManage || selectedUser.id === currentUserId || pendingKey === "user-delete"}
                onClick={() => {
                  void handleHardDelete([selectedUser.id])
                }}>
                Hard delete (irreversible)
              </DangerButton>
            </div>
          </div>
          <div className={styles.statGrid}>
            <div className={styles.statCell}>
              <div className={styles.statLabel}>Coins</div>
              <div className={styles.statValue}>{formatNumber(selectedUserDetail?.wallet?.coins)}</div>
            </div>
            <div className={styles.statCell}>
              <div className={styles.statLabel}>Gems</div>
              <div className={styles.statValue}>{formatNumber(selectedUserDetail?.wallet?.gems)}</div>
            </div>
            <div className={styles.statCell}>
              <div className={styles.statLabel}>Created</div>
              <div className={styles.statValue}>{formatDate(selectedUser.created_at)}</div>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Profile controls</h3>
          <div className={styles.fieldGrid3}>
            <Field
              label="Level"
              value={profileDraft.level}
              onChange={(level) => {
                setProfileDraft((d) => ({...d, level}))
              }}/>
            <Field
              label="XP"
              value={profileDraft.xp}
              onChange={(xp) => {
                setProfileDraft((d) => ({...d, xp}))
              }}/>
            <Field
              label="Rating"
              value={profileDraft.rating}
              onChange={(rating) => {
                setProfileDraft((d) => ({...d, rating}))
              }}/>
          </div>
          <div className={styles.mt3}>
            <TextArea
              label="Admin note"
              rows={3}
              value={profileDraft.admin_note}
              onChange={(admin_note) => {
                setProfileDraft((d) => ({...d, admin_note}))
              }}/>
          </div>
          <div className={styles.mt3}>
            <TextArea
              label="Suspension reason"
              rows={2}
              value={profileDraft.suspension_reason}
              onChange={(suspension_reason) => {
                setProfileDraft((d) => ({...d, suspension_reason}))
              }}/>
          </div>
          <div className={styles.actions}>
            <PrimaryButton
              disabled={!canManage || pendingKey === "profile"}
              onClick={() => {
                void saveProfile()
              }}>
              Save profile
            </PrimaryButton>
            <SecondaryButton
              disabled={!canManage}
              onClick={() => {
                void toggleSuspensionFor(selectedUser)
              }}>
              {selectedUser.is_suspended ? "Unsuspend" : "Suspend"}
            </SecondaryButton>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Grant / remove currency</h3>
          <div className={styles.walletGrid}>
            <select
              className={styles.select}
              value={walletDraft.currency}
              onChange={(event) => {
                setWalletDraft((d) => ({...d, currency: event.target.value}))
              }}>
              <option value="coins">Coins</option>
              <option value="gems">Gems</option>
            </select>
            <Field
              label="Amount (+ or -)"
              value={walletDraft.amount}
              onChange={(amount) => {
                setWalletDraft((d) => ({...d, amount}))
              }}/>
          </div>
          <div className={styles.mt3}>
            <Field
              label="Reason"
              value={walletDraft.reason}
              onChange={(reason) => {
                setWalletDraft((d) => ({...d, reason}))
              }}/>
          </div>
          <div className={styles.mt3}>
            <PrimaryButton
              disabled={!canManage || pendingKey === "wallet"}
              onClick={() => {
                void applyWalletChange()
              }}>
              Apply wallet change
            </PrimaryButton>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Inventory</h3>
          <div className={styles.chipWrap}>
            {selectedUserDetail?.boards.length ? (selectedUserDetail.boards.map((item) => (
              <span
                key={item.board_theme_id}
                className={styles.chip}>
                {item.board_theme_id} · {item.source}
              </span>))) : (<div className={styles.emptyText}>No owned boards.</div>)}
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Wallet ledger</h3>
          <div className={styles.list}>
            {selectedUserDetail?.transactions.length ? (selectedUserDetail.transactions.map((tx) => (
              <div
                key={tx.id}
                className={styles.listItem}>
                <div className={styles.itemTitle}>
                  {tx.amount > 0 ? "+" : ""}{formatNumber(tx.amount)} {tx.currency}
                </div>
                <div>{tx.reason}</div>
                <div
                  className={styles.itemSub}>After: {formatNumber(tx.balance_after)} · {formatDate(tx.created_at)}</div>
              </div>))) : (<div className={styles.emptyText}>No wallet transactions yet.</div>)}
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Purchases</h3>
          <div className={styles.list}>
            {selectedUserDetail?.purchases.length ? (selectedUserDetail.purchases.map((purchase) => (
              <div
                key={purchase.id}
                className={styles.listItem}>
                <div className={styles.itemTitle}>{purchase.product_id}</div>
                <div>{purchase.product_type} · {purchase.provider} · {purchase.status}</div>
                <div
                  className={styles.itemSub}>{moneyFromCents(purchase.price_cents)} · {formatDate(purchase.created_at)}</div>
              </div>))) : (<div className={styles.emptyText}>No purchases yet.</div>)}
          </div>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.subTitle}>Match history</h3>
          <div className={styles.list}>
            {selectedUserDetail?.matches.length ? (selectedUserDetail.matches.map((match) => (
              <div
                key={match.id}
                className={styles.listItem}>
                <div className={styles.itemTitle}>{match.mode} · to {match.target}</div>
                <div>Score {match.white_score}-{match.black_score} · winner {match.winner ?? "open"}</div>
                <div className={styles.itemSub}>{formatDate(match.started_at)}</div>
              </div>))) : (<div className={styles.emptyText}>No matches yet.</div>)}
          </div>
        </div>
      </>)}
    </div>
  </div>)
}
