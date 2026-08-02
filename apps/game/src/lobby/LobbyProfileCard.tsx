import {Link} from 'react-router-dom';
import Avatar from '../components/Avatar';
import type {ProfileProgression} from '../../../../packages/shared/src/progression';
import type {Database} from '../../../../packages/shared/src/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface LobbyProfileCardProps {
  readonly profile: ProfileRow | null;
  readonly progression: ProfileProgression;
}

/**
 * Minimal lobby top-bar profile widget: just the avatar (with level
 * shield) and, directly below it, the XP progress bar sized to the
 * avatar's circle. Name, rank and the LEVEL → LEVEL row were removed from
 * the lobby per operator direction — those details live on the /profile
 * page, which this widget links to.
 */
export function LobbyProfileCard({
  profile,
  progression
}: LobbyProfileCardProps) {
  return (<Link
    to="/profile"
    aria-label="Open profile"
    className="lobby-pp-card group"
    data-fly-target="xp"
  >
    <span className="lobby-pp-shine" aria-hidden="true"/>

    <div className="lobby-pp-content">
      <div className="lobby-pp-identity">
        <div className="lobby-pp-avatar-wrap">
          <div className="lobby-pp-avatar-ring">
            <span className="lobby-pp-spark s1" aria-hidden="true"/>
            <span className="lobby-pp-spark s2" aria-hidden="true"/>

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

      {/* XP bar — directly below the avatar, sized to the avatar circle
            (see .lobby-pp-content + .lobby-pp-xp-bar in index.css). It's the
            only text element left in the card. */}
      <div className="lobby-pp-xp-bar" aria-label="Level progress">
        <div
          className="lobby-pp-xp-fill"
          style={{width: `${Math.max(0, Math.min(100, progression.progressPercent))}%`}}
        >
          <span className="lobby-pp-xp-fill-bubbles" aria-hidden="true"/>
        </div>
        <div className="lobby-pp-xp-text">
          <span>{progression.xpBarLabel}</span>
        </div>
      </div>
    </div>
  </Link>);
}
