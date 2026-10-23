import { useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { useMoneda } from '../../../services/money.js'
import { cumple, maxDe, extraDe, notaDeUnidad } from '../../../services/indicaciones.js'
import './OrderPanel.css'

const nuevaUnidad = () => ({ sel: {}, texto: '' })
const completa = (listas, u) => listas.every(l => cumple(l, u.sel[l.id]))
// Índice del primer grupo de opciones que aún no está bien para esa unidad (-1 si ya está completa).
const primeraPendiente = (listas, u, desde = 0) => {
  for (let k = 0; k < listas.length; k++) { const i = (desde + k) % listas.length; if (!cumple(listas[i], u.sel[listas[i].id])) return i }
  return -1
}

// Las listas de indicaciones del plato, una por vez: con tres o cuatro grupos a la vez no se sabía
// qué se estaba editando. Lo usa el pedido de mesa y la venta directa, para que en el mostrador
// tampoco se pueda saltar una lista obligatoria.
export default function IndicacionesPrevio({ producto, listas, onClose, onConfirm }) {
  const { t, tOr } = useIdioma()
  const { money: m } = useMoneda()
  const [estado, setEstado] = useState(() => ({
    unidades: [nuevaUnidad()], foco: 0, li: Math.max(0, primeraPendiente(listas, nuevaUnidad())),
  }))
  const { unidades, foco, li } = estado
  const listaActiva = listas[Math.min(Math.max(0, li), listas.length - 1)]
  const todas = unidades.every(u => completa(listas, u))
  const elegido = listas.map(l => {
    const sel = (unidades[foco] || unidades[0])?.sel[l.id] || []
    return sel.length ? (l.legacy ? '' : l.nombre + ': ') + sel.join(', ') : ''
  }).filter(Boolean).join(' · ')

  const cambiarCantidad = dq => setEstado(v => {
    const n = Math.min(30, Math.max(1, v.unidades.length + dq))
    const nuevas = n > v.unidades.length ? [...v.unidades, ...Array.from({ length: n - v.unidades.length }, nuevaUnidad)] : v.unidades.slice(0, n)
    const f = Math.min(v.foco, n - 1)
    return { ...v, unidades: nuevas, foco: f, li: Math.max(0, primeraPendiente(listas, nuevas[f], v.li)) }
  })
  // Toca una opción: actúa sobre la unidad en foco y sobre EL grupo que se está editando.
  // Cuando ese grupo queda bien, salta al siguiente pendiente; si era el último, pasa a la siguiente unidad.
  const tocarOpcion = (lista, o) => setEstado(v => {
    const u = v.unidades.map((x, i) => {
      if (i !== v.foco) return x
      const act = x.sel[lista.id] || []
      let nuevo
      if (act.includes(o)) nuevo = act.filter(z => z !== o)
      else if (maxDe(lista) === 1) nuevo = [o]
      else nuevo = act.length >= maxDe(lista) ? act : [...act, o]
      return { ...x, sel: { ...x.sel, [lista.id]: nuevo } }
    })
    let foco = v.foco
    let li = v.li
    if (completa([lista], u[foco])) {
      const sig = primeraPendiente(listas, u[foco], v.li + 1)
      if (sig >= 0) li = sig
      else {
        const sigU = u.findIndex((x, i) => i !== foco && !completa(listas, x))
        if (sigU >= 0) { foco = sigU; li = Math.max(0, primeraPendiente(listas, u[foco])) }
      }
    }
    return { unidades: u, foco, li }
  })

  return (
    <div className="pm-previa-fondo" onClick={onClose}>
      <div className="pm-previa" role="dialog" aria-label={producto.nombre} onClick={e => e.stopPropagation()}>
        <div className="pm-cant">
          <b>{producto.nombre}</b>
          <span className="pm-cant-ctl">
            <button type="button" className="ghost" aria-label="−" disabled={unidades.length <= 1} onClick={() => cambiarCantidad(-1)}>−</button>
            <output aria-live="polite">{unidades.length}</output>
            <button type="button" className="ghost" aria-label="+" onClick={() => cambiarCantidad(1)}>+</button>
          </span>
        </div>
        {unidades.length > 1 && (
          <div className="pm-unidades" role="tablist">
            {unidades.map((u, i) => (
              <button key={i} type="button" role="tab" aria-selected={foco === i}
                className={'tab' + (foco === i ? ' on' : '') + (completa(listas, u) ? ' ok' : '')}
                onClick={() => setEstado(v => ({ ...v, foco: i, li: Math.max(0, primeraPendiente(listas, v.unidades[i])) }))}>
                {i + 1}{completa(listas, u) ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}
        {listas.length > 1 && (
          <div className="pm-listas" role="tablist">
            {listas.map((l, k) => (
              <button key={l.id} type="button" role="tab" aria-selected={k === li}
                className={'tab' + (k === li ? ' on' : '') + (cumple(l, (unidades[foco] || unidades[0]).sel[l.id]) ? ' ok' : '')}
                onClick={() => setEstado(v => ({ ...v, li: k }))}>
                {l.legacy ? tOr('indic.opciones', 'Opciones') : l.nombre}{cumple(l, (unidades[foco] || unidades[0]).sel[l.id]) ? ' ✓' : ''}{l.obligatoria ? ' *' : ''}
              </button>
            ))}
          </div>
        )}
        {elegido && <small className="pm-elegido">{tOr('indic.elegido', 'Elegido')}: {elegido}</small>}
        {listaActiva && (
          <div className="pm-lista">
            {!listaActiva.legacy && (
              <small className="pm-lista-tit">
                {listaActiva.nombre}{listaActiva.obligatoria ? ' *' : ''}
                {maxDe(listaActiva) !== Infinity && maxDe(listaActiva) > 1 ? ` · ${t('indic.hasta', { n: maxDe(listaActiva) })}` : ''}
                {unidades.length > 1 ? ` · ${t('indic.unidadN', { n: foco + 1 })}` : ''}
              </small>
            )}
            <div className="pm-opciones">
              {listaActiva.opciones.map(o => {
                const act = (unidades[foco] || unidades[0]).sel[listaActiva.id] || []
                return <button key={o} type="button" className={'tab' + (act.includes(o) ? ' on' : '')} onClick={() => tocarOpcion(listaActiva, o)}>{o}{extraDe(listaActiva, o) > 0 ? ` +${m(extraDe(listaActiva, o))}` : ''}</button>
              })}
            </div>
          </div>
        )}
        <input name="nota-extra" value={unidades[foco].texto} maxLength={60} placeholder={t('pedido.notaExtra')}
          onChange={e => setEstado(v => ({ ...v, unidades: v.unidades.map((u, i) => (i === v.foco ? { ...u, texto: e.target.value } : u)) }))} />
        {!todas && <small className="pm-falta">{t('indic.faltan')}</small>}
        <div className="barra" style={{ margin: 0 }}>
          <button type="button" className="success" disabled={!todas} onClick={() => onConfirm(unidades)}>{t('indic.agregar', { n: unidades.length })}</button>
          <button type="button" className="danger" onClick={onClose}>{t('comun.cancelar')}</button>
        </div>
      </div>
    </div>
  )
}
