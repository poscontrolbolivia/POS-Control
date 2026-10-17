// Cocina / Barra: pantalla táctil de área. Muestra en digital los pedidos enviados al área
// (cocina o barra), permite marcar lo que ya salió y pedir/autorizar anulaciones.
// El DB ya define las RPC: cola_de_area, marcar_salida, deshacer_salida, pedir_anulacion,
// resolver_anulacion (ver contracto en la tarea). Refresco cada 4s + Realtime sobre cuenta_items.
// Roles: cocina/barra ven su área (pueden alternar); admin/cajero/mesero alternan y autorizan.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { rpc, mensajeError, sb, obtenerEmpresaActiva } from '../../services/supabase.js'
import './CocinaPage.css'

const SONDEO_MS = 4000
const URGENTE_MIN = 10       // la tarjeta se pone roja pasados ~10 min desde el envío
const AREAS = ['cocina', 'barra']
const PERMITIDOS = ['cocina', 'barra', 'admin', 'cajero', 'mesero']
const LLAVE_AREA = 'pos-cocina-area'

// Hora legible (hh:mm) igual que las otras páginas del proyecto; helper local simple.
const hora = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// Motivos rápidos para pedir anulación (se traducen vía tOr; el texto se envía a la base).
const MOTIVOS = [
  { clave: 'cocina.mot.noSalio', txt: 'No salió' },
  { clave: 'cocina.mot.cambio', txt: 'Cambio del cliente' },
  { clave: 'cocina.mot.error', txt: 'Error al pedir' },
  { clave: 'cocina.mot.otro', txt: 'Otro' },
]

export default function CocinaPage({ rol, sesion }) {
  const { tOr } = useIdioma()
  const conectado = Boolean(sesion?.supabase)
  const permitido = PERMITIDOS.includes(rol)
  const puedeAutorizar = rol === 'admin' || rol === 'cajero'
  const empresaId = sesion?.empresaId || obtenerEmpresaActiva() || null

  // Área visible: cocina/barra arrancan en la suya; los alternadores recuerdan la última.
  const [area, setArea] = useState(() => {
    if (rol === 'cocina') return 'cocina'
    if (rol === 'barra') return 'barra'
    try { const a = localStorage.getItem(LLAVE_AREA); if (AREAS.includes(a)) return a } catch { /* sin almacenamiento */ }
    return 'cocina'
  })
  const cambiarArea = a => {
    if (!AREAS.includes(a) || a === area) return
    setArea(a)
    vistosRef.current = null // cambio de área: no contar como "nuevos" la cola entera
    setNuevos(0)
    try { localStorage.setItem(LLAVE_AREA, a) } catch { /* ignore */ }
  }

  const [cola, setCola] = useState([])
  const [cargando, setCargando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())
  const [ultimo, setUltimo] = useState(0)   // Date.now() del último refresco exitoso
  const [realtime, setRealtime] = useState(false)
  const [nuevos, setNuevos] = useState(0)
  const [ocupado, setOcupado] = useState('') // item_id con acción en vuelo
  // Panel propio de anulación (nunca confirm/alert): { id, nombre } mientras está abierto.
  const [anulando, setAnulando] = useState(null)
  const [motivo, setMotivo] = useState('')

  const vistosRef = useRef(null) // Set de ids 'enviado' del refresco anterior
  const cargandoRef = useRef(false)
  const cargarRef = useRef(null)

  const avisar = useCallback(msg => setAviso(msg || ''), [])

  const cargar = useCallback(async () => {
    if (!conectado) return
    if (cargandoRef.current) return
    cargandoRef.current = true
    setCargando(true)
    try {
      const data = await rpc('cola_de_area', { p_area: area })
      const lista = Array.isArray(data) ? data : []
      setCola(lista)
      setAhora(Date.now())
      setUltimo(Date.now())
      setAviso('') // un refresco bueno limpia el aviso anterior
      // Contador de "Nuevos": ítems 'enviado' que no estaban en el refresco anterior.
      const enviados = new Set()
      lista.forEach(c => (c.items || []).forEach(it => { if (it.estado === 'enviado') enviados.add(it.id) }))
      const prev = vistosRef.current
      if (prev === null) setNuevos(0)
      else {
        let n = 0
        enviados.forEach(id => { if (!prev.has(id)) n++ })
        setNuevos(n)
      }
      vistosRef.current = enviados
    } catch (e) {
      avisar(mensajeError(e))
    } finally {
      cargandoRef.current = false
      setCargando(false)
    }
  }, [area, conectado, avisar])
  cargarRef.current = cargar

  // Auto-refresco por sondeo (siempre activo) + primera carga al entrar / cambiar de área.
  useEffect(() => {
    if (!conectado || !permitido) return undefined
    vistosRef.current = null
    setNuevos(0)
    cargarRef.current?.()
    const poll = setInterval(() => cargarRef.current?.(), SONDEO_MS)
    return () => clearInterval(poll)
  }, [conectado, permitido, area])

  // Realtime sobre cuenta_items: alta del canal tras fijar la empresa; se recrea si cambia empresaId.
  // Si el canal no se conecta (o no hay sb) degradamos a solo sondeo (el interval de arriba manda).
  useEffect(() => {
    if (!conectado || !permitido || !sb || !empresaId) { setRealtime(false); return undefined }
    let canal = null
    try {
      canal = sb.channel('cocina-' + empresaId + '-' + area)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cuenta_items', filter: `empresa_id=eq.${empresaId}` },
          () => cargarRef.current?.())
        .subscribe(st => { setRealtime(st === 'SUBSCRIBED') })
    } catch { setRealtime(false) }
    return () => { setRealtime(false); try { if (canal) sb.removeChannel(canal) } catch { /* ignore */ } }
  }, [conectado, permitido, empresaId, area])

  // ── acciones (llaman a la RPC y refrescan; nunca revientan) ──
  const accion = async (item, fn) => {
    if (ocupado) return
    setOcupado(item.id)
    try {
      await fn()
      await cargarRef.current?.()
      // La salida/anulación también cambia el total de la cuenta: sin esto, el salón y la
      // caja siguen mostrando el ítem anulado como cobrable hasta recargar la página.
      window.dispatchEvent(new Event('pos-reanudar'))
    }
    catch (e) { avisar(mensajeError(e)) }
    finally { setOcupado('') }
  }

  const marcarSalio = item => accion(item, () => rpc('marcar_salida', { p_item_ids: [item.id] }))
  const deshacer = item => accion(item, () => rpc('deshacer_salida', { p_item_ids: [item.id] }))

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

  // ── pantallas de guardia (igual que EstacionPage) ──
  if (!permitido) return <div className="cocina adm-panel"><div className="auth-aviso">{tOr('cocina.sinPermiso', 'Esta pantalla no está habilitada para tu rol.')}</div></div>
  if (!conectado) return <div className="cocina adm-panel"><div className="auth-aviso">{tOr('cocina.soloConectado', 'La pantalla de cocina y barra requiere la conexión con el servidor.')}</div></div>

  // Antigüedad legible: "hace N min"; rojo pasado URGENTE_MIN. El literal ya lleva el número
  // (si la clave no existe aún en los diccionarios, tOr muestra el fallback tal cual).
  const antiguedad = ts => {
    const mins = Math.max(0, Math.round((ahora - Date.parse(ts)) / 60000))
    if (!Number.isFinite(mins)) return { txt: '', urgente: false }
    const urgente = mins >= URGENTE_MIN
    const txt = mins <= 1 ? tOr('cocina.haceAhora', 'recién') : mins < 60
      ? tOr('cocina.haceMin', `hace ${mins} min`, { n: mins })
      : tOr('cocina.haceHoras', `hace ${Math.floor(mins / 60)} h`, { h: Math.floor(mins / 60) })
    return { txt, urgente }
  }

  return (
    <div className="cocina">
      {/* Cabecera: pestañas de área + actualizar + estado realtime */}
      <div className="cocina-cab">
        <div className="cocina-tabs" role="tablist" aria-label={tOr('cocina.areas', 'Áreas')}>
          {AREAS.map(a => (
            <button key={a} type="button" role="tab" aria-selected={area === a}
              className={'cocina-tab' + (area === a ? ' on' : '')} onClick={() => cambiarArea(a)}>
              <span aria-hidden="true">{a === 'cocina' ? '🍳' : '🍹'}</span> {tOr('cocina.area.' + a, a === 'cocina' ? 'Cocina' : 'Barra')}
              {area === a && nuevos > 0 && <em className="cocina-nuevos">{nuevos} {tOr('cocina.nuevos', 'nuevos')}</em>}
            </button>
          ))}
        </div>
        <span className="sp" />
        <span className={'cocina-conexion ' + (realtime ? 'rt' : '')} title={tOr('cocina.conexionTitle', 'Actualización automática cada 4 segundos')}>
          {realtime ? '🟢 ' : '🔄 '}
          {tOr('cocina.actualiza', `Se actualiza solo cada ${SONDEO_MS / 1000} s`, { n: SONDEO_MS / 1000 })}
        </span>
        <button type="button" className="cocina-act ghost" onClick={() => cargarRef.current?.()} disabled={cargando}
          aria-label={tOr('cocina.actualizar', 'Actualizar')}>
          <span className={'cocina-flecha' + (cargando ? ' spin' : '')} aria-hidden="true">↻</span> {tOr('cocina.actualizar', 'Actualizar')}
        </button>
      </div>

      {/* Aviso de red / permiso (barra, no revienta) */}
      {aviso && (
        <div className="auth-aviso cocina-aviso" role="alert">
          <span>⚠️ {aviso}</span>
          <button type="button" className="ico" onClick={() => setAviso('')} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button>
        </div>
      )}

      {/* Rejilla de tarjetas por cuenta/mesa */}
      {cola.length === 0 ? (
        <div className="cocina-vacio panel">
          <b>✅ {tOr('cocina.vacio', 'No hay pedidos por preparar')}</b>
          <small>{ultimo ? tOr('cocina.ultimoRefresco', `Última actualización a las ${hora(ultimo)}`, { h: hora(ultimo) }) : tOr('cocina.cargando', 'Cargando…')}</small>
        </div>
      ) : (
        <div className="cocina-cards">
          {cola.map(c => {
            const ag = antiguedad(c.enviada_en)
            const pendientes = (c.items || []).filter(i => i.estado === 'enviado').length
            return (
              <article key={c.cuenta_id} className={'cocina-card' + (ag.urgente ? ' urgente' : '')}>
                <header className="cocina-card-cab">
                  <b className="cocina-mesa">{c.mesa || tOr('cocina.mostrador', 'Mostrador')}</b>
                  {Number(c.comensales) > 0 && <span className="cocina-tag" title={tOr('cocina.comensales', 'Comensales')}>👥 {c.comensales}</span>}
                  <span className="sp" />
                  <span className={'cocina-hora' + (ag.urgente ? ' urg' : '')}>
                    {hora(c.enviada_en)}{ag.txt ? ` · ${ag.txt}` : ''}
                  </span>
                </header>
                <div className="cocina-card-meta">
                  <span className="cocina-canal">{tOr('cocina.canal.' + (c.canal || 'mesa'), c.canal || 'mesa')}</span>
                  {pendientes > 0 && <span className="cocina-tag pend">{tOr('cocina.porSalir', `Por salir: ${pendientes}`, { n: pendientes })}</span>}
                </div>

                <ul className="cocina-items">
                  {(c.items || []).map(it => {
                    const listo = it.estado === 'listo'
                    const anulacion = it.estado === 'anulacion'
                    return (
                      <li key={it.id} className={'cocina-item' + (listo ? ' listo' : '') + (anulacion ? ' anul' : '')}>
                        <div className="cocina-item-principal">
                          <span className="cocina-qty">{it.qty}</span>
                          <div className="cocina-item-cuerpo">
                            <b className="cocina-nombre">{it.nombre}</b>
                            {(it.areas || []).length > 0 && (
                              <span className="cocina-areas">
                                {it.areas.map(a => <span key={a} className="cocina-chip">{tOr('cocina.area.' + a, a)}</span>)}
                              </span>
                            )}
                            {it.nota && <div className="cocina-nota">📝 {it.nota}</div>}
                            {listo && it.listo_en && <small className="cocina-listo-hora">✓ {tOr('cocina.salio', 'Salió')} {hora(it.listo_en)}</small>}
                          </div>
                          <div className="cocina-item-acciones">
                            {!anulacion && !listo && (
                              <button type="button" className="cocina-btn success" disabled={!!ocupado}
                                onClick={() => marcarSalio(it)}>✓ {tOr('cocina.yaSalio', 'Ya salió')}</button>
                            )}
                            {listo && (
                              <button type="button" className="cocina-btn ghost" disabled={!!ocupado}
                                onClick={() => deshacer(it)}>↩ {tOr('cocina.deshacer', 'Deshacer')}</button>
                            )}
                            {!anulacion && (
                              <button type="button" className="cocina-btn danger" disabled={!!ocupado}
                                onClick={() => abrirAnular(it)}>⊘ {tOr('cocina.anular', 'Anular')}</button>
                            )}
                          </div>
                        </div>

                        {/* Bloque de anulación pendiente de autorización */}
                        {anulacion && (
                          <div className="cocina-anul-block">
                            <b>⛔ {tOr('cocina.quiereAnular', 'Quiere anular')}: {it.anulacion_motivo || tOr('cocina.sinMotivo', 'sin motivo')}</b>
                            {puedeAutorizar ? (
                              <div className="cocina-anul-acciones">
                                <button type="button" className="cocina-btn success" disabled={!!ocupado}
                                  onClick={() => resolver(it, true)}>✓ {tOr('cocina.aprobar', 'Aprobar')}</button>
                                <button type="button" className="cocina-btn danger" disabled={!!ocupado}
                                  onClick={() => resolver(it, false)}>✕ {tOr('cocina.rechazar', 'Rechazar')}</button>
                              </div>
                            ) : (
                              <small className="cocina-espera">⏳ {tOr('cocina.esperandoCaja', 'Esperando autorización de caja')}</small>
                            )}
                          </div>
                        )}

                        {/* Mini panel de anulación (propio, nunca confirm/alert) */}
                        {anulando?.id === it.id && (
                          <div className="cocina-anul-panel" role="group" aria-label={tOr('cocina.anular', 'Anular')}>
                            <b>{tOr('cocina.motivoTitulo', 'Motivo de anulación')} · {it.nombre}</b>
                            <div className="cocina-motivos">
                              {MOTIVOS.map(m => (
                                <button key={m.clave} type="button" className={'cocina-motivo' + (motivo === tOr(m.clave, m.txt) ? ' on' : '')}
                                  onClick={() => setMotivo(tOr(m.clave, m.txt))}>{tOr(m.clave, m.txt)}</button>
                              ))}
                            </div>
                            <input autoFocus className="cocina-motivo-txt" maxLength={120} value={motivo}
                              placeholder={tOr('cocina.motivoPlace', 'Escribe o elige un motivo…')}
                              onChange={e => setMotivo(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') pedirAnulacion(); if (e.key === 'Escape') cerrarAnular() }} />
                            <div className="cocina-anul-panel-acciones">
                              <button type="button" className="cocina-btn danger" disabled={!motivo.trim() || !!ocupado} onClick={pedirAnulacion}>
                                {tOr('cocina.pedirAnulacion', 'Pedir anulación')}
                              </button>
                              <button type="button" className="cocina-btn ghost" onClick={cerrarAnular}>{tOr('comun.cancelar', 'Cancelar')}</button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
