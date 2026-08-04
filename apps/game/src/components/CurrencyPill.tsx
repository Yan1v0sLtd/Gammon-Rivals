import {RollingNumber} from "../lobby/RollingNumber"

/**
 * The premium coins/gems balance pill used in the lobby top bar — extracted
 * here so other surfaces (the Shop header) render the *same* element with the
 * player's real balance, not a lookalike. `data-fly-target` is preserved so
 * reward-flight animations keep aiming at it. Sizing/markup are unchanged from
 * the original lobby pill; callers control behaviour via `onAdd`.
 */
export function CurrencyPill({
  flyTarget,
  label,
  value,
  icon,
  onAdd,
  showAdd = true,
}: {
  readonly flyTarget: "coins" | "gems",
  readonly label: string,
  readonly value: number | null | undefined,
  readonly icon: string,
  readonly onAdd: () => void,
  /** The green "+" that opens the shop. Hidden where it's redundant (e.g.
   *  inside the shop itself). Defaults to shown (lobby behaviour). */
  readonly showAdd?: boolean,
}) {
  return (<div
    aria-label={`${label}: ${value ?? 0}`}
    className="lobby-currency-pill relative flex h-[2.76rem] min-w-[7.87rem] items-center rounded-md border border-[#28577d]/80 bg-gradient-to-b from-[#114f83]/80 to-[#073768]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_7px_14px_rgba(0,0,0,0.32)] backdrop-blur"
    data-fly-target={flyTarget}
    // With the add button hidden, drop the trailing grid column (the pill is
    // a 3-col grid in index.css) so there's no empty gap on the right.
    style={showAdd ? undefined : {gridTemplateColumns: "calc(48 * var(--lobby-u)) minmax(0, 1fr)"}}>
    <span className="lobby-currency-icon -ml-[0.92rem] grid h-[3.22rem] w-[3.22rem] shrink-0 place-items-center">
      <img
        alt=""
        className="h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.42)]"
        draggable={false}
        src={icon}/>
    </span>
    <span
      className="lobby-currency-value -ml-[0.46rem] flex h-[2.35rem] min-w-0 flex-1 items-center justify-center rounded bg-[#071f3f]/82 px-[0.92rem] text-center font-display text-lg font-black tracking-wide text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
      <RollingNumber value={value}/>
    </span>
    {showAdd ? (<button
      aria-label={`Get more ${label}`}
      className="lobby-currency-add relative mr-[0.23rem] grid h-[2.3rem] w-[2.3rem] shrink-0 place-items-center rounded bg-gradient-to-b from-[#8dff68] via-[#47d039] to-[#17831c] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_3px_0_#0c5710] transition hover:brightness-110 active:translate-y-[1px]"
      type="button"
      onClick={onAdd}>
      <span
        className="absolute left-1/2 top-1/2 h-[1.38rem] w-[0.35rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]"/>
      <span
        className="absolute left-1/2 top-1/2 h-[0.35rem] w-[1.38rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]"/>
    </button>) : null}
  </div>)
}
