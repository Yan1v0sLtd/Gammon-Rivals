import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import type {EconomyGrantDraft} from "../../lib/grantToDraft"

type EconomyGrant = Database["public"]["Tables"]["economy_grants"]["Row"]

type Props = {
  readonly economyGrants: readonly EconomyGrant[],
  readonly grantDraft: EconomyGrantDraft,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onSelectGrant: (index: number) => void,
  readonly onFieldChange: (field: keyof EconomyGrantDraft, value: string) => void,
  readonly onToggleOneTime: (one_time: boolean) => void,
  readonly onToggleEnabled: (is_enabled: boolean) => void,
  readonly onSave: () => void,
  readonly onNew: () => void,
}

/**
 * Economy Grants BO admin — the coin/gem grant table + edit form.
 * Purely presentational: it renders the list of grant triggers and the
 * coin/gem editor from data the parent (Admin) already owns. No data
 * fetching here.
 */
export function EconomyGrantsAdmin({
  economyGrants,
  grantDraft,
  canManage,
  savingKey,
  onSelectGrant,
  onFieldChange,
  onToggleOneTime,
  onToggleEnabled,
  onSave,
  onNew,
}: Props) {
  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <ConfigTable
      rows={economyGrants.map((row) => [row.trigger_key, row.display_name, `${formatNumber(row.coins)} coins · ${row.gems} gems`, row.one_time ? "One-time" : "Repeatable", row.is_enabled ? "Enabled" : "Disabled"])}
      title="Economy grants"
      onRowClick={onSelectGrant}/>
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h2 className="text-lg font-black">Edit grant</h2>
      <p className="mt-1 text-xs text-white/55">
        Coin / gem grants fired by a trigger.{" "}
        <code className="font-mono">signup</code> is the
        starting balance every new player receives. Add a new
        key (e.g. <code className="font-mono">refer_friend</code>,{" "}
        <code className="font-mono">link_google</code>) to define
        a future tap — the value is configurable here today;
        firing it is a one-line server call when that feature
        ships. Disable rather than delete. One-time grants are
        credited at most once per player.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          disabled={!grantDraft.isNew}
          label="Trigger key"
          value={grantDraft.trigger_key}
          onChange={(trigger_key) => {
            onFieldChange("trigger_key", trigger_key)
          }}/>
        <Field
          label="Display name"
          value={grantDraft.display_name}
          onChange={(display_name) => {
            onFieldChange("display_name", display_name)
          }}/>
        <Field
          label="Coins"
          value={grantDraft.coins}
          onChange={(coins) => {
            onFieldChange("coins", coins)
          }}/>
        <Field
          label="Gems"
          value={grantDraft.gems}
          onChange={(gems) => {
            onFieldChange("gems", gems)
          }}/>
        <Field
          label="Sort order"
          value={grantDraft.sort_order}
          onChange={(sort_order) => {
            onFieldChange("sort_order", sort_order)
          }}/>
      </div>
      <div className="mt-3 space-y-3">
        <Field
          label="Description"
          value={grantDraft.description}
          onChange={(description) => {
            onFieldChange("description", description)
          }}/>
        <Toggle
          checked={grantDraft.one_time}
          label="One-time (max once per player)"
          onChange={onToggleOneTime}/>
        <Toggle
          checked={grantDraft.is_enabled}
          label="Enabled"
          onChange={onToggleEnabled}/>
        {!grantDraft.isNew ? (<p className="text-[10px] normal-case tracking-normal text-white/40">
          Trigger key is the primary key and can't be changed on
          an existing grant. Click "New" to create one with a
          different key.
        </p>) : null}
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || savingKey === "grant"}
            onClick={onSave}>
            Save grant
          </PrimaryButton>
          <SecondaryButton onClick={onNew}>New</SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
