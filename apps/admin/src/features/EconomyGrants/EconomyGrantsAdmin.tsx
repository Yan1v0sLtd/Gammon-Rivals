import {useEffect, useState} from "react"

import {ConfigTable} from "../../components/ConfigTable"
import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {Toggle} from "../../components/Toggle"
import {formatNumber} from "../../lib/formatNumber"
import {type EconomyGrantDraft, grantToDraft} from "../../lib/grantToDraft"
import {requiredNumber} from "../../lib/requiredNumber"

import {useGetEconomyGrantsQuery, useUpsertEconomyGrantMutation} from "./EconomyGrantsApi"

type Props = {
  readonly canManage: boolean,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Economy Grants BO admin — the coin/gem grant table + edit form.
 * Owns its own data: it fetches the grant rows via RTK Query, keeps
 * the editable draft in local state, and saves through the upsert
 * mutation. Query and mutation failures are reported up through
 * `onError` for page-level display. No direct Supabase calls here.
 */
export function EconomyGrantsAdmin({
  canManage,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: economyGrants = [],
    error: queryError,
  } = useGetEconomyGrantsQuery()
  const [upsertEconomyGrant, {isLoading: saving}] = useUpsertEconomyGrantMutation()
  const [grantDraft, setGrantDraft] = useState<EconomyGrantDraft>(() => grantToDraft())

  // Surface a fetch failure through the page-level error reporter.
  useEffect(() => {
    if (queryError) onError(queryError)
  }, [queryError, onError])

  function selectGrant(index: number) {
    setGrantDraft(grantToDraft(economyGrants[index]))
  }

  function fieldChange(field: keyof EconomyGrantDraft, value: string) {
    setGrantDraft((d) => ({
      ...d,
      [field]: value,
    }))
  }

  function toggleOneTime(one_time: boolean) {
    setGrantDraft((d) => ({
      ...d,
      one_time,
    }))
  }

  function toggleEnabled(is_enabled: boolean) {
    setGrantDraft((d) => ({
      ...d,
      is_enabled,
    }))
  }

  function newGrant() {
    setGrantDraft(grantToDraft())
  }

  async function saveGrant() {
    if (!canManage) return
    // Clear any stale page-level error before the save, mirroring the old
    // Admin handler's setDataError(null) so a fresh save doesn't leave a
    // previous failure on screen.
    onBeforeSave()
    try {
      const triggerKey = grantDraft.trigger_key.trim().toLowerCase()
      if (!/^[a-z][a-z0-9_]*$/.test(triggerKey)) {
        throw new Error("Trigger key must be lowercase letters/numbers/underscores, starting with a letter (e.g. refer_friend).")
      }
      if (!grantDraft.display_name.trim()) {
        throw new Error("Display name is required.")
      }
      await upsertEconomyGrant({
        p_trigger_key: triggerKey,
        p_display_name: grantDraft.display_name.trim(),
        p_description: grantDraft.description.trim(),
        p_coins: requiredNumber(grantDraft.coins, "Coins"),
        p_gems: requiredNumber(grantDraft.gems, "Gems"),
        p_one_time: grantDraft.one_time,
        p_is_enabled: grantDraft.is_enabled,
        p_sort_order: requiredNumber(grantDraft.sort_order, "Sort order"),
      }).unwrap()
      setGrantDraft(grantToDraft())
    }
    catch (err) {
      onError(err)
    }
  }

  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    <ConfigTable
      rows={economyGrants.map((row) => [row.trigger_key, row.display_name, `${formatNumber(row.coins)} coins · ${row.gems} gems`, row.one_time ? "One-time" : "Repeatable", row.is_enabled ? "Enabled" : "Disabled"])}
      title="Economy grants"
      onRowClick={selectGrant}/>
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
            fieldChange("trigger_key", trigger_key)
          }}/>
        <Field
          label="Display name"
          value={grantDraft.display_name}
          onChange={(display_name) => {
            fieldChange("display_name", display_name)
          }}/>
        <Field
          label="Coins"
          value={grantDraft.coins}
          onChange={(coins) => {
            fieldChange("coins", coins)
          }}/>
        <Field
          label="Gems"
          value={grantDraft.gems}
          onChange={(gems) => {
            fieldChange("gems", gems)
          }}/>
        <Field
          label="Sort order"
          value={grantDraft.sort_order}
          onChange={(sort_order) => {
            fieldChange("sort_order", sort_order)
          }}/>
      </div>
      <div className="mt-3 space-y-3">
        <Field
          label="Description"
          value={grantDraft.description}
          onChange={(description) => {
            fieldChange("description", description)
          }}/>
        <Toggle
          checked={grantDraft.one_time}
          label="One-time (max once per player)"
          onChange={toggleOneTime}/>
        <Toggle
          checked={grantDraft.is_enabled}
          label="Enabled"
          onChange={toggleEnabled}/>
        {!grantDraft.isNew ? (<p className="text-[10px] normal-case tracking-normal text-white/40">
          Trigger key is the primary key and can't be changed on
          an existing grant. Click "New" to create one with a
          different key.
        </p>) : null}
        <div className="flex gap-2">
          <PrimaryButton
            disabled={!canManage || saving}
            onClick={() => {
              void saveGrant()
            }}>
            Save grant
          </PrimaryButton>
          <SecondaryButton onClick={newGrant}>New</SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
