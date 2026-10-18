// Cocina / Barra: tablero de comandas, UNA VISTA POR ÁREA (pestañas «Vista Cocina» / «Vista Barra»).
// Cada vista muestra solo las comandas de su área en tarjetas compactas (la más antigua primero) con
// contador mm:ss; en cada tarjeta se marca producto por producto («Ya salió») y SOLO en esa área:
// un combo cocina+barra marcado en Cocina sigue pendiente en Barra (tabla cuenta_item_areas).
// «Sacadas» es independiente por vista (cada área ve y deshace solo lo suyo, con su contador).
// RPC: cola_de_area, marcar_salida(p_area), deshacer_salida(p_area), pedir_anulacion, resolver_anulacion.
// Refresco cada 4 s + Realtime sobre cuenta_items y cuenta_item_areas.
// Roles: cocina/barra arrancan en su área; admin/cajero/mesero abren cualquiera y autorizan anulaciones.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { rpc, mensajeError, sb, obtenerEmpresaActiva } from '../../services/supabase.js'
import { useStore } from '../../services/store.jsx'
import { gruposDeComanda, SIN_AREA } from '../../services/impresion.js'
import './CocinaPage.css'

const SONDEO_MS = 4000
const AMARILLO_MIN = 5        // el contador pasa a ámbar
const URGENTE_MIN = 10        // y a rojo
const PERMITIDOS = ['cocina', 'barra', 'admin', 'cajero', 'mesero']
const LLAVE_VISTA = 'pos-cocina-vista'

const hora = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
const ms = ts => { const n = Date.parse(ts); return Number.isFinite(n) ? n : null }

// Contador mm:ss (h:mm:ss pasada la hora) desde que entró la comanda.
function cronometro(desde, ahora) {
  if (!desde) return '--:--'
  const s = Math.max(0, Math.floor((ahora - desde) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const MOTIVOS = [
  { clave: 'cocina.mot.noSalio', txt: 'No salió' },
  { clave: 'cocina.mot.cambio', txt: 'Cambio del cliente' },
  { clave: 'cocina.mot.error', txt: 'Error al pedir' },
  { clave: 'cocina.mot.otro', txt: 'Otro' },
]

export default function CocinaPage({ rol, sesion }) {
  const { t, tOr } = useIdioma()
  const conectado = Boolean(sesion?.supabase)
  const permitido = PERMITIDOS.includes(rol)
  const puedeAutorizar = rol === 'admin' || rol === 'cajero'
  const empresaId = sesion?.empresaId || obtenerEmpresaActiva() || null
  const { s } = useStore()

  // v0.18: las áreas son los grupos de comanda de la empresa (Configuración → Impresoras). cocina/barra
  // pueden tener áreas asignadas (membresias.areas; vacío = todas): solo ven esas.
  const grupos = useMemo(() => gruposDeComanda(s.config), [s.config])
  const [misAreas, setMisAreas] = useState([])
  const restringido = (rol === 'cocina' || rol === 'barra') && misAreas.length > 0
  const idsGrupos = useMemo(() => grupos.map(g => g.id), [grupos])
  const idsVisibles = useMemo(() => (restringido ? idsGrupos.filter(id => misAreas.includes(id)) : idsGrupos), [idsGrupos, misAreas, restringido])
  useEffect(() => {
    if (!conectado || !(rol === 'cocina' || rol === 'barra')) return undefined
    let vivo = true
    rpc('mis_areas', {}).then(r => { if (vivo) setMisAreas(Array.isArray(r) ? r : []) }).catch(() => {})
    return () => { vivo = false }
  }, [conectado, rol])

  // Una sola vista a la vez. cocina/barra arrancan en la suya; el resto en la última elegida en este
  // equipo (si no hay, Cocina). Un valor guardado antiguo («ambas») se ignora.
  const [vista, setVista] = useState(() => {
    const ids = gruposDeComanda(s.config).map(g => g.id)
    if (rol === 'cocina' || rol === 'barra') return ids.includes(rol) ? rol : (ids[0] || 'cocina')
    try { const v = localStorage.getItem(LLAVE_VISTA); if (v === SIN_AREA || ids.includes(v)) return v } catch { /* sin almacenamiento */ }
    return ids[0] || 'cocina'
  })
  const cambiarVista = v => { setVista(v); setSacadasAbierto(false); try { localStorage.setItem(LLAVE_VISTA, v) } catch { /* ignore */ } }
  // La vista «Sin área» (ítems cuya área fue borrada) se precarga siempre para poder avisar de que existen.
  const verSinArea = !restringido
  const areasMostradas = useMemo(() => [vista], [vista])   // lo que se dibuja; areasVisibles es lo que se carga
  const areasVisibles = useMemo(() => (verSinArea && vista !== SIN_AREA ? [vista, SIN_AREA] : [vista]), [vista, verSinArea])
  // Si la vista guardada ya no existe (área borrada) o no está asignada a esta persona, cae a la primera.
  useEffect(() => {
    if (vista === SIN_AREA && verSinArea) return
    if (idsVisibles.length && !idsVisibles.includes(vista)) cambiarVista(idsVisibles[0])
  }, [idsVisibles, vista, verSinArea]) // eslint-disable-line react-hooks/exhaustive-deps

  const [colas, setColas] = useState({})
  const [cargando, setCargando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())
  const [ultimo, setUltimo] = useState(0)
  const [realtime, setRealtime] = useState(false)
  const [recien, setRecien] = useState({})        // clave de comanda → Date.now() en que llegó
  const [ocupado, setOcupado] = useState('')
  const [anulando, setAnulando] = useState(null)  // { id, nombre }
  const [motivo, setMotivo] = useState('')
  const [sacadasAbierto, setSacadasAbierto] = useState(false)

  const vistosRef = useRef({}) // ids 'enviado' del refresco anterior, por área
  const cargandoRef = useRef(false)
  const colasRef = useRef({})
  const cargarRef = useRef(null)
  const areasRef = useRef(areasVisibles)
  areasRef.current = areasVisibles

  const avisar = useCallback(msg => setAviso(msg || ''), [])

  const cargar = useCallback(async () => {
    if (!conectado || cargandoRef.current) return
    cargandoRef.current = true
    setCargando(true)
    try {
      const areas = areasRef.current
      const res = await Promise.all(areas.map(a => rpc('cola_de_area', a === SIN_AREA ? { p_area: a, p_validas: idsGrupos } : { p_area: a }).then(d => [a, Array.isArray(d) ? d : []])))
      const nuevoRecien = {}
      const sig = { ...colasRef.current }
      res.forEach(([a, lista]) => {
        sig[a] = lista
        const enviados = new Set()
        lista.forEach(c => (c.items || []).forEach(it => { if (it.estado === 'enviado') enviados.add(it.id) }))
        const antes = vistosRef.current[a]
        if (antes) lista.forEach(c => { if ((c.items || []).some(it => it.estado === 'enviado' && !antes.has(it.id))) nuevoRecien[a + ':' + c.cuenta_id] = Date.now() })
        vistosRef.current[a] = enviados
      })
      colasRef.current = sig
      setColas(sig)
      if (Object.keys(nuevoRecien).length) setRecien(r => ({ ...r, ...nuevoRecien }))
      setAhora(Date.now())
      setUltimo(Date.now())
      setAviso('')
    } catch (e) {
      avisar(mensajeError(e))
    } finally {
      cargandoRef.current = false
      setCargando(false)
    }
  }, [conectado, avisar, idsGrupos])
  cargarRef.current = cargar

  // Sondeo + primera carga (y al cambiar de vista, sin contar la cola entera como «nueva»).
  useEffect(() => {
    if (!conectado || !permitido) return undefined
    areasVisibles.forEach(a => { vistosRef.current[a] = null })
    cargarRef.current?.()
    const poll = setInterval(() => cargarRef.current?.(), SONDEO_MS)
    return () => clearInterval(poll)
  }, [conectado, permitido, areasVisibles])

  // Reloj de los contadores (1 s). Solo re-pinta; no pide datos.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Realtime sobre cuenta_items y cuenta_item_areas; si no conecta, queda el sondeo.
  useEffect(() => {
    if (!conectado || !permitido || !sb || !empresaId) { setRealtime(false); return undefined }
    let canal = null
    try {
      canal = sb.channel('cocina-' + empresaId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cuenta_items', filter: `empresa_id=eq.${empresaId}` }, () => cargarRef.current?.())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cuenta_item_areas', filter: `empresa_id=eq.${empresaId}` }, () => cargarRef.current?.())
        .subscribe(st => setRealtime(st === 'SUBSCRIBED'))
    } catch { setRealtime(false) }
    return () => { setRealtime(false); try { if (canal) sb.removeChannel(canal) } catch { /* ignore */ } }
  }, [conectado, permitido, empresaId])

  // ── acciones ──
  const accion = async (item, fn) => {
    if (ocupado) return
    setOcupado(item.id)
    try {
      await fn()
      await cargarRef.current?.()
      window.dispatchEvent(new Event('pos-reanudar')) // el salón y la caja ven el cambio ya
    } catch (e) { avisar(mensajeError(e)) } finally { setOcupado('') }
  }
  // Siempre con el área de la vista: «salió» en Cocina no lo marca en Barra (y al revés).
  const marcarSalio = item => accion(item, () => rpc('marcar_salida', { p_item_ids: [item.id], p_area: vista === SIN_AREA ? null : vista }))
  const deshacer = item => accion(item, () => rpc('deshacer_salida', { p_item_ids: [item.id], p_area: vista === SIN_AREA ? null : vista }))
  const abrirAnular = item => { setAnulando({ id: item.id, nombre: item.nombre }); setMotivo('') }
  const cerrarAnular = () => { setAnulando(null); setMotivo('') }
  const pedirAnulacion = () => {
    const item = anulando
    const txt = motivo.trim()
    if (!item || !txt) return
    setOcupado(item.id)
    cerrarAnular()
    rpc('pedir_anulacion', { p_item_id: item.id, p_motivo: txt })
      .then(() => { cargarRef.current?.(); window.dispatchEvent(new Event('pos-reanudar')) })
      .catch(e => avisar(mensajeError(e)))
      .finally(() => setOcupado(''))
  }
  const resolver = (item, aprobar) => accion(item, () => rpc('resolver_anulacion', { p_item_id: item.id, p_aprobar: aprobar, p_motivo: null }))

  // ── derivados por fila: comandas en curso y comandas sacadas ──
  const filas = useMemo(() => {
    const out = {}
    areasMostradas.forEach(a => {
      const enCurso = [], sacadas = []
      ;(colas[a] || []).forEach(c => {
        const items = c.items || []
        const pend = items.filter(i => i.estado !== 'listo')
        if (pend.length) {
          const tiempos = pend.map(i => ms(i.enviada_en)).filter(Boolean)
          enCurso.push({ ...c, area: a, desde: tiempos.length ? Math.min(...tiempos) : ms(c.enviada_en) })
        } else if (items.length) {
          const salidas = items.map(i => ms(i.listo_en)).filter(Boolean)
          sacadas.push({ ...c, area: a, salioEn: salidas.length ? Math.max(...salidas) : null })
        }
      })
      enCurso.sort((x, y) => (x.desde || 0) - (y.desde || 0)) // la más antigua primero
      sacadas.sort((x, y) => (y.salioEn || 0) - (x.salioEn || 0)) // la última sacada primero
      out[a] = { enCurso, sacadas }
    })
    return out
  }, [colas, areasMostradas])
  const totalSacadas = areasMostradas.reduce((n, a) => n + (filas[a]?.sacadas.length || 0), 0)

  if (!permitido) return <div className="cocina adm-panel"><div className="auth-aviso">{tOr('cocina.sinPermiso', 'Esta pantalla no está habilitada para tu rol.')}</div></div>
  if (!conectado) return <div className="cocina adm-panel"><div className="auth-aviso">{tOr('cocina.soloConectado', 'La pantalla de cocina y barra requiere la conexión con el servidor.')}</div></div>

  const nombreArea = a => (a === SIN_AREA ? tOr('cocina.sinArea', 'Sin área') : (grupos.find(g => g.id === a)?.nombre || tOr('cocina.area.' + a, a)))
  const icono = a => (a === SIN_AREA ? '⚠️' : a === 'cocina' ? '🍳' : a === 'barra' ? '🍹' : '🍽️')
  const tabs = [...idsVisibles, ...(verSinArea && ((colas[SIN_AREA] || []).length > 0 || vista === SIN_AREA) ? [SIN_AREA] : [])]
  const nivel = desde => {
    if (!desde) return ''
    const min = (ahora - desde) / 60000
    return min >= URGENTE_MIN ? ' rojo' : min >= AMARILLO_MIN ? ' ambar' : ''
  }
  const tituloMesa = c => `${c.mesa || tOr('cocina.mostrador', 'Mostrador')}${c.etiqueta || ''}`

  // Una fila de un producto: tocar el círculo ✓ lo marca como salido (uno a uno, aunque sean de la misma cuenta).
  const renderItem = (it, area) => {
    const listo = it.estado === 'listo'
    const anulacion = it.estado === 'anulacion'
    const otras = (it.areas || []).filter(x => x !== area)
    return (
      <li key={it.id} className={'ck-item' + (listo ? ' listo' : '') + (anulacion ? ' anul' : '')}>
        <div className="ck-item-fila">
          <span className="ck-qty">{it.qty}</span>
          <div className="ck-item-cuerpo">
            <b className="ck-nombre">{it.nombre}</b>
            {otras.length > 0 && <span className="ck-combo" title={tOr('areas.title', 'Áreas donde se imprime este artículo')}>+ {otras.map(nombreArea).join(', ')}</span>}
            {it.nota && <div className="ck-nota">📝 {it.nota}</div>}
            {listo && it.listo_en && <small className="ck-listo-hora">✓ {tOr('cocina.salio', 'Salió')} {hora(it.listo_en)}</small>}
          </div>
          <div className="ck-item-acc">
            {!anulacion && !listo && (
              <button type="button" className="ck-check" disabled={!!ocupado} onClick={() => marcarSalio(it)}
                title={tOr('cocina.yaSalio', 'Ya salió')} aria-label={`${tOr('cocina.yaSalio', 'Ya salió')}: ${it.nombre}`}>✓</button>
            )}
            {listo && (
              <button type="button" className="ck-mini ghost" disabled={!!ocupado} onClick={() => deshacer(it)}
                title={tOr('cocina.deshacer', 'Deshacer')} aria-label={`${tOr('cocina.deshacer', 'Deshacer')}: ${it.nombre}`}>↩</button>
            )}
            {!anulacion && !listo && (
              <button type="button" className="ck-mini danger" disabled={!!ocupado} onClick={() => abrirAnular(it)}
                title={tOr('cocina.anular', 'Anular')} aria-label={`${tOr('cocina.anular', 'Anular')}: ${it.nombre}`}>⊘</button>
            )}
          </div>
        </div>

        {anulacion && (
          <div className="ck-anul-block">
            <b>⛔ {tOr('cocina.quiereAnular', 'Quiere anular')}: {it.anulacion_motivo || tOr('cocina.sinMotivo', 'sin motivo')}</b>
            {puedeAutorizar ? (
              <div className="ck-anul-acc">
                <button type="button" className="cocina-btn success" disabled={!!ocupado} onClick={() => resolver(it, true)}>✓ {tOr('cocina.aprobar', 'Aprobar')}</button>
                <button type="button" className="cocina-btn danger" disabled={!!ocupado} onClick={() => resolver(it, false)}>✕ {tOr('cocina.rechazar', 'Rechazar')}</button>
              </div>
            ) : <small className="ck-espera">⏳ {tOr('cocina.esperandoCaja', 'Esperando autorización de caja')}</small>}
          </div>
        )}

        {anulando?.id === it.id && (
          <div className="ck-anul-panel" role="group" aria-label={tOr('cocina.anular', 'Anular')}>
            <b>{tOr('cocina.motivoTitulo', 'Motivo de anulación')} · {it.nombre}</b>
            <div className="ck-motivos">
              {MOTIVOS.map(m => (
                <button key={m.clave} type="button" className={'ck-motivo' + (motivo === tOr(m.clave, m.txt) ? ' on' : '')} onClick={() => setMotivo(tOr(m.clave, m.txt))}>{tOr(m.clave, m.txt)}</button>
              ))}
            </div>
            <input autoFocus className="ck-motivo-txt" maxLength={120} value={motivo} placeholder={tOr('cocina.motivoPlace', 'Escribe o elige un motivo…')}
              onChange={e => setMotivo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') pedirAnulacion(); if (e.key === 'Escape') cerrarAnular() }} />
            <div className="ck-anul-acc">
              <button type="button" className="cocina-btn danger" disabled={!motivo.trim() || !!ocupado} onClick={pedirAnulacion}>{tOr('cocina.pedirAnulacion', 'Pedir anulación')}</button>
              <button type="button" className="cocina-btn ghost" onClick={cerrarAnular}>{tOr('comun.cancelar', 'Cancelar')}</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const renderComanda = c => {
    const clave = c.area + ':' + c.cuenta_id
    const pendientes = (c.items || []).filter(i => i.estado === 'enviado').length
    const nueva = recien[clave] && ahora - recien[clave] < 8000
    return (
      <article key={clave} className={'ck-card' + nivel(c.desde) + (nueva ? ' nueva' : '')}>
        <header className="ck-cab">
          <b className="ck-mesa">{tituloMesa(c)}</b>
          {Number(c.comensales) > 0 && <span className="ck-tag" title={tOr('cocina.comensales', 'Comensales')}>👥 {c.comensales}</span>}
          <span className="ck-sp" />
          <span className={'ck-timer' + nivel(c.desde)} title={c.desde ? `${tOr('cocina.entro', 'Entró a las')} ${hora(c.desde)}` : ''}>⏱ {cronometro(c.desde, ahora)}</span>
        </header>
        <div className="ck-meta">
          <span>{c.desde ? `${tOr('cocina.entro', 'Entró a las')} ${hora(c.desde)}` : ''}</span>
          {pendientes > 0 && <span className="ck-tag pend">{tOr('cocina.porSalir', `Por salir: ${pendientes}`, { n: pendientes })}</span>}
        </div>
        <ul className="ck-items">{(c.items || []).map(it => renderItem(it, c.area))}</ul>
      </article>
    )
  }

  return (
    <div className="cocina ck">
      <div className="ck-barra">
        <div className="ck-tabs" role="tablist" aria-label={tOr('cocina.areas', 'Áreas')}>
          {tabs.map(v => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} className={'ck-tab' + (vista === v ? ' on' : '')} onClick={() => cambiarVista(v)}>
              {icono(v)} {t('cocina.vistaDe', { area: nombreArea(v) })}
            </button>
          ))}
        </div>
        <span className="ck-sp" />
        <button type="button" className={'ck-sacadas' + (sacadasAbierto ? ' on' : '')} aria-expanded={sacadasAbierto} onClick={() => setSacadasAbierto(v => !v)}
          title={tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}>
          ✓ {tOr('cocina.sacadas', 'Sacadas')}{totalSacadas > 0 && <em>{totalSacadas}</em>}
        </button>
        <span className={'ck-conexion' + (realtime ? ' rt' : '')} title={tOr('cocina.conexionTitle', 'Actualización automática cada 4 segundos')}>{realtime ? '🟢' : '🔄'}</span>
        <button type="button" className="ck-act ghost" onClick={() => cargarRef.current?.()} disabled={cargando} aria-label={tOr('cocina.actualizar', 'Actualizar')} title={tOr('cocina.actualizar', 'Actualizar')}>
          <span className={'cocina-flecha' + (cargando ? ' spin' : '')} aria-hidden="true">↻</span>
        </button>
      </div>

      {aviso && (
        <div className="auth-aviso cocina-aviso" role="alert">
          <span>⚠️ {aviso}</span>
          <button type="button" className="ico" onClick={() => setAviso('')} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button>
        </div>
      )}

      {/* Panel pequeño de comandas sacadas (con deshacer por producto) */}
      {sacadasAbierto && (
        <section className="ck-panel-sacadas" aria-label={tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}>
          <header><b>✓ {tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}</b>
            <button type="button" className="ico" onClick={() => setSacadasAbierto(false)} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button></header>
          {totalSacadas === 0 && <p className="ck-vacio-mini">{tOr('cocina.sinSacadas', 'Todavía no hay comandas sacadas.')}</p>}
          {areasMostradas.map(a => (filas[a]?.sacadas.length ? (
            <div key={a} className="ck-sac-grupo">
              {areasMostradas.length > 1 && <h4>{icono(a)} {nombreArea(a)}</h4>}
              <ul>
                {filas[a].sacadas.map(c => (
                  <li key={c.cuenta_id} className="ck-sac">
                    <div className="ck-sac-cab"><b>{tituloMesa(c)}</b><small>{c.salioEn ? `${tOr('cocina.salio', 'Salió')} ${hora(c.salioEn)}` : ''}</small></div>
                    <ul>
                      {(c.items || []).map(it => (
                        <li key={it.id}><span>{it.qty}× {it.nombre}{it.nota ? ` · ${it.nota}` : ''}</span>
                          <button type="button" className="ck-mini ghost" disabled={!!ocupado} onClick={() => deshacer(it)} title={tOr('cocina.deshacer', 'Deshacer')} aria-label={`${tOr('cocina.deshacer', 'Deshacer')}: ${it.nombre}`}>↩</button></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null))}
        </section>
      )}

      {/* Filas: una por área */}
      {vista === SIN_AREA && <div className="auth-aviso" role="status">{tOr('cocina.sinAreaAviso', 'Estos ítems fueron enviados a un área que ya no existe. Márcalos cuando salgan.')}</div>}
      <div className={'ck-filas' + (areasMostradas.length > 1 ? ' dos' : '')}>
        {areasMostradas.map(a => {
          const { enCurso } = filas[a] || { enCurso: [] }
          return (
            <section key={a} className={'ck-fila ' + a} aria-label={nombreArea(a)}>
              <header className="ck-fila-cab">
                <h3>{icono(a)} {nombreArea(a)}</h3>
                <span className="ck-cuenta">{enCurso.length}</span>
              </header>
              {enCurso.length === 0 ? (
                <div className="ck-vacio"><b>✅ {tOr('cocina.vacio', 'No hay pedidos por preparar')}</b>
                  <small>{ultimo ? tOr('cocina.ultimoRefresco', `Última actualización a las ${hora(ultimo)}`, { h: hora(ultimo) }) : tOr('cocina.cargando', 'Cargando…')}</small></div>
              ) : <div className="ck-grid">{enCurso.map(renderComanda)}</div>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
