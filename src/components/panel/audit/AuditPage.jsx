import { useEffect, useRef, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import DataTable from '../DataTable.jsx'
import '../../../styles/admin.css'
import './AuditPage.css'

const ACCIONES = {
  super_alta: 'Alta de una empresa desde la super administración',
  super_entro: 'El super administrador entró en la empresa',
  super_ajustar_cuota: 'El super ajustó la cuota del plan',
  super_exporto: 'El super exportó los datos de la empresa',
  super_importo: 'El super importó datos de otra empresa',
  super_reset_clave: 'El super restableció una clave de acceso',
  throttle_agotado: 'Se agotó el límite de intentos de acceso',
  comensales: 'Cambio en los comensales de una cuenta',
  devolucion: 'Se anuló un plato ya servido (devolución)',
  devolucion_confirmada: 'Cocina/barra confirmó una devolución',
  equipo_areas: 'Se cambiaron las áreas que ve una persona del equipo',
  area_retirada: 'Se borró un área de comanda',
  alta_empresa: 'Alta de una empresa nueva',
  equipo_invito: 'Se invitó a una persona al equipo',
  equipo_restablecio_clave: 'Se restableció la clave de una persona del equipo',
  equipo_revoco: 'Se quitó el acceso a una persona del equipo',
  exportar_datos: 'El negocio exportó sus datos',
}

const ROL_ETIQUETA = { admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra', super: 'Super administrador' }

const RANGOS_DIAS = [7, 15, 30, 90]
const LIMITE_REFRESCAR = 300
const LIMITE_TODO = 2000
const LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' }

const humanizar = codigo => {
  const txt = String(codigo || '').replaceAll('_', ' ').trim()
  return txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '—'
}

const etiquetaAccion = (accion, tOr) => (accion ? tOr('auditoria.acc.' + accion, ACCIONES[accion] || humanizar(accion)) : '—')
const etiquetaRol = (rol, tOr) => (rol ? tOr('rol.' + rol, ROL_ETIQUETA[rol] || humanizar(rol)) : null)

const textoDetalle = det => (det && typeof det === 'object' && Object.keys(det).length)
  ? Object.entries(det).map(([k, v]) => `${humanizar(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
  : '—'

function fechaLegible(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(LOCALE[idiom] || 'es', { dateStyle: 'short', timeStyle: 'short' })
}

const nombreActor = e => e.actor_nombre || e.actor || '—'

export default function AuditPage({ rol, sesion }) {
  const { tOr, idiom } = useIdioma()

  const permitido = rol === 'admin' || Boolean(sesion?.es_super)

  const [entries, setEntries] = useState(null)
  const [showingAll, setShowingAll] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dias, setDias] = useState(7)
  const [filtroAccion, setFiltroAccion] = useState('todas')
  const [filtroActor, setFiltroActor] = useState('todos')

  const seqRef = useRef(0)
  const revokeRef = useRef(null)

  useEffect(() => () => clearTimeout(revokeRef.current), [])

  async function cargar(limite, todo, diasElegidos) {
    const seq = ++seqRef.current
    setCargando(true)
    setError('')
    try {

      const filas = await rpc('auditoria_listar', { p_dias: diasElegidos, p_accion: null, p_actor: null, p_limite: limite })
      if (seq !== seqRef.current) return
      setEntries(Array.isArray(filas) ? filas : [])
      setShowingAll(todo)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(mensajeError(e))
      setEntries(prev => prev ?? [])
    } finally {
      if (seq === seqRef.current) setCargando(false)
    }
  }

  const refresh = () => cargar(LIMITE_REFRESCAR, false, dias)
  const loadAll = () => cargar(LIMITE_TODO, true, dias)

  const cambiarDias = n => {
    setDias(n)
    if (entries !== null) cargar(showingAll ? LIMITE_TODO : LIMITE_REFRESCAR, showingAll, n)
  }

  const q = search.trim().toLowerCase()
  const list = (entries || [])
    .filter(e => !q || [nombreActor(e), etiquetaRol(e.actor_rol, tOr), e.accion, etiquetaAccion(e.accion, tOr), e.entity_type, e.entity_label, textoDetalle(e.detalle)].join(' ').toLowerCase().includes(q))
    .filter(e => filtroAccion === 'todas' || e.accion === filtroAccion)
    .filter(e => filtroActor === 'todos' || nombreActor(e) === filtroActor)
    .sort((a, b) => new Date(b.en) - new Date(a.en))

  const accionesDisponibles = [...new Set((entries || []).map(e => e.accion).filter(Boolean))].sort()
  const actoresDisponibles = [...new Set((entries || []).map(nombreActor))].sort()

  const exportarCsv = () => {
    const sep = ';'
    const lineas = [
      [tOr('auditoria.colFecha', 'Fecha'), tOr('auditoria.colQuien', 'Quién'), tOr('auditoria.colAccion', 'Acción'), tOr('auditoria.colRegistro', 'Registro'), tOr('auditoria.colDetalle', 'Detalle')],
      ...list.map(e => [
        e.en || '',
        nombreActor(e),
        etiquetaAccion(e.accion, tOr),
        e.entity_label || e.entity_type || '—',
        textoDetalle(e.detalle),
      ]),
    ]
    const limpiar = campo => {
      const v = String(campo ?? '')
      return /[";\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v
    }
    const texto = lineas.map(fila => fila.map(limpiar).join(sep)).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF' + texto], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    const f = n => String(n).padStart(2, '0')
    const d = new Date()
    a.href = url
    a.download = `auditoria-${d.getFullYear()}-${f(d.getMonth() + 1)}-${f(d.getDate())}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    clearTimeout(revokeRef.current)
    revokeRef.current = setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  if (!permitido) {
    return (
      <div className="adm-panel">
        <div className="adm-aviso">{tOr('auditoria.soloAdmin', 'Solo el administrador puede ver la auditoría.')}</div>
      </div>
    )
  }

  const columnas = [
    { key: 'en', label: tOr('auditoria.colFecha', 'Fecha'), render: e => fechaLegible(e.en, idiom), sortValue: e => (e.en ? new Date(e.en).getTime() : null) },
    {
      key: 'actor', label: tOr('auditoria.colQuien', 'Quién'), sortValue: nombreActor,
      render: e => (
        <>
          {nombreActor(e)}
          <br />
          {e.actor_rol && <small className="aud-muted">{etiquetaRol(e.actor_rol, tOr)}</small>}
        </>
      ),
    },
    { key: 'accion', label: tOr('auditoria.colAccion', 'Acción'), render: e => etiquetaAccion(e.accion, tOr), sortValue: e => e.accion },
    { key: 'entity_label', label: tOr('auditoria.colRegistro', 'Registro'), render: e => e.entity_label || e.entity_type || '—' },
    { key: 'detalle', label: tOr('auditoria.colDetalle', 'Detalle'), render: e => textoDetalle(e.detalle), sortable: false },
  ]

  const contador = tOr('auditoria.eventos', `${list.length} eventos`, { n: list.length })

  return (
    <div className="adm-panel">
      <section className="adm-card aud-card">
        <div className="adm-card-cab aud-cab">
          <div>
            <h3>🔍 {tOr('auditoria.titulo', 'Auditoría')}</h3>
            <p className="adm-sub aud-desc">
              {entries === null
                ? tOr('auditoria.descInicio', 'Qué movió cada persona en tu negocio. Nada se carga hasta pulsar Refrescar.')
                : showingAll
                  ? tOr('auditoria.descTodo', 'Historial completo (hasta 2000 movimientos de la empresa).')
                  : tOr('auditoria.descRecientes', 'Movimientos recientes (hasta 300). Usa «Ver todo» para el historial completo.')}
            </p>
          </div>
          <span className="sp" />
          <div className="aud-head">
            <button type="button" className="primary" onClick={refresh} disabled={cargando}>
              {cargando ? tOr('auditoria.cargando', 'Cargando…') : tOr('auditoria.refrescar', 'Refrescar')}
            </button>
            {!showingAll && entries !== null && (
              <button type="button" className="info" onClick={loadAll} disabled={cargando}>
                {tOr('auditoria.verTodo', 'Ver todo')}
              </button>
            )}
          </div>
        </div>

        {error && <div className="aud-error" role="alert">⚠️ {error}</div>}

        {entries === null ? (
          !cargando && <p className="aud-pulse">{tOr('auditoria.pulseRefrescar', 'Pulse Refrescar para ver los movimientos registrados.')}</p>
        ) : (
          <>
            <div className="aud-filtros">
              <input name="buscar-pista" className="aud-buscar" type="search" autoComplete="off"
                placeholder={tOr('auditoria.buscarPista', 'Buscar persona, acción o registro…')}
                value={search} onChange={e => setSearch(e.target.value)} />
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroRango', 'Rango')}</span>
                <select name="dias" value={dias} disabled={cargando} onChange={e => cambiarDias(Number(e.target.value))}>
                  {RANGOS_DIAS.map(n => <option key={n} value={n}>{tOr('auditoria.dias.' + n, `${n} días`)}</option>)}
                </select>
              </label>
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroAccion', 'Acción')}</span>
                <select name="filtro-accion" value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)}>
                  <option value="todas">{tOr('auditoria.todasAcciones', 'Todas las acciones')}</option>
                  {accionesDisponibles.map(a => <option key={a} value={a}>{etiquetaAccion(a, tOr)}</option>)}
                </select>
              </label>
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroActor', 'Persona')}</span>
                <select name="filtro-actor" value={filtroActor} onChange={e => setFiltroActor(e.target.value)}>
                  <option value="todos">{tOr('auditoria.todosActores', 'Todas las personas')}</option>
                  {actoresDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <span className="sp" />
              <span className="aud-contador">{contador}{showingAll ? ` · ${tOr('auditoria.historialCompleto', 'historial completo')}` : ''}</span>
            </div>

            <DataTable columns={columnas} rows={list}
              getRowId={e => e.id ?? `${e.en}|${e.accion}|${e.entity_label || ''}`}
              emptyText={tOr('auditoria.vacio', 'Sin movimientos en este rango')}
              resizeGroup="auditoria" userId={sesion?.usuario} />
          </>
        )}
      </section>
    </div>
  )
}
