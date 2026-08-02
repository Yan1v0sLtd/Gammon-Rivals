import {avatarUrl} from '../lib/identity';

interface Props {
  /** The seed used to deterministically generate the avatar. */
  seed: string;
  /** Optional account avatar image, such as a Google profile photo. */
  imageUrl?: string | null;
  /** Pixel size of the rendered circle. Defaults to 64. */
  size?: number;
  /** Optional ring colour for the active player. */
  ring?: 'active' | 'idle' | 'none';
  /** Optional small badge — country flag, AI pill, etc. */
  badge?: React.ReactNode;
  className?: string;
}

const RING_CLASS: Record<NonNullable<Props['ring']>, string> = {
  active: 'ring-[3px] ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]',
  idle: 'ring-2 ring-amber-900/60',
  none: '',
};

/**
 * Round avatar rendered from a DiceBear seed. Loads the SVG from the
 * DiceBear API directly — no proxy or local image needed. The avatar
 * itself is generated; we layer a coloured ring + optional badge on top.
 */
export default function Avatar({
  seed,
  imageUrl,
  size = 64,
  ring = 'idle',
  badge,
  className = '',
}: Props) {
  const ringClass = RING_CLASS[ring];
  return (<div
    className={`relative inline-block rounded-full overflow-visible ${className}`}
    style={{
      width: size,
      height: size
    }}
  >
    <img
      src={imageUrl || avatarUrl(seed, size * 2)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={`block w-full h-full rounded-full object-cover bg-amber-900/40 ${ringClass}`}
    />
    {badge !== undefined && (<span
      className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-700 text-amber-50 text-[10px] font-display tracking-wider border border-amber-900/80 shadow">
          {badge}
        </span>)}
  </div>);
}
