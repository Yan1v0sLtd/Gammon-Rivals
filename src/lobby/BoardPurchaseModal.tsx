interface BoardPurchaseModalProps {
  readonly boardName: string;
  readonly priceGems: number;
  readonly isPurchasing: boolean;
  readonly errorMessage: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Confirmation modal shown when a player taps an owned-with-gems board.
 * Carnival/fortune-card style matching the rest of the lobby chrome
 * (HourlyBonus modal): heavy gold rim, decorative corner rivets, big
 * red close orb, dark-red name ribbon, gold price plate with the
 * existing /lobby/carousel/gem.webp icon, Yes/No 3D buttons.
 *
 * Props are unchanged from the previous version — LobbyScreen needs
 * no edits to adopt the new look.
 */
export function BoardPurchaseModal({
  boardName,
  priceGems,
  isPurchasing,
  errorMessage,
  onConfirm,
  onCancel,
}: BoardPurchaseModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background:
          'radial-gradient(circle at center, rgba(92,48,14,0.35), rgba(0,0,0,0.78))',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Gold modal frame. Multiple stacked box-shadows fake the
          orange-rim-on-gold rim-on-brown trim from the reference. */}
      <div
        className="relative text-center"
        style={{
          width: 'min(92vw, 30rem)',
          padding: 'clamp(1.6rem, 5vmin, 2.4rem) clamp(1.5rem, 5vmin, 2.8rem) clamp(1.4rem, 4.5vmin, 2.2rem)',
          borderRadius: '22px',
          background:
            'linear-gradient(rgba(255,255,255,0.22), transparent 26%), radial-gradient(circle at 50% 12%, #fff7bc 0%, #f7d374 34%, #dfa045 72%, #b96b1f 100%)',
          border: '5px solid #ffd057',
          color: '#4b2108',
          boxShadow:
            '0 0 0 2px #8a3d08, 0 0 0 6px #ffb321, 0 18px 36px rgba(0,0,0,0.6), inset 0 4px 0 rgba(255,255,255,0.7), inset 0 -8px 0 rgba(89,38,9,0.25), inset 0 0 45px rgba(95,43,8,0.22)',
        }}
      >
        {/* Decorative inset border ring */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[14px]"
          style={{
            inset: '14px',
            border: '1px solid rgba(115,52,9,0.4)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 0 24px rgba(120,50,8,0.16)',
          }}
        />

        {/* Four gold corner rivets — L-shaped border w/ a gold disc
            in each corner, matching the reference. */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => {
          const base: React.CSSProperties = {
            position: 'absolute',
            width: '3.8rem',
            height: '3.8rem',
            border: '5px solid #ffd65b',
            pointerEvents: 'none',
            zIndex: 3,
          };
          const positional: React.CSSProperties =
            pos === 'tl'
              ? { top: '-5px', left: '-5px', borderRight: 0, borderBottom: 0, borderRadius: '20px 0 0 0' }
              : pos === 'tr'
                ? { top: '-5px', right: '-5px', borderLeft: 0, borderBottom: 0, borderRadius: '0 20px 0 0' }
                : pos === 'bl'
                  ? { bottom: '-5px', left: '-5px', borderRight: 0, borderTop: 0, borderRadius: '0 0 0 20px' }
                  : { bottom: '-5px', right: '-5px', borderLeft: 0, borderTop: 0, borderRadius: '0 0 20px 0' };
          const discPos: React.CSSProperties =
            pos === 'tl'
              ? { top: '6px', left: '6px' }
              : pos === 'tr'
                ? { top: '6px', right: '6px' }
                : pos === 'bl'
                  ? { bottom: '6px', left: '6px' }
                  : { bottom: '6px', right: '6px' };
          return (
            <div key={pos} aria-hidden style={{ ...base, ...positional }}>
              <span
                style={{
                  position: 'absolute',
                  width: '1.4rem',
                  height: '1.4rem',
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle, #fff5a5, #d78416 65%, #7c3508)',
                  boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.55)',
                  ...discPos,
                }}
              />
            </div>
          );
        })}

        {/* Close orb — large red sphere with thick gold rim, sits
            outside the top-right corner. */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isPurchasing}
          aria-label="Cancel"
          className="absolute z-10 grid place-items-center transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            right: '-1.1rem',
            top: '-1.1rem',
            width: '3.2rem',
            height: '3.2rem',
            borderRadius: '50%',
            border: '4px solid #ffe06c',
            background:
              'radial-gradient(circle at 35% 25%, #fff18b 0% 12%, #ffb229 13% 32%, #ef4c17 60%, #921707 100%)',
            color: '#fff2a5',
            fontSize: '2rem',
            fontWeight: 900,
            lineHeight: 1,
            textShadow: '0 3px 0 #8a1608',
            boxShadow:
              '0 6px 0 #6b2106, 0 12px 18px rgba(0,0,0,0.45), inset 0 3px 0 rgba(255,255,255,0.55)',
          }}
        >
          ×
        </button>

        {/* Title — ✦ UNLOCK BOARD ✦ with the multi-layer text shadow
            from the reference (gold-on-cream-on-brown stack). Sized
            down + whitespace-nowrap so the title stays on one line
            even at the narrow modal-width breakpoint (it was
            wrapping to UNLOCK / BOARD before). */}
        <h2
          className="relative font-display whitespace-nowrap"
          style={{
            zIndex: 2,
            margin: 0,
            marginBottom: 'clamp(0.8rem, 2vmin, 1.2rem)',
            fontSize: 'clamp(1.2rem, 4.2vmin, 1.9rem)',
            fontWeight: 900,
            letterSpacing: '0.03em',
            color: '#ffd45f',
            textShadow:
              '0 2px 0 #fff2a6, 0 4px 0 #9a4708, 0 7px 0 #5d2605, 0 10px 12px rgba(0,0,0,0.45)',
          }}
        >
          <span style={{ fontSize: '0.6em', margin: '0 0.5rem', color: '#ffdf69' }}>
            ✦
          </span>
          UNLOCK BOARD
          <span style={{ fontSize: '0.6em', margin: '0 0.5rem', color: '#ffdf69' }}>
            ✦
          </span>
        </h2>

        {/* Board name ribbon — dark-red banner with diamond caps. */}
        <div
          className="relative inline-flex items-center justify-center font-display"
          style={{
            zIndex: 2,
            minWidth: '14rem',
            height: 'clamp(2.4rem, 6vmin, 3rem)',
            marginBottom: 'clamp(1rem, 3vmin, 1.5rem)',
            padding: '0 1.6rem',
            background: 'linear-gradient(#7c360a, #3e1503 62%, #2a0c02)',
            border: '2px solid #e9ad29',
            borderRadius: '8px',
            color: 'white',
            fontSize: 'clamp(1rem, 3vmin, 1.4rem)',
            fontWeight: 900,
            textShadow: '0 2px 0 rgba(0,0,0,0.5)',
            boxShadow:
              'inset 0 3px 0 rgba(255,255,255,0.2), inset 0 -3px 0 rgba(0,0,0,0.35), 0 5px 9px rgba(0,0,0,0.32)',
          }}
        >
          {/* Diamond caps on each end of the ribbon. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: '50%',
              left: '-0.55rem',
              width: '1.1rem',
              height: '1.1rem',
              background: '#e9ad29',
              transform: 'translateY(-50%) rotate(45deg)',
              boxShadow: 'inset 0 0 0 3px #6b2a05',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: '50%',
              right: '-0.55rem',
              width: '1.1rem',
              height: '1.1rem',
              background: '#e9ad29',
              transform: 'translateY(-50%) rotate(45deg)',
              boxShadow: 'inset 0 0 0 3px #6b2a05',
            }}
          />
          {boardName}
        </div>

        {/* Price plate — gold rounded card with the actual gem.webp
            asset + the price number. The hanging "GEMS" badge was
            removed per user request — the icon already conveys the
            currency and the prompt text ("100 Gems") spells it out. */}
        <div
          className="relative mx-auto flex items-center justify-center"
          style={{
            zIndex: 2,
            width: 'min(85%, 22rem)',
            height: 'clamp(5rem, 13vmin, 7rem)',
            marginBottom: 'clamp(1.2rem, 3.5vmin, 1.8rem)',
            borderRadius: '18px',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.55), transparent 38%), radial-gradient(circle at center, #fff0a5 0%, #f6ca62 60%, #c88022 100%)',
            border: '4px solid #e39a19',
            boxShadow:
              '0 0 0 2px #ffdc60, 0 8px 14px rgba(0,0,0,0.35), inset 0 3px 0 rgba(255,255,255,0.65), inset 0 -5px 0 rgba(107,48,8,0.22)',
            gap: 'clamp(1rem, 3vmin, 2rem)',
          }}
        >
          {/* Sheen highlight on the top-left of the plate */}
          <span
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: '8%',
              top: '14%',
              width: '40%',
              height: '22%',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.45)',
              filter: 'blur(6px)',
            }}
          />

          <img
            src="/lobby/carousel/gem.webp"
            alt=""
            draggable={false}
            style={{
              width: 'clamp(3rem, 8vmin, 4.5rem)',
              height: 'clamp(3rem, 8vmin, 4.5rem)',
              objectFit: 'contain',
              filter:
                'drop-shadow(0 6px 4px rgba(0,0,0,0.35)) drop-shadow(0 0 10px rgba(0,210,255,0.5))',
            }}
          />
          <span
            className="font-display tabular-nums"
            style={{
              fontSize: 'clamp(2.6rem, 8vmin, 4rem)',
              fontWeight: 900,
              color: '#3c1704',
              lineHeight: 1,
              textShadow:
                '0 2px 0 #fff3ad, 0 5px 6px rgba(0,0,0,0.28)',
            }}
          >
            {priceGems.toLocaleString()}
          </span>
        </div>

        {/* Confirmation prompt. */}
        <p
          className="relative font-bold"
          style={{
            zIndex: 2,
            margin: 0,
            marginBottom: 'clamp(0.8rem, 2vmin, 1.2rem)',
            fontSize: 'clamp(0.9rem, 2.6vmin, 1.2rem)',
            color: '#572607',
            textShadow: '0 1px 0 rgba(255,255,255,0.35)',
          }}
        >
          Would you like to unlock for{' '}
          <strong style={{ fontWeight: 900 }}>{priceGems.toLocaleString()} Gems?</strong>
        </p>

        {/* Decorative divider with the ✤ glyph in the centre. */}
        <div
          className="relative mx-auto"
          style={{
            zIndex: 2,
            width: '80%',
            marginBottom: 'clamp(0.8rem, 2vmin, 1.2rem)',
            color: 'rgba(146,70,12,0.6)',
            fontSize: 'clamp(1rem, 3vmin, 1.4rem)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <span
            style={{
              flex: 1,
              height: '2px',
              background:
                'linear-gradient(90deg, transparent, rgba(146,70,12,0.55), transparent)',
            }}
          />
          <span>✤</span>
          <span
            style={{
              flex: 1,
              height: '2px',
              background:
                'linear-gradient(90deg, transparent, rgba(146,70,12,0.55), transparent)',
            }}
          />
        </div>

        {/* Error message (RPC failures). */}
        {errorMessage ? (
          <div
            className="relative mx-auto"
            style={{
              zIndex: 2,
              maxWidth: '85%',
              marginBottom: 'clamp(0.8rem, 2vmin, 1.2rem)',
              borderRadius: '8px',
              border: '1px solid rgba(190,18,60,0.4)',
              background: '#fff1f1',
              padding: '0.5rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#9f1239',
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        {/* Yes / No buttons — re-styled to match the green PLAY
            button on the lobby board carousel (.lobby-play-button in
            index.css). Yes uses the same green/lime gradient stack,
            No uses the same shape but a charcoal palette. Pill
            shape, dual-layer background (top white-sheen overlay +
            base gradient), thin lime/grey rim, chunky 3D drop-shadow
            that compresses on press. */}
        <div
          className="relative flex justify-center"
          style={{ zIndex: 2, gap: 'clamp(1.5rem, 5vmin, 3rem)' }}
        >
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onConfirm}
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem, 22vmin, 9rem)',
              height: 'clamp(2.8rem, 7vmin, 3.4rem)',
              borderRadius: '9999px',
              border: '2px solid rgba(224,255,143,0.95)',
              color: '#132109',
              fontSize: 'clamp(1.2rem, 3.6vmin, 1.7rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow: '0 1px 0 rgba(255,255,255,0.28)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(191,255,88,0.86) 13%, transparent 39%), linear-gradient(180deg, #d6ff73 0%, #8cf244 40%, #20bd1f 68%, #07810d 100%)',
              boxShadow:
                '0 5px 0 #06450a, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.74), inset 0 -5px 0 rgba(0,78,5,0.34), 0 0 0 2px rgba(7,27,11,0.85)',
            }}
          >
            {isPurchasing ? '…' : 'Yes'}
          </button>
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onCancel}
            className="font-display transition active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem, 22vmin, 9rem)',
              height: 'clamp(2.8rem, 7vmin, 3.4rem)',
              borderRadius: '9999px',
              border: '2px solid rgba(220,220,220,0.95)',
              color: '#1a1a1a',
              fontSize: 'clamp(1.2rem, 3.6vmin, 1.7rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow: '0 1px 0 rgba(255,255,255,0.4)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(210,210,210,0.86) 13%, transparent 39%), linear-gradient(180deg, #e2e2e2 0%, #a8a8a8 40%, #6a6a6a 68%, #3a3a3a 100%)',
              boxShadow:
                '0 5px 0 #1f1f1f, 0 13px 22px rgba(0,0,0,0.34), inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -5px 0 rgba(0,0,0,0.28), 0 0 0 2px rgba(15,15,15,0.85)',
            }}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
