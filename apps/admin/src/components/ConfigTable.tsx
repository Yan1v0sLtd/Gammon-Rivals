import {EmptyState} from "./EmptyState"

export function ConfigTable({
  title,
  rows,
  onRowClick,
}: {
  title: string, rows: string[][], onRowClick?(index: number): void,
}) {
  return (<div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.045]">
    <div className="border-b border-white/10 px-4 py-3">
      <h2 className="text-lg font-black">{title}</h2>
    </div>
    {rows.length === 0 ? (<EmptyState text={`No ${title.toLowerCase()} found.`}/>) : (<div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/10 text-sm">
        <tbody className="divide-y divide-white/10">
          {rows.map((row, index) => (<tr
            key={`${title}-${row.join("|")}`}
            className={`${onRowClick ? "cursor-pointer hover:bg-white/[0.055]" : ""} text-white/70 transition`}
            onClick={() => onRowClick?.(index)}>
            {row.map((cell, cellIndex) => (<td
              key={`${title}-${row.join("|")}-${cell}`}
              className={`px-4 py-3 ${cellIndex === 0 ? "font-bold text-white" : "text-white/55"}`}>
              <div className="max-w-[18rem] truncate">{cell}</div>
            </td>))}
          </tr>))}
        </tbody>
      </table>
    </div>)}
  </div>)
}
