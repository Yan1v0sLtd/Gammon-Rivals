import {useEffect, useState} from "react"

/** Reroll confirmation popup — carnival/gold style matching BoardPurchaseModal,
 *  asking the player to confirm spending gems (or a free reroll). */
export function RerollConfirmModal({
  priceGems,
  isBusy,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  readonly priceGems: number,
  readonly isBusy: boolean,
  readonly errorMessage: string | null,
  readonly onConfirm: () => void,
  readonly onCancel: () => void,
}) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true)
    })
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])
  const free = priceGems <= 0
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{
      // backdrop-filter blur removed for mobile perf; deeper dim compensates.
        background: "radial-gradient(circle at center, rgba(92,48,14,0.45), rgba(0,0,0,0.84))",
        opacity: entered ? 1 : 0,
        transition: "opacity 220ms ease",
      }}>
      <div
        className="relative text-center"
        style={{
          width: "min(92vw, 26rem)",
          padding: "clamp(1.6rem,5vmin,2.3rem) clamp(1.5rem,5vmin,2.6rem) clamp(1.4rem,4.5vmin,2rem)",
          borderRadius: "22px",
          background: "linear-gradient(rgba(255,255,255,0.22), transparent 26%), radial-gradient(circle at 50% 12%, #fff7bc 0%, #f7d374 34%, #dfa045 72%, #b96b1f 100%)",
          border: "5px solid #ffd057",
          color: "#4b2108",
          boxShadow: "0 0 0 2px #8a3d08, 0 0 0 6px #ffb321, 0 18px 36px rgba(0,0,0,0.6), inset 0 4px 0 rgba(255,255,255,0.7), inset 0 -8px 0 rgba(89,38,9,0.25), inset 0 0 45px rgba(95,43,8,0.22)",
          transformOrigin: "center",
          transform: entered ? "scale(1)" : "scale(0.16)",
          opacity: entered ? 1 : 0,
          transition: "transform 460ms cubic-bezier(0.2, 0.9, 0.2, 1.12), opacity 220ms ease",
          transitionDelay: entered ? "120ms" : "0ms",
        }}>
        <button
          aria-label="Cancel"
          className="absolute z-10 grid place-items-center transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          style={{
            right: "-1.1rem",
            top: "-1.1rem",
            width: "3.2rem",
            height: "3.2rem",
            borderRadius: "50%",
            border: "4px solid #ffe06c",
            background: "radial-gradient(circle at 35% 25%, #fff18b 0% 12%, #ffb229 13% 32%, #ef4c17 60%, #921707 100%)",
            color: "#fff2a5",
            fontSize: "2rem",
            fontWeight: 900,
            lineHeight: 1,
            textShadow: "0 3px 0 #8a1608",
            boxShadow: "0 6px 0 #6b2106, 0 12px 18px rgba(0,0,0,0.45), inset 0 3px 0 rgba(255,255,255,0.55)",
          }}
          type="button"
          onClick={onCancel}>
          ×
        </button>

        <h2
          className="relative font-display whitespace-nowrap"
          style={{
            margin: 0,
            marginBottom: "clamp(1rem,2.5vmin,1.4rem)",
            fontSize: "clamp(1.2rem,4.2vmin,1.8rem)",
            fontWeight: 900,
            letterSpacing: "0.03em",
            color: "#5d3208",
            textShadow: "0 1px 0 rgba(255,251,222,0.8), 0 2px 2px rgba(255,247,200,0.3), 0 -1px 1px rgba(35,14,2,0.45)",
          }}>
          <span style={{
            fontSize: "0.6em",
            margin: "0 0.5rem",
            color: "#8a5410",
          }}>✦</span>
          REROLL MISSION
          <span style={{
            fontSize: "0.6em",
            margin: "0 0.5rem",
            color: "#8a5410",
          }}>✦</span>
        </h2>

        {!free && (<div
          className="relative mx-auto flex items-center justify-center"
          style={{
            width: "min(82%, 18rem)",
            height: "clamp(4.4rem,12vmin,6rem)",
            marginBottom: "clamp(1rem,3vmin,1.5rem)",
            borderRadius: "18px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.55), transparent 38%), radial-gradient(circle at center, #fff0a5 0%, #f6ca62 60%, #c88022 100%)",
            border: "4px solid #e39a19",
            boxShadow: "0 0 0 2px #ffdc60, 0 8px 14px rgba(0,0,0,0.35), inset 0 3px 0 rgba(255,255,255,0.65), inset 0 -5px 0 rgba(107,48,8,0.22)",
            gap: "clamp(0.8rem,2.5vmin,1.5rem)",
          }}>
          <img
            alt=""
            draggable={false}
            src="/lobby/carousel/gem.webp"
            style={{
              width: "clamp(2.6rem,7vmin,3.8rem)",
              height: "clamp(2.6rem,7vmin,3.8rem)",
              objectFit: "contain",
              filter: "drop-shadow(0 6px 4px rgba(0,0,0,0.35)) drop-shadow(0 0 10px rgba(0,0,0,0.5))",
            }}/>
          <span
            className="font-display tabular-nums"
            style={{
              fontSize: "clamp(2.2rem,7vmin,3.4rem)",
              fontWeight: 900,
              color: "#3c1704",
              lineHeight: 1,
              textShadow: "0 2px 0 #fff3ad, 0 5px 6px rgba(0,0,0,0.28)",
            }}>
            {priceGems.toLocaleString()}
          </span>
        </div>)}

        <p
          className="relative font-bold"
          style={{
            margin: 0,
            marginBottom: "clamp(1rem,2.5vmin,1.4rem)",
            fontSize: "clamp(0.95rem,2.8vmin,1.25rem)",
            color: "#572607",
            textShadow: "0 1px 0 rgba(255,255,255,0.35)",
          }}>
          {free ? ("Reroll this mission for free?") : (<>
            Reroll this mission for{" "}
            <strong style={{fontWeight: 900}}>{priceGems.toLocaleString()} Gems?</strong>
          </>)}
        </p>

        {errorMessage ? (
          <div
            className="relative mx-auto"
            style={{
              maxWidth: "85%",
              marginBottom: "clamp(0.8rem,2vmin,1.2rem)",
              borderRadius: "8px",
              border: "1px solid rgba(190,18,60,0.4)",
              background: "#fff1f1",
              padding: "0.5rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 700,
              color: "#9f1239",
            }}>
            {errorMessage}
          </div>
        ) : null}

        <div
          className="relative flex justify-center"
          style={{gap: "clamp(1.5rem,5vmin,2.6rem)"}}>
          <button
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            style={{
              width: "clamp(7rem,22vmin,9rem)",
              height: "clamp(2.8rem,7vmin,3.4rem)",
              borderRadius: "9999px",
              border: "2px solid rgba(224,255,143,0.95)",
              color: "#132109",
              fontSize: "clamp(1.2rem,3.6vmin,1.7rem)",
              fontWeight: 900,
              letterSpacing: "0.04em",
              textShadow: "0 1px 0 rgba(255,255,255,0.28)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(191,255,88,0.86) 13%, transparent 39%), linear-gradient(180deg, #d6ff73 0%, #8cf244 40%, #20bd1f 68%, #07810d 100%)",
              boxShadow: "0 5px 0 #06450a, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.74), inset 0 -5px 0 rgba(0,78,5,0.34), 0 0 0 2px rgba(7,27,11,0.85)",
            }}
            type="button"
            onClick={onConfirm}>
            {isBusy ? "…" : "Yes"}
          </button>
          <button
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            style={{
              width: "clamp(7rem,22vmin,9rem)",
              height: "clamp(2.8rem,7vmin,3.4rem)",
              borderRadius: "9999px",
              border: "2px solid rgba(220,220,220,0.95)",
              color: "#1a1a1a",
              fontSize: "clamp(1.2rem,3.6vmin,1.7rem)",
              fontWeight: 900,
              letterSpacing: "0.04em",
              textShadow: "0 1px 0 rgba(255,255,255,0.4)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(210,210,210,0.86) 13%, transparent 39%), linear-gradient(180deg, #e2e2e2 0%, #a8a8a8 40%, #6a6a6a 68%, #3a3a3a 100%)",
              boxShadow: "0 5px 0 #1f1f1f, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -5px 0 rgba(0,0,0,0.28), 0 0 0 2px rgba(15,15,15,0.85)",
            }}
            type="button"
            onClick={onCancel}>
            No
          </button>
        </div>
      </div>
    </div>
  )
}
