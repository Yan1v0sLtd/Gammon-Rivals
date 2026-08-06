import type {ReactNode} from "react"

export function SectionTitle({
  children,
  compact = false,
}: {children: ReactNode, compact?: boolean}) {
  // `compact` shrinks the title (smaller font + tighter tracking + no-wrap) so a
  // long label like "Featured Pack" stays on one line in the narrow column. The
  // fixed height keeps both section titles the same height even at different font
  // sizes, so the bundle and the packs grid below them start (and end) level.
  return (<h2
    className={`mb-8 flex h-10 items-center justify-center gap-3 font-display font-black uppercase leading-none text-[#ffc93d] ${compact ? "whitespace-nowrap text-[1.5rem] tracking-[0.12em]" : "text-[2.4rem] tracking-[0.26em]"}`}>
    <span className={compact ? "text-sm" : "text-xl"}>✦</span>
    {children}
    <span className={compact ? "text-sm" : "text-xl"}>✦</span>
  </h2>)
}
