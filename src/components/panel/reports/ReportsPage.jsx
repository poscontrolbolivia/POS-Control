import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { puede } from '../../../services/permissions.js'
import { round2 } from '../../../services/format.js'
import { formatearMonto } from '../../../services/money.js'
import { MONEDA } from '../../../services/config.js'
import { nombreDeArea } from '../../../services/printing.js'
import { reportesResumen } from '../../../services/reportes.js'
import { calcularResumen } from '../cash/calcularResumen.js'
import { armarReporte, descargarPdfCierre } from '../../../services/reporteCierre.js'
import DataTable from '../DataTable.jsx'
import {
  resumenDeCuentas, rangoHoy, rangoUltimos7, rangoMesActual, rangoMesPasado, rangoDeFechas,
  fechaClave, aMs, csvDe, bajarCsv, csvDeSecciones,
} from './calculos.js'
import '../../../styles/admin.css'
import './ReportsPage.css'

const METODO_TXT = { efectivo: 'Efectivo', qr: 'QR', tarjeta: 'Tarjeta', mixed: 'Mixto' }
const PRESETS = [
  { id: 'hoy', clave: 'reportes.hoy', texto: 'Hoy', rango: rangoHoy },
  { id: '7d', clave: 'reportes.ultimos7', texto: 'Últimos 7 días', rango: rangoUltimos7 },
  { id: 'mes', clave: 'reportes.mesActual', texto: 'Este mes', rango: rangoMesActual },
  { id: 'mes-p', clave: 'reportes.mesPasado', texto: 'Mes pasado', rango: rangoMesPasado },
]

const lista = (r, k) => (Array.isArray(r?.[k]) ? r[k] : [])
const legible = ts => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function ReportsPage({ rol, sesion }) {
  const { s, error, modo } = useStore()
  const { t, tOr } = useIdioma()

  const [rango, setRango] = useState(() => ({ ...rangoHoy(), preset: 'hoy' }))
  const [desdeTxt, setDesdeTxt] = useState(() => fechaClave(rango.desde))
  const [hastaTxt, setHastaTxt] = useState(() => fechaClave(rango.hasta))
  const [resumenRpc, setResumenRpc] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [pdfCargando, setPdfCargando] = useState(false)
  const [aviso, setAviso] = useState('')
  const seqRef = useRef(0)

  const sRef = useRef(s)
  sRef.current = s

  // En Supabase se recarga solo al cambiar el rango; en demo el cálculo es reactivo al store.
  useEffect(() => {
    if (modo !== 'supabase') { setResumenRpc(null); setCargando(false); return undefined }
    const seq = ++seqRef.current
    setCargando(true)
    reportesResumen({ modo, estado: sRef.current, desde: rango.desde, hasta: rango.hasta })
      .then(r => { if (seq === seqRef.current) { setResumenRpc(r); setCargando(false) } })
      .catch(() => { if (seq === seqRef.current) setCargando(false) })
    return undefined
  }, [modo, rango])

  const memoria = useMemo(() => resumenDeCuentas(s, rango.desde, rango.hasta), [s, rango])
  const resumen = modo === 'supabase' && resumenRpc?.origen === 'rpc' ? resumenRpc : memoria
  const T = resumen.totales || {}
  const moneda = resumen.moneda || s.config?.moneda || MONEDA
  const m = n => formatearMonto(n, moneda)
  const tag = `${fechaClave(rango.desde)}_${fechaClave(rango.hasta)}`
  const metodoTxt = k => tOr('reportes.metodo.' + k, METODO_TXT[k] || k)
  const pct = n => `${T.total > 0 ? round2(((Number(n) || 0) / T.total) * 100) : 0}%`
  const minutos = r => Math.max(0, Math.round((Date.now() - aMs(r.abierta_en)) / 60000))

  const aplicarPreset = p => {
    const r = p.rango()
    setRango({ ...r, preset: p.id })
    setDesdeTxt(fechaClave(r.desde)); setHastaTxt(fechaClave(r.hasta))
    setAviso('')
  }
  const aplicar = () => {
    const r = rangoDeFechas(desdeTxt, hastaTxt)
    if (!r) { setAviso(tOr('reportes.fechasInvalidas', 'Elige un rango de fechas válido (el hasta no puede ser menor al desde).')); return }
    setRango({ ...r, preset: null })
    setAviso('')
  }

  const L = {
    dia: tOr('reportes.colDia', 'Día'),
    cuentas: tOr('reportes.colCuentas', 'Cuentas'),
    monto: tOr('reportes.colMonto', 'Monto'),
    metodo: tOr('reportes.colMetodo', 'Método'),
    pct: tOr('reportes.colPct', '% del total'),
    producto: tOr('reportes.colProducto', 'Producto'),
    cant: tOr('reportes.colCantidad', 'Cantidad'),
    importe: tOr('reportes.colImporte', 'Importe'),
    mesero: tOr('reportes.colMesero', 'Mesero'),
    mesa: tOr('reportes.colMesa', 'Mesa'),
    area: tOr('reportes.colArea', 'Área'),
    nombre: tOr('reportes.colNombre', 'Nombre'),
    total: tOr('reportes.colTotal', 'Total'),
    pagado: tOr('reportes.colPagado', 'Pagado'),
    saldo: tOr('reportes.colSaldo', 'Saldo'),
    antiguedad: tOr('reportes.colAntiguedad', 'Antigüedad'),
  }

  const secciones = [
    {
      id: 'dias', icono: '📅', titulo: tOr('reportes.porDia', 'Ventas por día'),
      filas: lista(resumen, 'por_dia'), getRowId: r => r.dia,
      columnas: [
        { key: 'dia', label: L.dia, render: r => { const d = new Date(String(r.dia) + 'T00:00:00'); return Number.isNaN(d.getTime()) ? String(r.dia) : d.toLocaleDateString() } },
        { key: 'cuentas', label: L.cuentas, render: r => r.cuentas },
        { key: 'monto', label: L.monto, render: r => m(r.monto) },
      ],
      csvColumnas: [L.dia, L.cuentas, L.monto],
      csvFila: r => [r.dia, r.cuentas, round2(r.monto)],
    },
    {
      id: 'metodos', icono: '💳', titulo: tOr('reportes.porMetodo', 'Por método de pago'),
      filas: lista(resumen, 'por_metodo'), getRowId: r => r.metodo,
      columnas: [
        { key: 'metodo', label: L.metodo, render: r => metodoTxt(r.metodo) },
        { key: 'monto', label: L.monto, render: r => m(r.monto) },
        { key: 'pct', label: L.pct, render: r => pct(r.monto) },
        { key: 'cuentas', label: L.cuentas, render: r => r.cuentas },
      ],
      csvColumnas: [L.metodo, L.monto, L.pct, L.cuentas],
      csvFila: r => [metodoTxt(r.metodo), round2(r.monto), pct(r.monto), r.cuentas],
    },
    {
      id: 'productos', icono: '🍽️', titulo: tOr('reportes.masVendidos', 'Más vendidos'),
      filas: lista(resumen, 'productos'), getRowId: r => r.nombre,
      columnas: [
        { key: 'nombre', label: L.producto, render: r => r.nombre },
        { key: 'qty', label: L.cant, render: r => r.qty },
        { key: 'importe', label: L.importe, render: r => m(r.importe) },
      ],
      csvColumnas: [L.producto, L.cant, L.importe],
      csvFila: r => [r.nombre, r.qty, round2(r.importe)],
    },
    {
      id: 'meseros', icono: '🧑‍🍳', titulo: tOr('reportes.porMesero', 'Rendimiento por mesero'),
      filas: lista(resumen, 'por_usuario'), getRowId: r => r.usuario,
      columnas: [
        { key: 'usuario', label: L.mesero, render: r => r.usuario },
        { key: 'cuentas', label: L.cuentas, render: r => r.cuentas },
        { key: 'monto', label: L.monto, render: r => m(r.monto) },
      ],
      csvColumnas: [L.mesero, L.cuentas, L.monto],
      csvFila: r => [r.usuario, r.cuentas, round2(r.monto)],
    },
    {
      id: 'mesas', icono: '🪑', titulo: tOr('reportes.porMesa', 'Por mesa'),
      filas: lista(resumen, 'por_mesa'), getRowId: r => r.mesa,
      columnas: [
        { key: 'mesa', label: L.mesa, render: r => r.mesa },
        { key: 'cuentas', label: L.cuentas, render: r => r.cuentas },
        { key: 'monto', label: L.monto, render: r => m(r.monto) },
      ],
      csvColumnas: [L.mesa, L.cuentas, L.monto],
      csvFila: r => [r.mesa, r.cuentas, round2(r.monto)],
    },
    {
      id: 'areas', icono: '👨‍🍳', titulo: tOr('reportes.porArea', 'Por área'),
      filas: lista(resumen, 'por_area'), getRowId: r => r.area,
      columnas: [
        { key: 'area', label: L.area, render: r => nombreDeArea(s.config, r.area, r.area) },
        { key: 'qty', label: L.cant, render: r => r.qty },
      ],
      csvColumnas: [L.area, L.cant],
      csvFila: r => [nombreDeArea(s.config, r.area, r.area), r.qty],
    },
    {
      id: 'devoluciones', icono: '↩️', titulo: tOr('reportes.devoluciones', 'Devoluciones'),
      filas: lista(resumen, 'devoluciones'), getRowId: r => r.nombre,
      columnas: [
        { key: 'nombre', label: L.nombre, render: r => r.nombre },
        { key: 'qty', label: L.cant, render: r => r.qty },
        { key: 'monto', label: L.monto, render: r => m(r.monto) },
      ],
      csvColumnas: [L.nombre, L.cant, L.monto],
      csvFila: r => [r.nombre, r.qty, round2(r.monto)],
    },
    {
      id: 'pendientes', icono: '⏳', titulo: tOr('reportes.pendientes', 'Cuentas pendientes'),
      filas: lista(resumen, 'pendientes'), getRowId: r => r.cuenta_id,
      columnas: [
        { key: 'mesa', label: L.mesa, render: r => r.mesa },
        { key: 'total', label: L.total, render: r => m(r.total) },
        { key: 'pagado', label: L.pagado, render: r => m(r.pagado) },
        { key: 'saldo', label: L.saldo, render: r => <b className="rp-saldo">{m(r.saldo)}</b> },
        { key: 'mesero', label: L.mesero, render: r => r.mesero },
        { key: 'antiguedad', label: L.antiguedad, render: r => `${minutos(r)} min`, sortValue: r => minutos(r) },
      ],
      csvColumnas: [L.mesa, L.total, L.pagado, L.saldo, L.mesero, L.antiguedad],
      csvFila: r => [r.mesa, round2(r.total), round2(r.pagado), round2(r.saldo), r.mesero, minutos(r)],
    },
  ]

  const exportarSec = sec => bajarCsv(`reportes-${sec.id}-${tag}.csv`, csvDe(sec.csvColumnas, sec.filas.map(sec.csvFila)))
  const exportarTodo = () => bajarCsv(`reportes-${tag}.csv`,
    csvDeSecciones(secciones.map(sec => ({ titulo: sec.titulo, columnas: sec.csvColumnas, filas: sec.filas.map(sec.csvFila) }))))

  // Reutiliza el generador del cierre de caja: un turno sintético del rango + armarReporte.
  const pdf = async () => {
    setPdfCargando(true)
    setAviso('')
    const turno = { id: 'periodo', abiertoEn: rango.desde, cerradoEn: rango.hasta, modo: 'compartida', fondo: 0, movimientos: [] }
    const reporte = armarReporte({
      turno, resumen: calcularResumen(turno, s.cuentas), config: s.config,
      productos: s.productos, devoluciones: s.devoluciones || [], contado: null,
      cerradoPor: sesion?.nombre || '',
    })
    try {
      const { sb } = await import('../../../services/supabaseClient.js')
      await descargarPdfCierre(reporte, { t, m, sb: modo === 'supabase' ? sb : null })
    } catch {
      setAviso(tOr('reportes.errorPdf', 'No se pudo generar el PDF del periodo.'))
    } finally {
      setPdfCargando(false)
    }
  }

  if (!(puede(rol, 'ver_reportes') || sesion?.es_super)) {
    return (
      <div className="adm-panel">
        <div className="rp-aviso">{tOr('reportes.sinPermiso', 'Tu rol no tiene permiso para ver los reportes.')}</div>
      </div>
    )
  }

  const vacio = tOr('reportes.vacio', 'Sin datos en este periodo')

  return (
    <div className="adm-panel rp">
      <section className="adm-card">
        <div className="adm-card-cab rp-cab">
          <div>
            <h3>📊 {tOr('reportes.titulo', 'Reportes')}</h3>
            <p className="adm-sub rp-rango">{legible(rango.desde)} – {legible(rango.hasta)}
              {cargando && <span className="adm-spinner rp-spin">{tOr('reportes.cargando', 'Cargando…')}</span>}
            </p>
          </div>
          <span className="sp" />
          <div className="rp-head">
            <button type="button" className="primary" onClick={exportarTodo} disabled={cargando}>
              {tOr('reportes.exportarTodo', 'Exportar todo (CSV)')}
            </button>
            <button type="button" className="ghost" onClick={pdf} disabled={pdfCargando}>
              {pdfCargando ? tOr('reportes.pdfCargando', 'Generando PDF…') : tOr('reportes.pdf', 'PDF del periodo')}
            </button>
          </div>
        </div>

        <div className="rp-periodo">
          {PRESETS.map(p => (
            <button key={p.id} type="button" className={'rp-preset' + (rango.preset === p.id ? ' on' : '')} onClick={() => aplicarPreset(p)}>
              {tOr(p.clave, p.texto)}
            </button>
          ))}
          <label className="rp-fecha">
            <span>{tOr('reportes.desde', 'Desde')}</span>
            <input name="desde-txt" type="date" value={desdeTxt} onChange={e => setDesdeTxt(e.target.value)} />
          </label>
          <label className="rp-fecha">
            <span>{tOr('reportes.hasta', 'Hasta')}</span>
            <input name="hasta-txt" type="date" value={hastaTxt} onChange={e => setHastaTxt(e.target.value)} />
          </label>
          <button type="button" className="ghost" onClick={aplicar}>{tOr('reportes.aplicar', 'Aplicar')}</button>
        </div>
        <p className="rp-nota">{tOr('reportes.periodoAyuda', 'Todo el reporte usa el rango elegido; con fechas manuales toca «Aplicar».')}</p>

        {(aviso || error) && <div className="rp-aviso" role="alert">⚠️ {aviso || error}</div>}
        {modo === 'supabase' && resumenRpc?.origen === 'memoria' && !cargando && (
          <p className="rp-nota">{tOr('reportes.fuenteLocal', 'La RPC de reportes todavía no responde; los números se calcularon en este dispositivo.')}</p>
        )}
      </section>

      <section className="adm-card">
        <div className="adm-card-cab"><h3>{tOr('reportes.resumen', 'Resumen del periodo')}</h3></div>
        <div className="rp-tarjetas">
          <Tarjeta etiqueta={tOr('reportes.tCuentas', 'Cuentas cobradas')} valor={T.cuentas ?? 0} />
          <Tarjeta etiqueta={tOr('reportes.tPersonas', 'Personas atendidas')} valor={T.personas ?? 0} />
          <Tarjeta etiqueta={tOr('reportes.tVendido', 'Total vendido')} valor={m(T.total || 0)} destacada />
          <Tarjeta etiqueta={tOr('reportes.tTicket', 'Ticket promedio')} valor={m(T.ticket || 0)} />
          <Tarjeta etiqueta={tOr('reportes.tPersona', 'Promedio por persona')} valor={m(T.por_persona || 0)} />
          <Tarjeta etiqueta={tOr('reportes.tDescuentos', 'Descuentos')} valor={`− ${m(T.descuentos || 0)}`} />
          <Tarjeta etiqueta={tOr('reportes.tPropinas', 'Propinas')} valor={m(T.propinas || 0)} />
        </div>
      </section>

      <p className="rp-nota">{tOr('reportes.tablasAyuda', 'Toca un encabezado para ordenar la columna (▲ y luego ▼); arrastra el borde para cambiar el ancho.')}</p>
      {secciones.map(sec => (
        <section key={sec.id} className="adm-card rp-sec">
          <div className="adm-card-cab">
            <h3>{sec.icono} {sec.titulo}</h3>
            <span className="rp-n">{sec.filas.length}</span>
            <span className="sp" />
            <button type="button" className="ghost rp-btn" onClick={() => exportarSec(sec)} disabled={!sec.filas.length}>
              {tOr('reportes.exportarCsv', 'Exportar CSV')}
            </button>
          </div>
          <DataTable columns={sec.columnas} rows={sec.filas} getRowId={sec.getRowId}
            emptyText={vacio} resizeGroup={`reportes-${sec.id}`} userId={sesion?.usuario} />
        </section>
      ))}
    </div>
  )
}

function Tarjeta({ etiqueta, valor, destacada = false }) {
  return (
    <div className={'rp-tarjeta' + (destacada ? ' rp-destacada' : '')}>
      <span>{etiqueta}</span>
      <b>{valor}</b>
    </div>
  )
}
