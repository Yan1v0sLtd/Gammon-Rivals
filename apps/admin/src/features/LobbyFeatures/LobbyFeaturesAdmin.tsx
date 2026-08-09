import {useEffect, useState} from "react"

import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {Toggle} from "../../components/Toggle"
import {requiredNumber} from "../../lib/requiredNumber"

import {
  useGetLobbyFeaturesQuery,
  useUpdateLobbyFeatureMutation,
} from "./LobbyFeaturesApi"

export type LobbyFeatureRow = {
  feature_key: string, label: string, level: string, enabled: boolean, tooltip: string,
}

type Props = {
  readonly canManage: boolean,
  readonly onError: (error: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Lobby Features BO admin — the bottom-nav feature lock levels
 * (lobby_feature_configs). Owns its own data: it fetches the config rows via
 * RTK Query, keeps editable drafts in local state, and saves through the
 * update mutation. Query and mutation failures are reported up through
 * `onError` for page-level display. No direct Supabase calls here.
 */
export function LobbyFeaturesAdmin({
  canManage,
  onError,
  onBeforeSave,
}: Props) {
  const {data, error: queryError} = useGetLobbyFeaturesQuery()
  const [updateLobbyFeature] = useUpdateLobbyFeatureMutation()
  const [rows, setRows] = useState<LobbyFeatureRow[]>([])
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Surface a fetch failure through the page-level error reporter.
  useEffect(() => {
    if (queryError) onError(queryError)
  }, [queryError, onError])

  // Sync the editable rows from canonical server data. A mutation
  // invalidation/refetch restores the rows to what the server actually holds.
  useEffect(() => {
    setRows((data ?? []).map((r) => ({
      feature_key: r.feature_key,
      label: r.label,
      level: String(r.unlock_level),
      enabled: r.is_enabled,
      tooltip: r.tooltip_text ?? "",
    })))
  }, [data])

  function updateRow(featureKey: string, patch: Partial<Pick<LobbyFeatureRow, "level" | "enabled" | "tooltip">>) {
    setRows((current) => current.map((r) => r.feature_key === featureKey ? {...r, ...patch} : r))
  }

  async function handleSave(featureKey: string) {
    if (!canManage) return
    const row = rows.find((f) => f.feature_key === featureKey)
    if (!row) return
    setSavingKey(`feature:${featureKey}`)
    try {
      const level = requiredNumber(row.level, "Unlock level")
      if (level < 1) throw new Error("Unlock level must be at least 1.")
      const tooltip = row.tooltip.trim()
      // Clear any stale page-level error before the save, mirroring the old
      // Admin handler's setDataError(null) so a fresh save doesn't leave a
      // previous failure on screen.
      onBeforeSave()
      await updateLobbyFeature({
        featureKey,
        patch: {
          unlock_level: level,
          is_enabled: row.enabled,
          tooltip_text: tooltip === "" ? null : tooltip,
        },
      }).unwrap()
    }
    catch (err) {
      onError(err)
    }
    finally {
      setSavingKey(null)
    }
  }

  return (<div className="max-w-2xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
    <h2 className="text-lg font-black">Bottom-nav feature locks</h2>
    <p className="mt-1 text-xs text-white/55">
      Gate each bottom-nav feature behind a player level, like boards.
      A player below the level sees a padlock; tapping it pops a
      tooltip. Level 1 = always open (set a high level to keep a
      feature locked for everyone). Leave the tooltip text blank for
      the default "Reach level X to unlock", or set custom copy like
      "Coming soon". The center Hourly Bonus wheel is never gated.
      Disabling a feature hides its action (reserved for future use).
    </p>
    <div className="mt-4 space-y-3">
      {rows.length === 0 ? (
        <p className="text-xs text-white/40">Loading…</p>) : (rows.map((f) => (<div
        key={f.feature_key}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <div className="min-w-[8rem] flex-1">
          <div className="text-sm font-black">{f.label}</div>
          <div className="font-mono text-[10px] text-white/40">{f.feature_key}</div>
        </div>
        <div className="w-28">
          <Field
            label="Unlock level"
            value={f.level}
            onChange={(level) => {
              updateRow(f.feature_key, {level})
            }}/>
        </div>
        <Toggle
          checked={f.enabled}
          label="Enabled"
          onChange={(enabled) => {
            updateRow(f.feature_key, {enabled})
          }}/>
        <div className="basis-full">
          <Field
            label="Tooltip text (optional)"
            placeholder={`Reach level ${f.level || "N"} to unlock`}
            value={f.tooltip}
            onChange={(tooltip) => {
              updateRow(f.feature_key, {tooltip})
            }}/>
        </div>
        <PrimaryButton
          disabled={!canManage || savingKey === `feature:${f.feature_key}`}
          onClick={() => {
            void handleSave(f.feature_key)
          }}>
          Save
        </PrimaryButton>
      </div>)))}
    </div>
  </div>)
}
