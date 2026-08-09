import type {Database} from "../../../../../packages/shared/src/database"
import {DangerButton} from "../../components/DangerButton"
import {EmptyState} from "../../components/EmptyState"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {StatusPill} from "../../components/StatusPill"
import {TextArea} from "../../components/TextArea"
import {accountType} from "../../lib/accountType.ts"
import {formatDate} from "../../lib/formatDate.ts"
import {formatNumber} from "../../lib/formatNumber.ts"
import {moneyFromCents} from "../../lib/moneyFromCents.ts"
import type {OnlineUserCounts} from "../../lib/useOnlineUsersWatcher.ts"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
type UserWallet = Database["public"]["Tables"]["user_wallets"]["Row"]
type WalletTransaction = Database["public"]["Tables"]["wallet_transactions"]["Row"]
type UserBoardInventory = Database["public"]["Tables"]["user_board_inventory"]["Row"]
type Purchase = Database["public"]["Tables"]["purchases"]["Row"]

type AdminUser = {
  wallet?: UserWallet,
} & ProfileRow

type UserDetail = {
  wallet: UserWallet | null,
  transactions: WalletTransaction[],
  boards: UserBoardInventory[],
  purchases: Purchase[],
  matches: Database["public"]["Tables"]["matches"]["Row"][],
}

type ProfileDraft = {
  level: string, xp: string, rating: string, admin_note: string, suspension_reason: string,
}

type WalletDraft = {
  currency: string, amount: string, reason: string,
}

type Props = {
  readonly onlineUsers: OnlineUserCounts,
  readonly userSearch: string,
  readonly checkedUserCount: number,
  readonly filteredUsers: readonly AdminUser[],
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly checkedUserIds: ReadonlySet<string>,
  readonly allFilteredUsersChecked: boolean,
  readonly selectableFilteredUserIds: readonly string[],
  readonly selectedUserId: string | null,
  readonly currentUserId: string | null,
  readonly selectedUser: AdminUser | null,
  readonly selectedUserDetail: UserDetail | null,
  readonly profileDraft: ProfileDraft,
  readonly walletDraft: WalletDraft,
  readonly onUserSearchChange: (value: string) => void,
  readonly onSoftDelete: (profileIds: string[]) => void,
  readonly onHardDelete: (profileIds: string[]) => void,
  readonly onToggleAllFiltered: (checked: boolean) => void,
  readonly onSelectUser: (user: AdminUser) => void,
  readonly onToggleChecked: (profileId: string, checked: boolean) => void,
  readonly onSaveProfile: () => void,
  readonly onToggleSuspension: (user: AdminUser) => void,
  readonly onAdjustWallet: () => void,
  readonly onProfileFieldChange: (field: keyof ProfileDraft, value: string) => void,
  readonly onWalletFieldChange: (field: keyof WalletDraft, value: string) => void,
}

/**
 * Users BO admin — the live user directory + per-user inspector.
 * Purely presentational: it renders the online widget, the searchable
 * user table, and the selected user's profile / wallet / inventory /
 * ledger panels from data the parent (Admin) already owns. No data
 * fetching here.
 */
export function UsersAdmin({
  onlineUsers,
  userSearch,
  checkedUserCount,
  filteredUsers,
  canManage,
  savingKey,
  checkedUserIds,
  allFilteredUsersChecked,
  selectableFilteredUserIds,
  selectedUserId,
  currentUserId,
  selectedUser,
  selectedUserDetail,
  profileDraft,
  walletDraft,
  onUserSearchChange,
  onSoftDelete,
  onHardDelete,
  onToggleAllFiltered,
  onSelectUser,
  onToggleChecked,
  onSaveProfile,
  onToggleSuspension,
  onAdjustWallet,
  onProfileFieldChange,
  onWalletFieldChange,
}: Props) {
  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      {/* Live online users widget. The dot pulses to make
            * "live" obvious; counts come straight from the
            * Realtime presence channel so the moment a player
            * closes their tab the WebSocket drops and the
            * count ticks down within a few seconds. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative grid h-2.5 w-2.5 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70"/>
            <span className="relative h-2 w-2 rounded-full bg-emerald-400"/>
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/90">
            Live online
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-black tabular-nums text-emerald-100">
            {onlineUsers.total}
          </span>
          <span className="text-xs font-bold text-emerald-200/60">total</span>
        </div>
        <div className="flex items-baseline gap-1.5 border-l border-emerald-500/30 pl-3">
          <span className="font-display text-lg font-black tabular-nums text-emerald-100">
            {onlineUsers.registered}
          </span>
          <span className="text-xs font-bold text-emerald-200/60">registered</span>
        </div>
        <div className="flex items-baseline gap-1.5 border-l border-emerald-500/30 pl-3">
          <span className="font-display text-lg font-black tabular-nums text-emerald-100">
            {onlineUsers.guests}
          </span>
          <span className="text-xs font-bold text-emerald-200/60">guests</span>
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">Users</h2>
        <input
          className="w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-200/60"
          placeholder="Search name, id, level, rating"
          value={userSearch}
          onChange={(event) => {
            onUserSearchChange(event.target.value)
          }}/>
      </div>
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/16 px-3 py-2 text-xs text-white/55">
        <span>
          {checkedUserCount > 0 ? `${checkedUserCount} selected` : `${filteredUsers.length} live users shown`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <DangerButton
            disabled={!canManage || checkedUserCount === 0 || savingKey === "user-delete"}
            onClick={() => {
              onSoftDelete([...checkedUserIds])
            }}>
            Delete selected
          </DangerButton>
          {/* Hard delete — purges auth.users + cascades. Used to
                  clear shell/test users that pile up during dev.
                  Type-DELETE confirm is inside hardDeleteUsers. */}
          <DangerButton
            disabled={!canManage || checkedUserCount === 0 || savingKey === "user-delete"}
            onClick={() => {
              onHardDelete([...checkedUserIds])
            }}>
            Hard delete (irreversible)
          </DangerButton>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-black/20 text-left text-xs uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">
                <input
                  aria-label="Select all visible users"
                  checked={allFilteredUsersChecked}
                  className="h-4 w-4 accent-amber-300"
                  disabled={selectableFilteredUserIds.length === 0}
                  type="checkbox"
                  onChange={(event) => {
                    onToggleAllFiltered(event.target.checked)
                  }}/>
              </th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {filteredUsers.map((row) => (<tr
              key={row.id}
              className={`cursor-pointer text-white/75 transition hover:bg-white/[0.055] ${row.id === selectedUserId ? "bg-amber-300/10" : ""}`}
              onClick={() => {
                onSelectUser(row)
              }}>
              <td className="px-4 py-3">
                <input
                  aria-label={`Select ${row.display_name}`}
                  checked={checkedUserIds.has(row.id)}
                  className="h-4 w-4 accent-amber-300"
                  disabled={row.id === currentUserId}
                  type="checkbox"
                  onChange={(event) => {
                    onToggleChecked(row.id, event.target.checked)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                  }}/>
              </td>
              <td className="px-4 py-3">
                <div className="font-bold text-white">{row.display_name}</div>
                <div className="max-w-[16rem] truncate font-mono text-xs text-white/35">{row.id}</div>
              </td>
              <td className="px-4 py-3">{accountType(row)}</td>
              <td className="px-4 py-3">L{row.level} · {formatNumber(row.xp)} XP</td>
              <td className="px-4 py-3">
                {formatNumber(row.wallet?.coins)} coins · {formatNumber(row.wallet?.gems)} gems
              </td>
              <td className="px-4 py-3">{formatNumber(row.rating)}</td>
              <td className="px-4 py-3">
                {row.is_suspended ? <StatusPill enabled={false}/> : <StatusPill enabled/>}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <button
                    className="rounded-md border border-rose-300/25 px-2 py-1 text-xs font-bold text-rose-100 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!canManage || row.id === currentUserId || savingKey === "user-delete"}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSoftDelete([row.id])
                    }}>
                    Delete
                  </button>
                  <button
                    className="rounded-md border border-rose-500/50 bg-rose-700/15 px-2 py-1 text-xs font-bold text-rose-200 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!canManage || row.id === currentUserId || savingKey === "user-delete"}
                    title="Hard delete (irreversible)"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onHardDelete([row.id])
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

    <div className="space-y-4">
      {!selectedUser ? (<EmptyState
        text="Select a user to inspect their profile, wallet, inventory, and match history."/>) : (<>
        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">{selectedUser.display_name}</h2>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-amber-200/70">
                {accountType(selectedUser)}
              </div>
              <div className="mt-1 break-all font-mono text-xs text-white/35">{selectedUser.id}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusPill enabled={!selectedUser.is_suspended}/>
              <DangerButton
                disabled={!canManage || selectedUser.id === currentUserId || savingKey === "user-delete"}
                onClick={() => {
                  onSoftDelete([selectedUser.id])
                }}>
                Delete user
              </DangerButton>
              <DangerButton
                disabled={!canManage || selectedUser.id === currentUserId || savingKey === "user-delete"}
                onClick={() => {
                  onHardDelete([selectedUser.id])
                }}>
                Hard delete (irreversible)
              </DangerButton>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-white/55">
            <div className="rounded-lg bg-black/18 p-2">
              <div className="text-white/35">Coins</div>
              <div className="font-bold text-white">{formatNumber(selectedUserDetail?.wallet?.coins)}</div>
            </div>
            <div className="rounded-lg bg-black/18 p-2">
              <div className="text-white/35">Gems</div>
              <div className="font-bold text-white">{formatNumber(selectedUserDetail?.wallet?.gems)}</div>
            </div>
            <div className="rounded-lg bg-black/18 p-2">
              <div className="text-white/35">Created</div>
              <div className="font-bold text-white">{formatDate(selectedUser.created_at)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Profile controls</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field
              label="Level"
              value={profileDraft.level}
              onChange={(level) => {
                onProfileFieldChange("level", level)
              }}/>
            <Field
              label="XP"
              value={profileDraft.xp}
              onChange={(xp) => {
                onProfileFieldChange("xp", xp)
              }}/>
            <Field
              label="Rating"
              value={profileDraft.rating}
              onChange={(rating) => {
                onProfileFieldChange("rating", rating)
              }}/>
          </div>
          <div className="mt-3">
            <TextArea
              label="Admin note"
              rows={3}
              value={profileDraft.admin_note}
              onChange={(admin_note) => {
                onProfileFieldChange("admin_note", admin_note)
              }}/>
          </div>
          <div className="mt-3">
            <TextArea
              label="Suspension reason"
              rows={2}
              value={profileDraft.suspension_reason}
              onChange={(suspension_reason) => {
                onProfileFieldChange("suspension_reason", suspension_reason)
              }}/>
          </div>
          <div className="mt-3 flex gap-2">
            <PrimaryButton
              disabled={!canManage || savingKey === "profile"}
              onClick={onSaveProfile}>
              Save profile
            </PrimaryButton>
            <SecondaryButton
              disabled={!canManage}
              onClick={() => {
                onToggleSuspension(selectedUser)
              }}>
              {selectedUser.is_suspended ? "Unsuspend" : "Suspend"}
            </SecondaryButton>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Grant / remove currency</h3>
          <div className="mt-3 grid grid-cols-[7rem_1fr] gap-2">
            <select
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              value={walletDraft.currency}
              onChange={(event) => {
                onWalletFieldChange("currency", event.target.value)
              }}>
              <option value="coins">Coins</option>
              <option value="gems">Gems</option>
            </select>
            <Field
              label="Amount (+ or -)"
              value={walletDraft.amount}
              onChange={(amount) => {
                onWalletFieldChange("amount", amount)
              }}/>
          </div>
          <div className="mt-3">
            <Field
              label="Reason"
              value={walletDraft.reason}
              onChange={(reason) => {
                onWalletFieldChange("reason", reason)
              }}/>
          </div>
          <div className="mt-3">
            <PrimaryButton
              disabled={!canManage || savingKey === "wallet"}
              onClick={onAdjustWallet}>
              Apply wallet change
            </PrimaryButton>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Inventory</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedUserDetail?.boards.length ? (selectedUserDetail.boards.map((item) => (
              <span
                key={item.board_theme_id}
                className="rounded-full bg-black/25 px-3 py-1 text-xs text-white/65">
                {item.board_theme_id} · {item.source}
              </span>))) : (<div className="text-sm text-white/45">No owned boards.</div>)}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Wallet ledger</h3>
          <div className="mt-2 space-y-2">
            {selectedUserDetail?.transactions.length ? (selectedUserDetail.transactions.map((tx) => (
              <div
                key={tx.id}
                className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                <div className="font-bold text-white">
                  {tx.amount > 0 ? "+" : ""}{formatNumber(tx.amount)} {tx.currency}
                </div>
                <div>{tx.reason}</div>
                <div
                  className="text-white/35">After: {formatNumber(tx.balance_after)} · {formatDate(tx.created_at)}</div>
              </div>))) : (<div className="text-sm text-white/45">No wallet transactions yet.</div>)}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Purchases</h3>
          <div className="mt-2 space-y-2">
            {selectedUserDetail?.purchases.length ? (selectedUserDetail.purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                <div className="font-bold text-white">{purchase.product_id}</div>
                <div>{purchase.product_type} · {purchase.provider} · {purchase.status}</div>
                <div
                  className="text-white/35">{moneyFromCents(purchase.price_cents)} · {formatDate(purchase.created_at)}</div>
              </div>))) : (<div className="text-sm text-white/45">No purchases yet.</div>)}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h3 className="font-black">Match history</h3>
          <div className="mt-2 space-y-2">
            {selectedUserDetail?.matches.length ? (selectedUserDetail.matches.map((match) => (
              <div
                key={match.id}
                className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                <div className="font-bold text-white">{match.mode} · to {match.target}</div>
                <div>Score {match.white_score}-{match.black_score} · winner {match.winner ?? "open"}</div>
                <div className="text-white/35">{formatDate(match.started_at)}</div>
              </div>))) : (<div className="text-sm text-white/45">No matches yet.</div>)}
          </div>
        </div>
      </>)}
    </div>
  </div>)
}
