import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { useMoneda } from '../../../services/money.js'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import { MOTIVOS_MERMA, MOTIVO_ETIQUETA, resolverCantidad, resumenMerma } from '../../../services/inventario.js'
import CantidadUnidad from './CantidadUnidad.jsx'

const DIAS = [7, 30, 90]
let seq = 0
const filaNueva = () => ({ k: ++seq, insumoId: '', cantidad: '', sel: 'base', motivo: 'desecho', nota: '' })

// Registro rápido de varias mermas del día + resumen de merma por insumo y por día.
export default function MermasTab({ insumos, puedeGestionar, quien, enBase, locale, fmt, onCambio }) {
  const { s, d } = useStore()
  const { tOr } = useIdioma()
  const { moneda: MONEDA } = useMoneda()
  const [filas, setFilas] = useState(() => [filaNueva()])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [dias, setDias] = useState(7)
  const [datos, setDatos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [errRep, setErrRep] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const activos = useMemo(() => insumos.filter(i => i.activo !== false), [insumos])
  const porId = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos])
  const motivoTxt = m => tOr('inventario.motivo.' + m, MOTIVO_ETIQUETA[m] || m)

  const cargar = async () => {
    setCargando(true); setErrRep('')
    try {
      const r = await rpc('merma_listar', { p_dias: dias })
      setDatos(Array.isArray(r) ? r : [])
    } catch (e) { setErrRep(mensajeError(e)) } finally { setCargando(false) }
  }
  useEffect(() => { if (enBase) cargar() }, [enBase, dias]) // eslint-disable-line react-hooks/exhaustive-deps

  const filasReporte = useMemo(() => {
    if (enBase) return datos
    return (s.movimientos || []).filter(m => m.tipo === 'merma' || (m.tipo === 'entrada' && m.detalle?.merma_limpieza !== undefined))
      .map(m => ({ ...m, costo: porId.get(m.insumo_id)?.costo, unidad: m.unidad || porId.get(m.insumo_id)?.unidad }))
  }, [enBase, datos, s.movimientos, porId])
  const resumen = useMemo(() => resumenMerma(filasReporte, Date.now() - dias * 86400000), [filasReporte, dias])

  const cambiar = (k, campo, v) => { setFilas(f => f.map(x => (x.k === k ? { ...x, [campo]: v } : x))); setErr('') }

  const enviar = async e => {
    e.preventDefault()
    if (enviando || !puedeGestionar) return
    const llenas = filas.filter(f => f.insumoId || Number(f.cantidad) > 0)
    if (!llenas.length) { setErr(tOr('inventario.mermaVacia', 'Agrega al menos una merma.')); return }
    const lineas = []
    for (const f of llenas) {
      const ins = porId.get(f.insumoId)
      const r = ins ? resolverCantidad(ins, f.cantidad, f.sel) : null
      if (!ins || !(r.base > 0)) { setErr(tOr('inventario.mermaFila', 'Cada fila necesita un insumo y una cantidad mayor que 0.')); return }
      lineas.push({ ins, r, motivo: f.motivo, nota: f.nota.trim() })
    }
    setErr(''); setEnviando(true)
    try {
      if (enBase) {
        await rpc('insumo_mermas_registrar', { p_lineas: lineas.map(l => ({
          insumo_id: l.ins.id, motivo: l.motivo, nota: l.nota || null,
          ...(l.r.presId ? { presentacion_id: l.r.presId, cant_pres: l.r.cantPres } : { cantidad: l.r.base }),
        })) })
      } else {
        d({ t: 'insumo-mermas', usuario: quien, lineas: lineas.map(l => ({ id: l.ins.id, motivo: l.motivo, nota: l.nota,
          ...(l.r.presId ? { presId: l.r.presId, cantPres: l.r.cantPres } : { cantidad: l.r.base }) })) })
      }
      setFilas([filaNueva()])
      setOk(`${lineas.length} ${tOr('inventario.mermasOk', 'merma(s) registrada(s).')}`)
      clearTimeout(timer.current); timer.current = setTimeout(() => setOk(''), 5000)
      if (enBase) { await onCambio?.(); await cargar() }
    } catch (e2) { setErr(mensajeError(e2)) } finally { setEnviando(false) }
  }

  const fmtDia = k => { const x = new Date(k + 'T12:00:00'); return Number.isNaN(x.getTime()) ? k : x.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }) }
  const unid = r => r.unidad || ''

  return (
    <section className="adm-card inv-bloque">
      <div className="adm-card-cab"><h3>{tOr('inventario.mermasTitulo', 'Mermas')}</h3></div>

      {puedeGestionar && (
        <form className="inv-form" onSubmit={enviar}>
          <b>{tOr('inventario.mermaRapida', 'Registro rápido de mermas del día')}</b>
          {filas.map(f => {
            const ins = porId.get(f.insumoId)
            return (
              <div key={f.k} className="inv-merma-fila">
                <label className="adm-campo inv-merma-ins">
                  <span>{tOr('inventario.colInsumo', 'Insumo')}</span>
                  <select name="merma-insumo" value={f.insumoId} onChange={e => setFilas(fs => fs.map(x => (x.k === f.k ? { ...x, insumoId: e.target.value, sel: 'base' } : x)))}>
                    <option value="">{tOr('inventario.elegirInsumo', 'Elige un insumo')}</option>
                    {activos.map(i => <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>)}
                  </select>
                </label>
                <CantidadUnidad ins={ins} etiqueta={tOr('inventario.cantidad', 'Cantidad')} valor={f.cantidad} sel={f.sel}
                  onValor={v => cambiar(f.k, 'cantidad', v)} onSel={v => cambiar(f.k, 'sel', v)} name="merma-cantidad" />
                <label className="adm-campo">
                  <span>{tOr('inventario.motivoTitulo', 'Motivo')}</span>
                  <select name="merma-motivo" value={f.motivo} onChange={e => cambiar(f.k, 'motivo', e.target.value)}>
                    {MOTIVOS_MERMA.map(m => <option key={m} value={m}>{motivoTxt(m)}</option>)}
                  </select>
                </label>
                <label className="adm-campo inv-mov-nota">
                  <span>{tOr('inventario.nota', 'Nota')}</span>
                  <input name="merma-nota" type="text" value={f.nota} onChange={e => cambiar(f.k, 'nota', e.target.value)} />
                </label>
                {filas.length > 1 && (
                  <button type="button" className="danger" onClick={() => setFilas(fs => fs.filter(x => x.k !== f.k))}>✕ {tOr('inventario.quitarFila', 'Quitar')}</button>
                )}
              </div>
            )
          })}
          {err && <span className="adm-msg warn">{err}</span>}
          <div className="adm-fila">
            <button type="button" className="success" onClick={() => setFilas(f => [...f, filaNueva()])}>＋ {tOr('inventario.otraFila', 'Otra fila')}</button>
            <button type="submit" className="primary" disabled={enviando}>
              {enviando ? tOr('inventario.registrando', 'Registrando…') : tOr('inventario.registrarMermas', 'Registrar mermas')}
            </button>
          </div>
        </form>
      )}
      {ok && <div className="inv-ok">✅ {ok}</div>}

      <div className="adm-card-cab">
        <h3>{tOr('inventario.mermaResumen', 'Resumen de merma')}</h3>
        <span className="sp" />
        {DIAS.map(n => (
          <button key={n} type="button" className={'tab' + (dias === n ? ' on' : '')} onClick={() => setDias(n)}>{tOr('inventario.diasRange', `${n} días`, { n })}</button>
        ))}
      </div>
      {errRep && <div className="auth-aviso inv-error" role="alert">⚠️ {errRep}<button type="button" className="ghost" onClick={cargar}>{tOr('inventario.reintentar', 'Reintentar')}</button></div>}
      {cargando && !filasReporte.length
        ? <div className="adm-vacio">{tOr('inventario.consultandoMovs', 'Consultando movimientos…')}</div>
        : !resumen.porInsumo.length
          ? <div className="adm-vacio">{tOr('inventario.sinMermas', 'Sin mermas en este periodo.')}</div>
          : (
            <>
              <div className="inv-receta-resumen">
                <span className="adm-chip">{tOr('inventario.mermaManual', 'Merma manual')}: {fmt(resumen.totales.manual)}</span>
                <span className="adm-chip">{tOr('inventario.mermaLimpieza', 'Merma de limpieza')}: {fmt(resumen.totales.limpieza)}</span>
                <span className="adm-chip inv-chip-alerta">{tOr('inventario.mermaCosto', 'Costo de la merma')}: {MONEDA} {fmt(resumen.totales.costo)}</span>
              </div>
              <div className="inv-lista inv-mermas">
                <div className="inv-mermas-cab">
                  <span>{tOr('inventario.colInsumo', 'Insumo')}</span>
                  <span className="der">{tOr('inventario.mermaManual', 'Merma manual')}</span>
                  <span className="der">{tOr('inventario.mermaLimpieza', 'Merma de limpieza')}</span>
                  <span className="der">{tOr('inventario.rendProm', 'Rend. prom.')}</span>
                  <span className="der">{tOr('inventario.mermaCosto', 'Costo de la merma')}</span>
                </div>
                {resumen.porInsumo.map(r => (
                  <div key={r.insumo_id} className="inv-mermas-fila">
                    <span className="inv-movs-insumo">{r.nombre}</span>
                    <span className="der">{fmt(r.manual)} {unid(r)}</span>
                    <span className="der">{fmt(r.limpieza)} {unid(r)}</span>
                    <span className="der">{r.rendimiento === null ? '—' : fmt(r.rendimiento) + ' %'}</span>
                    <span className="der">{MONEDA} {fmt(r.costo)}</span>
                  </div>
                ))}
              </div>
              <b>{tOr('inventario.mermaPorDia', 'Merma por día')}</b>
              <div className="inv-lista inv-mermas inv-mermas-dia">
                {resumen.porDia.map(r => (
                  <div key={r.dia} className="inv-mermas-fila inv-mermas-fila-dia">
                    <span className="inv-movs-fecha">{fmtDia(r.dia)}</span>
                    <span className="der">{tOr('inventario.mermaManual', 'Merma manual')}: {fmt(r.manual)}</span>
                    <span className="der">{tOr('inventario.mermaLimpieza', 'Merma de limpieza')}: {fmt(r.limpieza)}</span>
                    <span className="der">{MONEDA} {fmt(r.costo)}</span>
                  </div>
                ))}
              </div>
              <p className="adm-sub">{tOr('inventario.mermaNotaCant', 'Las cantidades de cada fila van en la unidad base del insumo; el total del periodo mezcla unidades distintas, usa el costo para compararlas.')}</p>
            </>
          )}
    </section>
  )
}
