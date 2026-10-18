import { useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { getColumnPrefs, saveColumnWidths, startColumnResize, resizeEndedRecently } from '../../services/columnPrefs'
import '../../styles/DataTable.css'

function rawSortValue(col, row) {
  if (col.sortValue) return col.sortValue(row)
  if (row && Object.prototype.hasOwnProperty.call(row, col.key)) return row[col.key]
  return null
}

function compareValues(a, b) {
  const an = typeof a === 'number' ? a : (a !== null && a !== '' && !isNaN(a)) ? Number(a) : null
  const bn = typeof b === 'number' ? b : (b !== null && b !== '' && !isNaN(b)) ? Number(b) : null
  if (an !== null && bn !== null) return an - bn
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base', numeric: true })
}

export default function DataTable({ columns, rows, getRowId = (r) => r.id, search, onSearchChange, searchPlaceholder, emptyText, resizeGroup, userId }) {
  const { tOr } = useIdioma()
  const [colPrefs, setColPrefs] = useState(() => (resizeGroup ? getColumnPrefs(userId, resizeGroup) : { widths: {} }))
  const [sort, setSort] = useState(null)

  const widths = colPrefs.widths || {}

  function toggleSort(key) {
    if (resizeEndedRecently()) return;
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const sortedRows = (() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const withValue = rows.map((row, i) => ({ row, i, value: rawSortValue(col, row) }))
    withValue.sort((a, b) => {
      const cmp = compareValues(a.value, b.value)
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp
      return a.i - b.i
    })
    return withValue.map((x) => x.row)
  })()

  function startResize(e, key) {
    e.stopPropagation()
    startColumnResize(e, key, (k, finalWidth) => {
      setColPrefs((prev) => {
        const next = { ...prev, widths: { ...prev.widths, [k]: finalWidth } }
        if (resizeGroup) saveColumnWidths(userId, resizeGroup, next.widths)
        return next
      })
    })
  }

  return (
    <>
      {onSearchChange && (
        <div className="dt-toolbar">
          <input className="dt-search" type="search" autoComplete="off"
            placeholder={searchPlaceholder || tOr('datatable.buscarPista', 'Buscar…')}
            value={search ?? ''} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
      )}
      <div className="sheet">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={widths[c.key] ? { width: widths[c.key] } : undefined}
                  className={c.sortable === false ? '' : 'th-sortable'}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? c.label : (
                    <button type="button" className="th-sort-btn" onClick={() => toggleSort(c.key)}
                      title={tOr('datatable.ordenar', 'Ordenar por esta columna')}>
                      {c.label}
                      <span className="th-sort-icon">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                    </button>
                  )}
                  <span className="col-resize-handle" onPointerDown={(e) => startResize(e, c.key)}
                    title={tOr('datatable.arrastrar', 'Arrastra para ajustar el ancho')} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={getRowId(row)}>{columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}</tr>
            )) : (
              <tr><td colSpan={columns.length} className="empty">{emptyText || tOr('datatable.sinRegistros', 'Sin registros')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
