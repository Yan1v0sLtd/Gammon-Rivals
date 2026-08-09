import type {ReactNode} from "react"

export function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode, onClick(): void, disabled?: boolean,
}) {
  return (<button
    className="rounded-lg border border-rose-300/30 bg-rose-500/16 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
