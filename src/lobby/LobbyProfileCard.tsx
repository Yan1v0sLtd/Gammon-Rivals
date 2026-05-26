import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import type { ProfileProgression } from '../lib/progression';
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface LobbyProfileCardProps {
  readonly profile: ProfileRow | null;
  readonly progression: ProfileProgression;
}

/**
 * Compact profile card for the lobby top-bar. Visual structure
 * (`lobby-pp-*` classes in index.css):
 *
 *   ┌─────────────────────────────────────────┐
 *   │  ┌───────┐    NAME                      │
 *   │  │ avatar│    ★ RANK                    │
 *   │  │ + lvl │    LEVEL N    LEVEL N+1      │
 *   │  │ shield│    ▓▓░░░░░░░ XP / max XP     │
 *   │  └───────┘                              │
 *   └─────────────────────────────────────────┘
 *
 * The card has no frame chrome — just a soft radial gradient
 * backdrop that fades to transparent at the edges (CSS mask
 * matches the gradient so backdrop-blur doesn't paint a hard
 * rectangle). XP bar is the only element with a visible border.
 *
 * Stats panel (Highest Win / Daily Streak / Win Rate) lived here
 * previously; removed per operator direction. The data hook
 * `useLobbyProfileStats` + its RPC stay in the codebase so the
 * panel can be reattached if needed.
 *
 * The whole card is an anchor to `/profile` so a tap navigates,
 * matching the original widget's behavior.
 */
export function LobbyProfileCard({
  profile,
  progression,
}: LobbyProfileCardProps) {
  const name = profile?.display_name?.trim() || 'Player';

  // XP text: `<currentIntoLevel> / <span>` so the numerator/denominator
  // match the bar's fill calculation. When the player is at the top of
  // the configured ladder (`nextLevelXp === null`) we fall back to the
  // total XP value with "MAX" labelling.
  const span = progression.nextLevelXp !== null
    ? Math.max(1, progression.nextLevelXp - progression.currentLevelXp)
    : 0;
  const xpIntoLevel = progression.xpIntoLevel;
  const isMaxLevel = progression.nextLevelXp === null;

  const nextLevel = progression.nextLevelReward?.level ?? progression.level + 1;

  return (
    <Link
      to="/profile"
      aria-label="Open profile"
      className="lobby-pp-card group"
      data-fly-target="xp"
    >
      <span className="lobby-pp-shine" aria-hidden="true" />

      <div className="lobby-pp-content">
        {/* Identity column — JUST the avatar + level shield. Name and
            rank moved to the top of the main column so the whole text
            stack reads vertically (name → rank → level → bar). */}
        <div className="lobby-pp-identity">
          <div className="lobby-pp-avatar-wrap">
            <div className="lobby-pp-avatar-ring">
              <span className="lobby-pp-spark s1" aria-hidden="true" />
              <span className="lobby-pp-spark s2" aria-hidden="true" />

              <div className="lobby-pp-avatar-img">
                <Avatar
                  seed={profile?.avatar_seed ?? 'guest'}
                  imageUrl={profile?.avatar_url}
                  size={240}
                  ring="none"
                />
              </div>

              <div className="lobby-pp-shield">
                <span>{progression.level}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="lobby-pp-main">
          <h1 className="lobby-pp-name">{name}</h1>
          <div className="lobby-pp-rank" aria-label={`Rank ${progression.statusLabel}`}>
            <div className="lobby-pp-rank-badge" aria-hidden="true">★</div>
            <div className="lobby-pp-rank-text">{progression.statusLabel.toUpperCase()}</div>
          </div>

          <section className="lobby-pp-xp-card" aria-label="Level progress">
            <div className="lobby-pp-xp-row">
              <span>LEVEL {progression.level}</span>
              <span className="lobby-pp-xp-arrow" aria-hidden="true">›</span>
              <span className="lobby-pp-xp-next">
                {isMaxLevel ? 'MAX' : `LEVEL ${nextLevel}`}
              </span>
            </div>

            <div className="lobby-pp-xp-bar">
              <div
                className="lobby-pp-xp-fill"
                style={{ width: `${Math.max(0, Math.min(100, progression.progressPercent))}%` }}
              >
                {/* Decorative bubbles flowing inside the filled
                    portion. Two layers (slow + fast) — see CSS
                    `lobby-pp-xp-fill-bubbles` + its ::after pseudo.
                    Ported from the legacy `.lobby-profile-progress-
                    bubbles` so the new bar gets the same lava-flow
                    feel as the old skinny bar. */}
                <span className="lobby-pp-xp-fill-bubbles" aria-hidden="true" />
              </div>
              {/* Wrap text in a single span so the surrounding flex
                  container treats it as ONE centered child. Without
                  the wrapper, fragment-style children (the <b> and
                  the trailing text node) become separate flex items
                  that can wrap and look odd. */}
              <div className="lobby-pp-xp-text">
                <span>
                  {isMaxLevel ? (
                    <>
                      <b>{progression.xp.toLocaleString()}</b>&nbsp;XP
                    </>
                  ) : (
                    <>
                      <b>{xpIntoLevel.toLocaleString()}</b>
                      &nbsp;/ {span.toLocaleString()} XP
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* "Next Reward: 🪙 N Coins" line removed per operator
                direction — the level reward is still surfaced on
                level-up promotion, the profile card stays minimal. */}
          </section>
        </div>
      </div>
    </Link>
  );
}
