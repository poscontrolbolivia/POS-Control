import { useEffect, useRef, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import DataTable from '../DataTable.jsx'
import '../../../styles/admin.css'
import './AuditPage.css'

const ACCIONES = {
  alerta_baja: "Eliminó una alerta",
  alerta_creado: "Creó una alerta",
  alerta_edicion: "Editó una alerta",
  alerta_movida: "Movió una alerta a otra mesa",
  alerta_resuelta: "Resolvió o reabrió una alerta",
  alta_empresa: "Se creó el negocio",
  area_retirada: "Eliminó un área de comanda",
  caja_movimiento: "Movimiento de caja (entrada o salida)",
  comanda_enviada: "Envió la comanda a cocina o barra",
  comensales: "Cambió los comensales",
  config_cambio: "Cambió la configuración",
  costo_desde_receta: "Recalculó el costo desde la receta",
  costo_guardado: "Guardó el costo de un plato",
  costo_pct_aplicado: "Ajustó los costos en %",
  cuenta_abierta: "Abrió una mesa",
  cuenta_abonada: "Recibió un abono",
  cuenta_cobrada: "Cobró la cuenta",
  cuenta_descartada: "Descartó una cuenta vacía",
  cuenta_devuelta: "Cerró con devolución",
  cuenta_renombrada: "Puso nombre a la mesa",
  cuenta_detalle: "Anotó un dato en la cuenta",
  cuenta_fiscal: "Guardó datos de factura",
  cuenta_dividida: "Dividió la cuenta",
  cuenta_extras: "Aplicó propina o descuento",
  cuenta_precuenta: "Pidió la cuenta",
  cuenta_reabierta: "Reabrió la cuenta",
  cuenta_reabierta_cobrada: "Reabrió una cuenta ya cobrada",
  cuenta_venta_directa: "Abrió una venta en mostrador",
  demo_reinicio: "Reinició el negocio de demostración",
  deuda_abono: "Abonó a un proveedor",
  deuda_alta: "Registró una deuda con proveedor",
  deuda_borra: "Eliminó una deuda con proveedor",
  deuda_edicion: "Editó una deuda con proveedor",
  devolucion: "Devolvió un plato ya servido",
  devolucion_confirmada: "Confirmó una devolución",
  equipo_alta: "Añadió a una persona al equipo",
  equipo_areas: "Cambió las áreas de una persona",
  equipo_cambio_rol: "Cambió el rol de una persona",
  equipo_edicion: "Editó a una persona del equipo",
  equipo_permisos: "Cambió los permisos de una persona",
  equipo_invito: "Invitó a una persona",
  equipo_restablecio_clave: "Restableció una clave",
  equipo_revoco: "Quitó el acceso a una persona",
  exportar_datos: "Exportó los datos del negocio",
  insumo_borrar: "Eliminó un insumo",
  insumo_guardar: "Guardó un insumo",
  insumo_merma: "Registró una merma",
  insumo_movimiento: "Movió inventario",
  item_agregado: "Agregó un producto",
  item_anulacion_pedida: "Pidió anular un producto",
  item_anulacion_resuelta: "Resolvió una anulación",
  item_anulado: "Anuló un producto",
  item_cantidad: "Cambió una cantidad",
  item_movido: "Pasó un producto a otra mesa",
  item_movido_parcial: "Pasó parte de un producto a otra mesa",
  item_nota: "Escribió una nota en un producto",
  item_salida: "Marcó un producto como listo",
  item_salida_deshacer: "Deshizo un producto listo",
  items_intercambiados: "Intercambió productos entre cuentas",
  llevar_a_mesa: "Pasó un pedido para llevar a una mesa",
  llevar_edicion: "Editó los datos de un pedido para llevar",
  margen_aplicado: "Recalculó precios por margen",
  menu_grupo_alta: "Creó un grupo",
  menu_grupo_baja: "Eliminó un grupo",
  menu_grupo_edicion: "Editó un grupo",
  menu_item_alta: "Creó un producto",
  menu_item_baja: "Eliminó un producto",
  menu_item_edicion: "Editó un producto",
  mesa_separada: "Separó una mesa",
  mesa_unidas: "Unió mesas",
  pedido_deshace_listo: "Deshizo un pedido listo",
  pedido_listo: "Marcó un pedido como listo",
  plan_vencido: "Venció el plan del negocio",
  proveedor_borro: "Eliminó un proveedor",
  proveedor_desactivo: "Desactivó un proveedor",
  proveedor_guardo: "Guardó un proveedor",
  purga_retencion: "Limpió datos antiguos",
  receta_guardar: "Guardó una receta",
  salida: "Cerró la sesión",
  salon_mesa_alta: "Creó una mesa",
  salon_mesa_baja: "Eliminó una mesa",
  salon_mesa_edicion: "Editó una mesa",
  salon_zona_alta: "Creó un salón",
  salon_zona_baja: "Eliminó un salón",
  salon_zona_edicion: "Editó un salón",
  subcuentas_unidas: "Unió subcuentas",
  super_ajustar_cuota: "El super ajustó la cuota del plan",
  super_alta: "El super dio de alta una empresa",
  super_cambio_plan: "El super cambió el plan",
  super_entro: "El super entró al negocio",
  super_exporto: "El super exportó los datos",
  super_importo: "El super importó datos",
  super_reset_clave: "El super restableció una clave",
  throttle_agotado: "Demasiados intentos de acceso",
  turno_abierto: "Abrió el turno de caja",
  turno_cerrado: "Cerró el turno de caja",
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

// El detalle guarda datos técnicos (ids, nulos, banderas en falso). Aquí solo queda lo que una persona entiende:
// sin identificadores, sin vacíos y sin «falso»; las banderas en verdadero salen como etiqueta.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAVES_DETALLE = { persona: 'Persona', correo: 'Correo', dio: 'Dio permiso', quito: 'Quitó permiso', dueno: 'Dueño', items: 'Ítems', numero: 'Número', parcial: 'Parcial', ayuda: 'Ayuda', motivo: 'Motivo', monto: 'Monto', total: 'Total', cantidad: 'Cantidad', nombre: 'Nombre', mesa: 'Mesa', metodo: 'Método', rol: 'Rol', antes: 'Antes', despues: 'Después' }
const etiquetaClave = k => CLAVES_DETALLE[String(k).toLowerCase()] || humanizar(k)
const esTecnica = k => /^(numero|mesa|mesas|tipo)$/i.test(String(k)) || /(^|_)(id|ids|uuid)$/i.test(String(k)) || /^(cuenta|empresa|usuario|user|item|turno|mesa)_?id$/i.test(String(k)) || String(k).toLowerCase() === 'cuenta'
const valorLegible = v => {
  if (v === null || v === undefined || v === '' || v === false) return null
  if (typeof v === 'string') return UUID.test(v) ? null : v
  if (Array.isArray(v)) { const xs = v.map(valorLegible).filter(x => x !== null); return xs.length ? xs.join(', ') : null }
  if (typeof v === 'object') { const t = partesDetalle(v).join(' · '); return t || null }
  return String(v)
}
function partesDetalle(det) {
  return Object.entries(det || {}).flatMap(([k, v]) => {
    if (esTecnica(k)) return []
    if (v === true) return [etiquetaClave(k)]
    const txt = valorLegible(v)
    return txt === null ? [] : [`${etiquetaClave(k)}: ${txt}`]
  })
}
const textoDetalle = det => {
  if (!det || typeof det !== 'object') return '—'
  const partes = partesDetalle(det)
  return partes.length ? partes.join(' · ') : '—'
}

function fechaLegible(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(LOCALE[idiom] || 'es', { dateStyle: 'short', timeStyle: 'short' })
}

const nombreActor = e => e.actor_nombre || e.actor || '—'

// «Sobre qué»: la mesa o el dato, en palabras. Los registros nuevos ya traen «Mesa 3 · Gonzalo»; los viejos traían
// «cuenta 123» (un número interno) o solo el nombre de la mesa («3», «1, 2»): se muestran como Cuenta 123 / Mesa 3.
const etiquetaRegistro = e => {
  const l = String(e.entity_label || '').trim()
  if (!l) return e.entity_type ? humanizar(e.entity_type) : '—'
  const c = l.match(/^cuenta\s+(\S+)$/i)
  if (c) return `Cuenta ${c[1]}`
  if (e.entity_type === 'cuenta' && /^[0-9]+(\s*[,+]\s*[0-9]+)*$/.test(l)) return (/[,+]/.test(l) ? 'Mesas ' : 'Mesa ') + l.replace(/\s*,\s*/g, ' + ')
  return l
}

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
    .filter(e => !q || [nombreActor(e), etiquetaRol(e.actor_rol, tOr), e.accion, etiquetaAccion(e.accion, tOr), e.entity_type, etiquetaRegistro(e), textoDetalle(e.detalle)].join(' ').toLowerCase().includes(q))
    .filter(e => filtroAccion === 'todas' || e.accion === filtroAccion)
    .filter(e => filtroActor === 'todos' || nombreActor(e) === filtroActor)
    .sort((a, b) => new Date(b.en) - new Date(a.en))

  const accionesDisponibles = [...new Set((entries || []).map(e => e.accion).filter(Boolean))].sort()
  const actoresDisponibles = [...new Set((entries || []).map(nombreActor))].sort()

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
    { key: 'entity_label', label: tOr('auditoria.colRegistro', 'Registro'), render: etiquetaRegistro },
    { key: 'detalle', label: tOr('auditoria.colDetalle', 'Detalle'), render: e => textoDetalle(e.detalle), sortable: false },
  ]

  const contador = tOr('auditoria.eventos', `${list.length} eventos`, { n: list.length })

  return (
    <div className="adm-panel">
      <section className="adm-card aud-card">
        <div className="adm-card-cab aud-cab">
          <div>
            <h3>{tOr('auditoria.titulo', 'Auditoría')}</h3>
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
              <button type="button" className="ghost" onClick={loadAll} disabled={cargando}>
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
