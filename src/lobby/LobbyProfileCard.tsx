import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { formatCompactNumber } from '../lib/format';
import type { ProfileProgression } from '../lib/progression';
import type { Database } from '../types/database';
import type { LobbyProfileStats } from './useLobbyProfileStats';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface LobbyProfileCardProps {
  readonly profile: ProfileRow | null;
  readonly progression: ProfileProgression;
  readonly stats: LobbyProfileStats | null;
}

/**
 * Premium profile card for the lobby top-bar. Replaces the old
 * compact `.lobby-profile-card` widget. Visual structure mirrors
 * the user-supplied reference (`lobby-pp-*` classes in index.css):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ shine line                                                │
 *   │ ┌───────────┐  ┌──────────────────────────────────────┐  │
 *   │ │           │  │ NAME                                 │  │
 *   │ │  avatar   │  │ ★ RANK                               │  │
 *   │ │   ring    │  │ ┌──────────────────────────────────┐ │  │
 *   │ │  + level  │  │ │ LEVEL N  ›  LEVEL N+1            │ │  │
 *   │ │   shield  │  │ │ ▓▓▓▓░░░░  XP / max XP            │ │  │
 *   │ │           │  │ │ Next Reward: 🪙 500 Coins         │ │  │
 *   │ └───────────┘  │ └──────────────────────────────────┘ │  │
 *   │ ┌──────────────────────────────────────────────────────┐  │
 *   │ │  🏆 Highest Win  │  🔥 Daily Streak  │  🎯 Win Rate │  │
 *   │ └──────────────────────────────────────────────────────┘  │
 *   └───────────────────────────────────────────────────────────┘
 *
 * The whole card is an anchor to `/profile` so a tap navigates,
 * matching the old widget's behavior. The settings gear from the
 * reference design is dropped because the existing top-bar
 * shortcuts already host Settings on the right side.
 */
export function LobbyProfileCard({
  profile,
  progression,
  stats,
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
  const nextRewardCoins = progression.nextLevelReward?.coins ?? 0;

  return (
    <Link
      to="/profile"
      aria-label="Open profile"
      className="lobby-pp-card group"
      data-fly-target="xp"
    >
      <span className="lobby-pp-shine" aria-hidden="true" />

      <div className="lobby-pp-content">
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
              />
              <div className="lobby-pp-xp-text">
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
              </div>
            </div>

            {isMaxLevel || nextRewardCoins <= 0 ? null : (
              <p className="lobby-pp-reward">
                Next Reward: <span className="lobby-pp-coin">♛</span>
                <b>&nbsp;{nextRewardCoins.toLocaleString()} Coins</b>
              </p>
            )}
          </section>
        </div>

        <section className="lobby-pp-stats" aria-label="Player statistics">
          <StatCell
            label="Highest Win"
            value={
              <>
                <span className="lobby-pp-coin" aria-hidden="true">♛</span>
                {formatCompactNumber(stats?.highestWin ?? 0)}
              </>
            }
            icon={<TrophyIcon />}
          />
          <StatCell
            label="Daily Streak"
            value={
              <>
                {stats?.streakDays ?? 0}
                <small>DAYS</small>
              </>
            }
            icon={<FireIcon />}
          />
          <StatCell
            label="Win Rate"
            value={
              <>
                {stats?.winRatePct ?? 0}
                <small>%</small>
              </>
            }
            icon={<TargetIcon />}
          />
        </section>
      </div>
    </Link>
  );
}

function StatCell({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly icon: React.ReactNode;
}) {
  return (
    <div className="lobby-pp-stat">
      <div className="lobby-pp-icon-disc">{icon}</div>
      <div className="lobby-pp-stat-body">
        <div className="lobby-pp-stat-label">{label}</div>
        <div className="lobby-pp-stat-value">{value}</div>
      </div>
    </div>
  );
}

/* Inline SVG icons — ported from the reference HTML so the discs
 * have the same vibe (gold trophy / orange fire / purple-and-gold
 * target). Kept inline (instead of as standalone files) because
 * each is small and lives only on this card. */
function TrophyIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="lobby-pp-gold" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff7a8" />
          <stop offset=".45" stopColor="#ffc21a" />
          <stop offset="1" stopColor="#d66c00" />
        </linearGradient>
      </defs>
      <path
        fill="url(#lobby-pp-gold)"
        d="M30 18h40v12h14c0 18-8 29-22 32-2 4-5 7-9 8v10h17v8H30v-8h17V70c-4-1-7-4-9-8-14-3-22-14-22-32h14V18zm-6 19c1 8 4 14 10 17-2-5-3-11-4-17h-6zm46 0c-1 7-2 12-4 17 6-3 9-9 10-17h-6z"
      />
    </svg>
  );
}

function FireIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="lobby-pp-fire" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff04a" />
          <stop offset=".45" stopColor="#ff9400" />
          <stop offset="1" stopColor="#ff3d00" />
        </linearGradient>
      </defs>
      <path
        fill="url(#lobby-pp-fire)"
        d="M51 88c-19 0-31-13-31-31 0-13 8-24 16-35 1 12 6 18 13 23-1-16 5-27 18-36 1 20 15 28 15 48 0 18-12 31-31 31z"
      />
      <path
        fill="#ffe75a"
        opacity=".9"
        d="M51 82c-9 0-15-7-15-16 0-8 5-14 10-20 1 8 4 12 9 15 0-9 3-16 10-22 1 13 8 17 8 28 0 9-7 15-22 15z"
      />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle fill="none" stroke="#f1e8ff" strokeWidth="9" strokeLinecap="round" cx="50" cy="50" r="26" />
      <path fill="#6c35e8" d="M50 33a17 17 0 1017 17H50V33z" />
      <circle fill="#2b145f" cx="50" cy="50" r="8" />
      <path fill="#ffd237" d="M65 27l7 7 10-3-3 10 7 7-14 4-18 18-6-6 18-18 4-14z" />
      <path
        stroke="#bca7ff"
        strokeWidth="5"
        strokeLinecap="round"
        d="M50 15v12M50 73v12M15 50h12M73 50h12"
      />
    </svg>
  );
}
