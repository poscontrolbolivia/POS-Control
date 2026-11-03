import { useEffect, useMemo, useRef, useState } from 'react'
import { totalFinal } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { puede } from '../../../services/permissions.js'
import { cuentasCerradasDeMesa } from '../../../services/db.js'
import ReabrirForm from '../cash/ReabrirForm.jsx'
import { aMs, etiquetaMesa } from './calculos.js'

// Cuentas cerradas de la mesa elegida en el mapa (o de «Para llevar» / «Mostrador») dentro del periodo,
// cada una con su botón para reabrirla: devolución o error de cobro, sin pasar por Caja.
export default function CuentasMesa({ etiqueta, rango, s, modo, d, rol, usuario, m, onCambio }) {
  const { t, tOr } = useIdioma()
  const supa = modo === 'supabase'
  const [remotas, setRemotas] = useState(null)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [reabriendo, setReabriendo] = useState(null)
  const [ocultas, setOcultas] = useState(() => new Set())
  const [hecho, setHecho] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!supa) return undefined
    let vivo = true
    setRemotas(null); setError('')
    cuentasCerradasDeMesa({ empresaId: s._empresaId, desde: rango.desde, hasta: rango.hasta, etiqueta })
      .then(r => { if (vivo) setRemotas(r) })
      .catch(e => { if (vivo) { setRemotas([]); setError(e?.message || String(e)) } })
    return () => { vivo = false }
  }, [supa, etiqueta, rango.desde, rango.hasta, recarga, s._empresaId])

  const locales = useMemo(() => (supa ? [] : (s.cuentas || [])
    .filter(c => c.estado === 'cerrada' && aMs(c.cerradaEn) >= rango.desde && aMs(c.cerradaEn) <= rango.hasta && etiquetaMesa(s, c) === etiqueta)
    .sort((a, b) => aMs(b.cerradaEn) - aMs(a.cerradaEn))), [supa, s, rango.desde, rango.hasta, etiqueta])

  const filas = (supa ? remotas : locales)?.filter(c => !ocultas.has(c.id)) ?? null
  const nombreDe = c => c.tipo === 'directa'
    ? (c.canal === 'llevar' ? t('caja.llevarNumero', { n: c.numero ?? '—' }) + (c.clienteNombre ? ' · ' + c.clienteNombre : '') : t('caja.ventaNumero', { n: c.numero ?? '—' }))
    : `${etiqueta}${c.numero ? ' · #' + c.numero : ''}`
  const metodos = c => [...new Set((c.pagos || []).map(p => p.metodo).filter(Boolean))].map(k => tOr('reportes.metodo.' + k, k)).join(' + ')
  const cuando = c => new Date(aMs(c.cerradaEn)).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const confirmar = (c, { motivo, mesaIds }) => {
    d({ t: 'reabrir-cobrada', cuentaId: c.id, motivo, mesaIds, usuario })
    setReabriendo(null)
    setOcultas(prev => new Set(prev).add(c.id))
    setHecho(t('caja.reabrirHecho', { nombre: nombreDe(c) }))
    // Con Supabase el cobro se rehace en el servidor: pasado un momento se vuelve a leer la lista y los totales.
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setOcultas(new Set()); setRecarga(x => x + 1); onCambio?.() }, 4000)
  }

  return (
    <div className="rp-cuentas" aria-live="polite">
      <h4>🧾 {t('reportes.cuentasDe', { mesa: etiqueta })}</h4>
      {hecho && (
        <div className="rp-hecho" role="status">
          <span>{hecho}</span>
          <button type="button" className="ghost rp-btn" onClick={() => { window.location.hash = '#caja' }}>{t('reportes.irCaja')}</button>
          <button type="button" className="rp-filtro-x" onClick={() => setHecho('')} aria-label={t('comun.cancelar')}>✕</button>
        </div>
      )}
      {error && <p className="rp-nota" role="alert">⚠️ {t('reportes.cuentasError', { error })}</p>}
      {filas === null ? <p className="rp-nota">{tOr('reportes.cargando', 'Cargando…')}</p>
        : filas.length === 0 ? <p className="rp-nota">{t('reportes.cuentasVacia')}</p>
        : (
          <ul className="rp-cuentas-lista">
            {filas.map(c => (
              <li key={c.id}>
                <b>{nombreDe(c)}</b>
                <span className="rp-cuenta-cuando">{cuando(c)}</span>
                <span className="rp-cuenta-met">{metodos(c)}</span>
                <span className="sp" />
                <b>{m(totalFinal(c))}</b>
                {puede(rol, 'reabrir_cobrada') && reabriendo !== c.id && (
                  <button type="button" className="ghost rp-btn" onClick={() => setReabriendo(c.id)}>↺ {tOr('caja.reabrir', 'Reabrir')}</button>
                )}
                {reabriendo === c.id && <ReabrirForm cuenta={c} s={s} onConfirmar={r => confirmar(c, r)} onCancelar={() => setReabriendo(null)} />}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
