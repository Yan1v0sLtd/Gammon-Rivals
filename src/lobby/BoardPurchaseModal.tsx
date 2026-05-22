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
            from the reference (gold-on-cream-on-brown stack). */}
        <h2
          className="relative font-display"
          style={{
            zIndex: 2,
            margin: 0,
            marginBottom: 'clamp(0.8rem, 2vmin, 1.2rem)',
            fontSize: 'clamp(1.6rem, 5.5vmin, 2.5rem)',
            fontWeight: 900,
            letterSpacing: '0.04em',
            color: '#ffd45f',
            textShadow:
              '0 2px 0 #fff2a6, 0 4px 0 #9a4708, 0 7px 0 #5d2605, 0 10px 12px rgba(0,0,0,0.45)',
          }}
        >
          <span style={{ fontSize: '0.65em', margin: '0 0.6rem', color: '#ffdf69' }}>
            ✦
          </span>
          UNLOCK BOARD
          <span style={{ fontSize: '0.65em', margin: '0 0.6rem', color: '#ffdf69' }}>
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
            asset, the price number, and a "GEMS" label hanging below. */}
        <div
          className="relative mx-auto flex items-center justify-center"
          style={{
            zIndex: 2,
            width: 'min(85%, 22rem)',
            height: 'clamp(5.5rem, 14vmin, 7.5rem)',
            marginBottom: 'clamp(2rem, 5vmin, 3rem)',
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

          {/* Blue "GEMS" badge hanging off the bottom edge of the plate. */}
          <span
            className="absolute font-display"
            style={{
              left: '50%',
              bottom: '-1.05rem',
              transform: 'translateX(-50%)',
              minWidth: '8rem',
              height: 'clamp(1.8rem, 4.6vmin, 2.4rem)',
              padding: '0 1rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              background:
                'linear-gradient(#0588d9, #004493 70%, #002d67)',
              border: '2px solid #e9ad29',
              color: 'white',
              fontSize: 'clamp(0.85rem, 2.4vmin, 1.1rem)',
              fontWeight: 900,
              letterSpacing: '0.08em',
              textShadow: '0 2px 0 #002656',
              boxShadow:
                '0 4px 0 #693006, inset 0 2px 0 rgba(255,255,255,0.35)',
            }}
          >
            GEMS
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

        {/* Yes / No buttons. Gold gradient + dark gradient with
            chunky 3D drop-shadows that compress on press. */}
        <div className="relative flex justify-center" style={{ zIndex: 2, gap: 'clamp(1.5rem, 5vmin, 3rem)' }}>
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onConfirm}
            className="font-display transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem, 22vmin, 9rem)',
              height: 'clamp(2.8rem, 7vmin, 3.6rem)',
              borderRadius: '14px',
              border: '4px solid #ffd65b',
              color: 'white',
              fontSize: 'clamp(1.2rem, 3.6vmin, 1.8rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow:
                '0 3px 0 rgba(0,0,0,0.45), 0 5px 8px rgba(0,0,0,0.3)',
              background:
                'linear-gradient(#fff06c 0%, #ffb31c 34%, #fb7212 62%, #d92f08 100%)',
              boxShadow:
                '0 6px 0 #6b2c06, 0 12px 16px rgba(0,0,0,0.35), inset 0 4px 0 rgba(255,255,255,0.45), inset 0 -5px 0 rgba(0,0,0,0.22)',
            }}
          >
            {isPurchasing ? '…' : 'Yes'}
          </button>
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onCancel}
            className="font-display transition active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              width: 'clamp(7rem, 22vmin, 9rem)',
              height: 'clamp(2.8rem, 7vmin, 3.6rem)',
              borderRadius: '14px',
              border: '4px solid #ffd65b',
              color: 'white',
              fontSize: 'clamp(1.2rem, 3.6vmin, 1.8rem)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textShadow:
                '0 3px 0 rgba(0,0,0,0.45), 0 5px 8px rgba(0,0,0,0.3)',
              background: 'linear-gradient(#686868 0%, #373737 45%, #171717 100%)',
              boxShadow:
                '0 6px 0 #6b2c06, 0 12px 16px rgba(0,0,0,0.35), inset 0 4px 0 rgba(255,255,255,0.35), inset 0 -5px 0 rgba(0,0,0,0.4)',
            }}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
