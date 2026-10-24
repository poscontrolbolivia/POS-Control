import { useIdioma } from '../../../i18n/index.jsx'
import { presentacionesActivas, unidadesCompatibles } from '../../../services/inventario.js'

// Cantidad de 3 decimales (numeric(12,3)): admite coma o punto.
export const limpiarCant = txt => {
  const s = String(txt ?? '').replace(/[^0-9.,]/g, '').replace(',', '.')
  const m = s.match(/^\d*\.?\d{0,3}/)
  return m ? m[0] : ''
}

// Opciones de unidad para escribir una cantidad de un insumo: su unidad base, sus presentaciones
// activas y las unidades compatibles (kg si la base es g, l si es ml).
export function opcionesUnidad(ins, { conPresentaciones = true } = {}) {
  const base = ins?.unidad || ''
  const o = [{ v: 'base', t: base || 'unidad' }]
  if (conPresentaciones) for (const p of presentacionesActivas(ins)) o.push({ v: 'p:' + p.id, t: p.nombre })
  for (const u of unidadesCompatibles(base)) o.push({ v: 'u:' + u, t: u })
  return o
}

export default function CantidadUnidad({ ins, etiqueta, valor, sel, onValor, onSel, conPresentaciones = true, autoFocus = false, name = 'cantidad', disabled = false }) {
  const { tOr } = useIdioma()
  const opts = opcionesUnidad(ins, { conPresentaciones })
  const actual = opts.some(o => o.v === sel) ? sel : 'base'
  return (
    <div className="inv-cu">
      <label className="adm-campo">
        <span>{etiqueta}</span>
        <input name={name} autoFocus={autoFocus} type="text" inputMode="decimal" autoComplete="off" value={valor} disabled={disabled}
          onChange={e => onValor(limpiarCant(e.target.value))} onFocus={e => e.target.select()} placeholder="0" />
      </label>
      <label className="adm-campo inv-cu-sel">
        <span>{tOr('inventario.enUnidad', 'En')}</span>
        <select name={name + '-unidad'} value={actual} disabled={disabled} onChange={e => onSel(e.target.value)}>
          {opts.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select>
      </label>
    </div>
  )
}
