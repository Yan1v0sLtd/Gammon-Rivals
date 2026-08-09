import type {ReactNode} from "react"

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode, onClick(): void, disabled?: boolean,
}) {
  return (<button
    className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-[#1b1202] shadow-lg shadow-amber-900/20 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    onClick={onClick}>
    {children}
  </button>)
}
