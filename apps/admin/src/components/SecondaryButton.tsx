import type {ReactNode} from "react"

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode, onClick(): void, disabled?: boolean,
}) {
  return (<button
    className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/75 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
