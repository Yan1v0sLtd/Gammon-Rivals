import {Field} from "../../components/Field"
import {PrimaryButton} from "../../components/PrimaryButton"
import {Toggle} from "../../components/Toggle"

export type LobbyFeatureRow = {
  feature_key: string, label: string, level: string, enabled: boolean, tooltip: string,
}

type Props = {
  readonly lobbyFeatures: readonly LobbyFeatureRow[],
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onChangeLevel: (featureKey: string, level: string) => void,
  readonly onChangeEnabled: (featureKey: string, enabled: boolean) => void,
  readonly onChangeTooltip: (featureKey: string, tooltip: string) => void,
  readonly onSave: (featureKey: string) => void,
}

/**
 * Lobby Features BO admin — the bottom-nav feature lock levels
 * (lobby_feature_configs). Purely presentational: it renders from data the
 * parent (Admin) already owns and reports edits/actions back through explicit
 * callbacks. No data fetching here.
 */
export function LobbyFeaturesAdmin({
  lobbyFeatures,
  canManage,
  savingKey,
  onChangeLevel,
  onChangeEnabled,
  onChangeTooltip,
  onSave,
}: Props) {
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
      {lobbyFeatures.length === 0 ? (
        <p className="text-xs text-white/40">Loading…</p>) : (lobbyFeatures.map((f) => (<div
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
              onChangeLevel(f.feature_key, level)
            }}/>
        </div>
        <Toggle
          checked={f.enabled}
          label="Enabled"
          onChange={(enabled) => {
            onChangeEnabled(f.feature_key, enabled)
          }}/>
        <div className="basis-full">
          <Field
            label="Tooltip text (optional)"
            placeholder={`Reach level ${f.level || "N"} to unlock`}
            value={f.tooltip}
            onChange={(tooltip) => {
              onChangeTooltip(f.feature_key, tooltip)
            }}/>
        </div>
        <PrimaryButton
          disabled={!canManage || savingKey === `feature:${f.feature_key}`}
          onClick={() => {
            onSave(f.feature_key)
          }}>
          Save
        </PrimaryButton>
      </div>)))}
    </div>
  </div>)
}
