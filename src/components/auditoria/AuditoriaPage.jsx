// Auditoría (solo rol admin): puerto del components/panel/audit/AuditPage.jsx de Catering
// Control, adaptado a POS Control (rpc('auditoria_listar'), tOr, DataTable propio).
// · NO carga nada hasta pulsar Refrescar (300 filas); «Ver todo» trae 2000 y marca el
//   contador como historial completo — mismo patrón que el origen.
// · Buscador EN CLIENTE sobre las 5 columnas; selects de acción/actor con opciones
//   derivadas de las filas ya cargadas (sin RPC extra); el rango de días SÍ va a la base
//   como p_dias. Exportar CSV con Blob + objectURL (revoke garantizado al desmontar).
// · Props: { rol, sesion }. Gate defensivo en el render (todos los hooks se llaman antes):
//   PanelPage hace el enrutado real, pero un no-admin nunca ve datos ni dispara la RPC.
// · Sin diálogos nativos (alert/confirm): errores y vacíos se pintan en pantalla.
import { useEffect, useRef, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { rpc, mensajeError } from '../../services/supabase.js'
import DataTable from '../panel/DataTable.jsx'
import '../admin/admin.css' // .adm-panel / .adm-card / .adm-sub / .sp (área de administración)
import './AuditoriaPage.css'

// Acciones REALES registradas por private.auditar(...) en supabase/setup.sql (lista
// extraída con grep, octubre 2026). La etiqueta visible
// pasa por tOr('auditoria.acc.<accion>', ...); si el carril de datos añade acciones
// nuevas, humanizar() las muestra legibles y el <select> las incorpora de los datos.
const ACCIONES = {
  super_alta: 'Alta de una empresa desde la super administración',
  super_entro: 'El super administrador entró en la empresa',
  super_ajustar_cuota: 'El super ajustó la cuota del plan',
  super_exporto: 'El super exportó los datos de la empresa',
  super_importo: 'El super importó datos de otra empresa',
  super_reset_clave: 'El super restableció una clave de acceso',
  throttle_agotado: 'Se agotó el límite de intentos de acceso',
  comensales: 'Cambio en los comensales de una cuenta',
  alta_empresa: 'Alta de una empresa nueva',
  equipo_invito: 'Se invitó a una persona al equipo',
  equipo_restablecio_clave: 'Se restableció la clave de una persona del equipo',
  equipo_revoco: 'Se quitó el acceso a una persona del equipo',
  exportar_datos: 'El negocio exportó sus datos',
}

// Roles tal y como los guarda la base (español). Claves rol.* ya existen en los diccionarios.
const ROL_ETIQUETA = { admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra', super: 'Super administrador' }

const RANGOS_DIAS = [7, 15, 30, 90]
const LIMITE_REFRESCAR = 300 // igual que el origen: carga normal
const LIMITE_TODO = 2000     // «Ver todo» (tope que admite la RPC)
const LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' } // mismo mapa que EquipoAdmin

// 'item_anulacion_pedida' → 'Item anulacion pedida' (fallback legible: guion bajo → espacio,
// capitalizado). Se usa para acciones y para claves de detalle desconocidas.
const humanizar = codigo => {
  const txt = String(codigo || '').replaceAll('_', ' ').trim()
  return txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '—'
}

const etiquetaAccion = (accion, tOr) => (accion ? tOr('auditoria.acc.' + accion, ACCIONES[accion] || humanizar(accion)) : '—')
const etiquetaRol = (rol, tOr) => (rol ? tOr('rol.' + rol, ROL_ETIQUETA[rol] || humanizar(rol)) : null)

// { en: '...', correo: 'x' } → 'en: ... · correo: x' (mismo pintado que el origen).
const textoDetalle = det => (det && typeof det === 'object' && Object.keys(det).length)
  ? Object.entries(det).map(([k, v]) => `${humanizar(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
  : '—'

// '2026-10-16T13:52:00Z' → fecha corta + hora según idioma. Fecha rara → '—' (nunca NaN).
function fechaLegible(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(LOCALE[idiom] || 'es', { dateStyle: 'short', timeStyle: 'short' })
}

const nombreActor = e => e.actor_nombre || e.actor || '—' // filas sin actor_nombre: uuid o '—', como el origen

export default function AuditoriaPage({ rol, sesion }) {
  const { tOr, idiom } = useIdioma()

  const permitido = rol === 'admin' || Boolean(sesion?.es_super)

  // `entries === null` = todavía no se cargó nada (el origen no consulta hasta Refrescar).
  const [entries, setEntries] = useState(null)
  const [showingAll, setShowingAll] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dias, setDias] = useState(7)            // p_dias: filtro de servidor
  const [filtroAccion, setFiltroAccion] = useState('todas') // filtro en cliente
  const [filtroActor, setFiltroActor] = useState('todos')   // filtro en cliente

  const seqRef = useRef(0)   // última carga pedida gana si llegan dos a la vez
  const revokeRef = useRef(null) // timer de URL.revokeObjectURL del CSV exportado

  // Al desmontar, liberar el objeto URL pendiente del último CSV (si el usuario navega
  // antes del revoke). Todos los listeners de resize los gestiona startColumnResize, que
  // se auto-remove en pointerup/pointercancel.
  useEffect(() => () => clearTimeout(revokeRef.current), [])

  async function cargar(limite, todo, diasElegidos) {
    const seq = ++seqRef.current
    setCargando(true)
    setError('')
    try {
      // p_accion/p_actor quedan null: acción y actor se filtran en cliente sobre lo cargado
      // (mismas opciones que el <select>, derivadas de las filas, sin RPC extra).
      const filas = await rpc('auditoria_listar', { p_dias: diasElegidos, p_accion: null, p_actor: null, p_limite: limite })
      if (seq !== seqRef.current) return // llegó una petición más nueva: esta se descarta
      setEntries(Array.isArray(filas) ? filas : [])
      setShowingAll(todo)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(mensajeError(e)) // los raise exception de la base ya vienen en español
      setEntries(prev => prev ?? []) // con error: la tabla queda visible y el aviso arriba manda
    } finally {
      if (seq === seqRef.current) setCargando(false)
    }
  }

  const refresh = () => cargar(LIMITE_REFRESCAR, false, dias)
  const loadAll = () => cargar(LIMITE_TODO, true, dias)

  // Cambiar el rango de días vuelve a preguntar a la base (es p_dias), pero solo si ya
  // habíamos cargado: en el estado inicial debe seguir mandando Refrescar (como el origen).
  const cambiarDias = n => {
    setDias(n)
    if (entries !== null) cargar(showingAll ? LIMITE_TODO : LIMITE_REFRESCAR, showingAll, n)
  }

  // ── Filtrado en cliente (igual que el origen): búsqueda + selects sobre lo cargado ──
  const q = search.trim().toLowerCase()
  const list = (entries || [])
    .filter(e => !q || [nombreActor(e), etiquetaRol(e.actor_rol, tOr), e.accion, etiquetaAccion(e.accion, tOr), e.entity_type, e.entity_label, textoDetalle(e.detalle)].join(' ').toLowerCase().includes(q))
    .filter(e => filtroAccion === 'todas' || e.accion === filtroAccion)
    .filter(e => filtroActor === 'todos' || nombreActor(e) === filtroActor)
    .sort((a, b) => new Date(b.en) - new Date(a.en)) // más reciente primero

  // Opciones de los selects derivadas de las filas cargadas (sin RPC extra).
  const accionesDisponibles = [...new Set((entries || []).map(e => e.accion).filter(Boolean))].sort()
  const actoresDisponibles = [...new Set((entries || []).map(nombreActor))].sort()

  // ── Exportar CSV: lo que se ve (filtrado y orden actual), con BOM para Excel en español ──
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

  // ── El gate de rol vive AQUÍ, después de todos los hooks (reglas de hooks) ──
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
              <input className="aud-buscar" type="search" autoComplete="off"
                placeholder={tOr('auditoria.buscarPista', 'Buscar persona, acción o registro…')}
                value={search} onChange={e => setSearch(e.target.value)} />
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroRango', 'Rango')}</span>
                <select value={dias} disabled={cargando} onChange={e => cambiarDias(Number(e.target.value))}>
                  {RANGOS_DIAS.map(n => <option key={n} value={n}>{tOr('auditoria.dias.' + n, `${n} días`)}</option>)}
                </select>
              </label>
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroAccion', 'Acción')}</span>
                <select value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)}>
                  <option value="todas">{tOr('auditoria.todasAcciones', 'Todas las acciones')}</option>
                  {accionesDisponibles.map(a => <option key={a} value={a}>{etiquetaAccion(a, tOr)}</option>)}
                </select>
              </label>
              <label className="aud-filtro">
                <span>{tOr('auditoria.filtroActor', 'Persona')}</span>
                <select value={filtroActor} onChange={e => setFiltroActor(e.target.value)}>
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
