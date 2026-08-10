import styles from "./ConfigTable.module.css"
import {EmptyState} from "./EmptyState"

export function ConfigTable({
  title,
  rows,
  onRowClick,
}: {
  title: string,
  rows: string[][],
  onRowClick?(index: number): void,
}) {
  return (<div className={styles.tableCard}>
    <div className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
    </div>
    {rows.length === 0 ? (<EmptyState text={`No ${title.toLowerCase()} found.`}/>) : (<div className={styles.scrollX}>
      <table className={styles.table}>
        <tbody>
          {rows.map((row, index) => (<tr
            key={`${title}-${row.join("|")}`}
            className={`${styles.row}${onRowClick ? ` ${styles.clickable}` : ""}`}
            onClick={() => onRowClick?.(index)}>
            {row.map((cell, cellIndex) => (<td
              key={`${title}-${row.join("|")}-${cell}`}
              className={`${styles.cell} ${cellIndex === 0 ? styles.cellFirst : styles.cellRest}`}>
              <div className={styles.cellText}>{cell}</div>
            </td>))}
          </tr>))}
        </tbody>
      </table>
    </div>)}
  </div>)
}
