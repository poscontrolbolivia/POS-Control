import { useCallback, useEffect, useMemo, useState } from 'react'
import { rpc, mensajeError, sb } from '../../../services/supabaseClient.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { useStore } from '../../../context/StoreContext.jsx'
import { round2 as r2 } from '../../../services/format.js'
import { formatearMonto } from '../../../services/money.js'
import { detalleCierre } from '../../../services/db.js'
import { calcularResumen } from './calcularResumen.js'
import { armarReporte, descargarPdfCierre } from '../../../services/reporteCierre.js'

const pad = n => String(n).padStart(2, '0')
const aFecha = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hoy = () => aFecha(new Date())
const hace = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return aFecha(d) }

export default function ClosingsHistory({ moneda = 'Bs' }) {
  const { t } = useIdioma()
  const { s } = useStore()
  const [desde, setDesde] = useState(hace(6))
  const [hasta, setHasta] = useState(hoy())
  const [turnos, setTurnos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [pdf, setPdf] = useState('')
  const [fallo, setFallo] = useState({ id: '', msg: '' })
  const [abiertos, setAbiertos] = useState({})
  const m = n => formatearMonto(n, moneda)
  const fh = iso => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const nombreMesa = id => s.mesas.find(x => x.id === id)?.nombre || ''
  const etiquetaCuenta = c => c.numero ?? ((c.mesaIds || []).map(nombreMesa).filter(Boolean).join(' + ') || c.clienteNombre || c.etiqueta || '—')

  // El PDF se arma con el mismo generador del cierre en curso: se leen las cuentas de la
  // ventana del turno desde la base (la RLS deja leer el histórico de la empresa).
  const generarPdf = async x => {
    setPdf(x.id)
    setFallo({ id: '', msg: '' })
    try {
      const { turno, cuentas, devoluciones } = await detalleCierre(x.id)
      const reporte = armarReporte({
        turno,
        resumen: calcularResumen(turno, cuentas),
        config: s.config,
        productos: s.productos,
        devoluciones,
        contado: x.contado == null ? null : Number(x.contado),
        cerradoPor: x.cerrado_por || '',
        etiquetaCuenta,
      })
      await descargarPdfCierre(reporte, { t, m, sb })
    } catch (e) {
      setFallo({ id: x.id, msg: mensajeError(e) })
    } finally {
      setPdf('')
    }
  }

  const buscar = useCallback(async (d = desde, h = hasta) => {
    setCargando(true); setError('')
    try {
      const ini = new Date(`${d}T00:00:00`)
      const fin = new Date(`${h}T23:59:59.999`)
      const filas = await rpc('cierres_listar', { p_desde: ini.toISOString(), p_hasta: fin.toISOString() })
      setTurnos(Array.isArray(filas) ? filas : [])
    } catch (e) { setError(mensajeError(e)) } finally { setCargando(false) }
  }, [desde, hasta])

  useEffect(() => { buscar() }, [])

  const rapido = (d, h) => { setDesde(d); setHasta(h); buscar(d, h) }

  const dias = useMemo(() => {
    const mapa = new Map()
    ;(turnos || []).forEach(x => {
      const dia = aFecha(new Date(x.cerrado_en || x.abierto_en))
      if (!mapa.has(dia)) mapa.set(dia, [])
      mapa.get(dia).push(x)
    })
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([dia, lista]) => {
      const sum = k => r2(lista.reduce((a, x) => a + (Number(x[k]) || 0), 0))
      return {
        dia, lista,
        cobrado: sum('cobrado'), efectivo: sum('efectivo'), qr: sum('qr'), tarjeta: sum('tarjeta'), otros: sum('otros'),
        ingresos: sum('ingresos'), egresos: sum('egresos'), cuentas: lista.reduce((a, x) => a + (Number(x.cuentas) || 0), 0),
        dev: sum('dev_monto'), difs: r2(lista.reduce((a, x) => a + (x.diferencia == null ? 0 : Number(x.diferencia)), 0)),
      }
    })
  }, [turnos])

  const etiquetaDia = dia => new Date(`${dia}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  const dif = d => (d == null ? null : Math.abs(d) < 0.005
    ? <span className="caja-diff ok">{t('caja.cuadrado')}</span>
    : d > 0 ? <span className="caja-diff sobra">{t('caja.sobraM', { monto: m(d) })}</span>
      : <span className="caja-diff falta">{t('caja.faltaM', { monto: m(-d) })}</span>)

  const csv = () => {
    const cab = ['turno_abierto', 'turno_cerrado', 'abrio', 'cerro', 'fondo', 'efectivo', 'qr', 'tarjeta', 'otros', 'cobrado', 'ingresos', 'egresos', 'esperado', 'contado', 'diferencia', 'cuentas', 'devoluciones_n', 'devoluciones_monto', 'devoluciones_sin_confirmar']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const filas = (turnos || []).map(x => [x.abierto_en, x.cerrado_en || '', x.abierto_por, x.cerrado_por, x.fondo, x.efectivo, x.qr, x.tarjeta, x.otros, x.cobrado, x.ingresos, x.egresos, x.esperado ?? '', x.contado ?? '', x.diferencia ?? '', x.cuentas, x.dev_n, x.dev_monto, x.dev_sin_confirmar].map(esc).join(','))
    const blob = new Blob(['\ufeff' + [cab.join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `cierres-${desde}_${hasta}.csv`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <section className="caja-card cierres">
      <div className="caja-head"><h2>{t('cierres.titulo')}</h2></div>
      <p className="caja-nota">{t('cierres.ayuda')}</p>
      <div className="cierres-filtros">
        <label>{t('cierres.desde')}<input name="desde" type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label>{t('cierres.hasta')}<input name="hasta" type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
        <button type="button" className="success" disabled={cargando || !desde || !hasta} onClick={() => buscar()}>{cargando ? t('cierres.cargando') : t('cierres.buscar')}</button>
      </div>
      <div className="cierres-rapidos">
        <button type="button" className="ghost" onClick={() => rapido(hoy(), hoy())}>{t('cierres.hoy')}</button>
        <button type="button" className="ghost" onClick={() => rapido(hace(1), hace(1))}>{t('cierres.ayer')}</button>
        <button type="button" className="ghost" onClick={() => rapido(hace(6), hoy())}>{t('cierres.d7')}</button>
        <button type="button" className="ghost" onClick={() => rapido(hace(29), hoy())}>{t('cierres.d30')}</button>
        <span className="sp" />
        <button type="button" className="slate" disabled={!turnos?.length} onClick={csv}>{t('cierres.csv')}</button>
      </div>
      {error && <p className="caja-aviso" role="alert">{error}</p>}
      {turnos && !turnos.length && !error && <p className="caja-nota">{t('cierres.vacio')}</p>}
      {dias.map(d => (
        <div key={d.dia} className="cierres-dia">
          <div className="cierres-dia-cab">
            <b>{etiquetaDia(d.dia)}</b>
            <span className="adm-chip">{t('cierres.turnos', { n: d.lista.length })}</span>
            <span className="sp" />
            <span className="cierres-total">{t('cierres.cobrado')}: <b>{m(d.cobrado)}</b></span>
          </div>
          <div className="cierres-mini">
            <span>{t('caja.stEfectivo')} {m(d.efectivo)}</span>
            <span>{t('caja.stQr')} {m(d.qr)}</span>
            <span>{t('caja.stTarjeta')} {m(d.tarjeta)}</span>
            {d.otros > 0 && <span>{t('caja.stOtros')} {m(d.otros)}</span>}
            <span>{t('caja.stIngresos')} {m(d.ingresos)}</span>
            <span>{t('caja.stEgresos')} {m(d.egresos)}</span>
            <span>{t('cierres.cuentas', { n: d.cuentas })}</span>
            {d.dev > 0 && <span className="cierres-dev">{t('cierres.devoluciones', { n: d.lista.reduce((a, x) => a + (Number(x.dev_n) || 0), 0), monto: m(d.dev) })}</span>}
          </div>
          <ul className="caja-lista">
            {d.lista.map(x => {
              const ab = Boolean(abiertos[x.id])
              return (
                <li key={x.id} className="cierres-turno">
                  <div className="cierres-turno-cab">
                    <b>{fh(x.abierto_en)} → {x.cerrado_en ? fh(x.cerrado_en) : t('caja.abierto')}</b>
                    <span className="sp" />
                    <span>{m(x.cobrado)}</span>
                    {x.cerrado_en && dif(x.diferencia)}
                    {x.cerrado_en && (
                      <button type="button" className="slate" disabled={pdf === x.id} onClick={() => generarPdf(x)}>
                        {pdf === x.id ? t('cierres.pdfCargando') : t('cierres.pdf')}
                      </button>
                    )}
                    <button type="button" className="ghost" onClick={() => setAbiertos(a => ({ ...a, [x.id]: !a[x.id] }))}>{ab ? t('cierres.ocultar') : t('cierres.detalle')}</button>
                  </div>
                  {fallo.id === x.id && <p className="caja-aviso" role="alert">{fallo.msg}</p>}
                  {ab && (
                    <div className="cierres-detalle">
                      <span>{t('cierres.abrio', { quien: x.abierto_por || '—' })}</span>
                      {x.cerrado_en && <span>{t('cierres.cerro', { quien: x.cerrado_por || '—' })}</span>}
                      <span>{t('caja.stFondo')}: {m(x.fondo)}</span>
                      <span>{t('caja.stEfectivo')}: {m(x.efectivo)}</span>
                      <span>{t('caja.stQr')}: {m(x.qr)}</span>
                      <span>{t('caja.stTarjeta')}: {m(x.tarjeta)}</span>
                      {x.otros > 0 && <span>{t('caja.stOtros')}: {m(x.otros)}</span>}
                      <span>{t('caja.stIngresos')}: {m(x.ingresos)}</span>
                      <span>{t('caja.stEgresos')}: {m(x.egresos)}</span>
                      {x.esperado != null && <span>{t('caja.stEsperado')}: {m(x.esperado)}</span>}
                      {x.contado != null && <span>{t('cierres.contado')}: {m(x.contado)}</span>}
                      <span>{t('cierres.cuentas', { n: x.cuentas })}</span>
                      {x.dev_n > 0 && <span className="cierres-dev">{t('cierres.devoluciones', { n: x.dev_n, monto: m(x.dev_monto) })}{x.dev_sin_confirmar > 0 ? ` · ${t('cierres.sinConfirmar', { n: x.dev_sin_confirmar })}` : ''}</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
