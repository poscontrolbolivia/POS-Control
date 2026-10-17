import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, cuentaActiva, totalCuenta, totalFinal, nuevoId } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { useMoneda } from '../../services/moneda.js'
import { useIdioma } from '../../i18n/index.jsx'
import PedidoPanel from '../pedido/PedidoPanel.jsx'
import './SalonPage.css'

const W = 1000, H = 600 // coordenadas normalizadas del lienzo
const TODAS = 'todas'   // valor del filtro "ver todos los salones" (no es un id de zona)

// Longitudes que exige la base (supabase/schema.sql): zonas.nombre 1..80, mesas.nombre
// 1..60 y capacidad 1..50. Validamos en la UI para no disparar un error de RLS/RPC en pantalla.
const LARGO_ZONA = 80, LARGO_MESA = 60, CAP_MIN = 1, CAP_MAX = 50
const COM_MIN = 1, COM_MAX = 99 // cuentas.comensales between 1 and 99 (supabase/schema.sql)
const TAM_MIN = 60       // tamaño mínimo en el lienzo normalizado (mesas más chicas no se leen)
const MAX_PX_MOVIL = 768 // mismo criterio que los media-query de SalonPage.css

const estadoMesa = c => (!c ? 'libre' : c.estado === 'precuenta' ? 'porcobrar' : c.items.some(i => i.estado === 'enviado') ? 'enviada' : 'ocupada')

// ── lógica pura del salón (exportada para poder probarla sin navegador) ──

/**
 * Orden visible de los salones: `orden` cuando existe (Supabase carga la columna y
 * 'zona~' la escribe) y el índice cuando no (el seed demo y los mapas viejos no traen
 * orden). Empate resuelto por índice, para que la franja no se baraje en cada render.
 */
export const ordenarZonas = zonas => zonas
  .map((z, i) => ({ ...z, _i: i }))
  .sort((a, b) => ((a.orden ?? a._i + 1) - (b.orden ?? b._i + 1)) || (a._i - b._i))

/** Orden que recibe el salón nuevo: uno más que el último visible. */
export const ordenNuevaZona = zonas => zonas.reduce((max, z, i) => Math.max(max, z.orden ?? i + 1), 0) + 1

/**
 * Intercambio de `orden` con el vecino (misma técnica que las secciones de MenuAdmin:
 * el reducer solo tiene 'zona~', no existe acción "reordenar"). Devuelve los cambios a
 * despachar o null si no hay vecino en esa dirección.
 */
export const intercambioOrden = (zonas, i, dir) => {
  const a = zonas[i], b = zonas[i + dir]
  if (!a || !b) return null
  const oa = a.orden ?? i + 1
  let ob = b.orden ?? (i + dir) + 1
  if (oa === ob) ob = oa + dir // evita intercambios entre órdenes duplicados
  return [{ id: a.id, orden: ob }, { id: b.id, orden: oa }]
}

/** Posición dentro del lienzo normalizado (la mesa nunca sale por los bordes). */
export const dentroDelLienzo = (x, y, w, h) => ({
  x: Math.max(0, Math.min(W - w, Math.round(x))),
  y: Math.max(0, Math.min(H - h, Math.round(y))),
})

/** Capacidad válida (mesas.capacidad between 1 and 50 en la base). */
export const limitarCapacidad = cap => Math.max(CAP_MIN, Math.min(CAP_MAX, cap))

/** Cascada del alta de mesas: cada mesa nueva cae un poco más abajo/derecha, sin tapar. */
export const cascadar = (k, w = 110, h = 110) => dentroDelLienzo(30 + (k % 6) * 150, 30 + Math.floor(k / 6) * 130, w, h)

/** 'Mesa 7': el siguiente número libre del mapa (no depende del largo del array, que
 *  se queda corto si se borró una mesa). Es DATO, no texto: no se traduce. */
export const proximaMesaNombre = mesas => {
  const nums = mesas.map(m => Number(String(m.nombre).match(/(\d+)\s*$/)?.[1] || 0))
  return 'Mesa ' + (Math.max(0, ...nums) + 1)
}

/** Salones → cantidad de mesas asignadas (la guarda del borrado y el chip de la tab). */
export const mesasPorZona = (mesas, id) => mesas.filter(m => m.zona === id).length

/** Total de comensales que caben en una cuenta: suma de las mesas unidas. */
export const capacidadCuenta = (c, mesas) => {
  if (!c) return 0
  const ids = c.tipo === 'mesa' && c.mesaIds.length > 1 ? c.mesaIds : [c.mesaIds[0]]
  return ids.reduce((t, id) => t + (mesas.find(m => m.id === id)?.cap ?? 0), 0)
}

export default function SalonPage({ rol, sesion }) {
  const { s, d, modo } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const admin = puede(rol, 'editar_mapa') // único permiso de salón en permisos.js (solo admin)

  const [zona, setZona] = useState(() => s.zonas[0]?.id ?? TODAS)
  const [edit, setEdit] = useState(false)
  // Vista de mesas: mapa o lista (se recuerda en este equipo; en celular arranca en lista).
  const [vista, setVista] = useState(() => {
    try { const v = localStorage.getItem('pos-salon-vista'); if (v === 'mapa' || v === 'lista') return v } catch { /* ignore */ }
    return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
  })
  const cambiarVista = v => { setVista(v); try { localStorage.setItem('pos-salon-vista', v) } catch { /* ignore */ } }
  const [sel, setSel] = useState(null)
  // Ediciones de salón inline (nunca window.prompt / window.confirm):
  const [nueva, setNueva] = useState(null)       // texto del alta de salón
  const [ren, setRen] = useState(null)           // { id, nombre } mientras se renombra
  const [conf, setConf] = useState(null)         // id del salón con la confirmación de borrado abierta
  // Toast interno (mismo patrón inline que el aviso de PedidoPanel; alert/confirm
  // nativos congelan el navegador de pruebas).
  const [aviso, setAviso] = useState('')
  const avisoTimer = useRef(null)
  // Arrastre: el estado local pinta la mesa en movimiento y SOLO se guarda (1 dispatch)
  // al soltar. Si despacháramos en cada pointermove, en modo Supabase iría un UPDATE por
  // frame a la cola de RPCs.
  const [mueve, setMueve] = useState(null)       // { id, x, y }
  const of = useRef(null)                        // offset del puntero dentro de la mesa
  const lienzo = useRef(null)
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MAX_PX_MOVIL)
  useViewport(setMovil)

  const zonas = useMemo(() => ordenarZonas(s.zonas), [s.zonas])

  // Si el salón del filtro ya no existe (lo borró otro dispositivo, o un refresco de Supabase
  // trajo otra lista) caemos al primero; sin salones, al filtro "Todas".
  const activo = zona === TODAS || zonas.some(z => z.id === zona) ? zona : (zonas[0]?.id ?? TODAS)
  const destinoAlta = activo === TODAS ? (zonas[0]?.id ?? null) : activo
  const mesasZona = s.mesas.filter(m => activo === TODAS || m.zona === activo)
  const mesaSel = s.mesas.find(m => m.id === sel)
  const cuentaSel = sel ? cuentaActiva(s, sel) : null
  const comDe = c => (c ? c.comensales ?? 0 : 0)
  const heredadas = s.caja?.turno?.heredadas || [] // cuentas abiertas que venían del turno anterior
  const avisar = m => {
    setAviso(m)
    clearTimeout(avisoTimer.current) // reprograma: si llegan dos avisos, el segundo manda
    avisoTimer.current = setTimeout(() => setAviso(''), 4500)
  }
  const zonaNombre = id => zonas.find(z => z.id === id)?.nombre ?? t('salon.sinZona')
  const nMesasZona = id => mesasPorZona(s.mesas, id)

  const aCoord = e => {
    const r = lienzo.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const posMesa = (e, m) => {
    const p = aCoord(e)
    return { id: m.id, ...dentroDelLienzo(p.x - of.current.dx, p.y - of.current.dy, m.w, m.h) }
  }
  const down = (e, m) => {
    if (!(edit && admin)) return // en operación la mesa se abre con el clic (onClick), no al apoyar el dedo
    setSel(m.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = aCoord(e)
    of.current = { dx: p.x - m.x, dy: p.y - m.y }
    setMueve({ id: m.id, x: m.x, y: m.y })
  }
  const move = e => {
    if (!mueve || !of.current) return
    const m = s.mesas.find(x => x.id === mueve.id)
    if (m) setMueve(posMesa(e, m))
  }
  const up = () => {
    if (mueve) {
      const m = s.mesas.find(x => x.id === mueve.id)
      if (m && (m.x !== mueve.x || m.y !== mueve.y)) d({ t: 'mesa~', id: m.id, cambios: { x: mueve.x, y: mueve.y } })
    }
    suelta()
  }
  const suelta = () => { of.current = null; setMueve(null) } // pointercancel: descarta, no guarda

  // ─────────── salones (zonas): alta / renombrar / reordenar / borrar ───────────
  const crearZona = () => {
    const nombre = (nueva || '').trim().slice(0, LARGO_ZONA)
    if (!nombre) return
    const id = nuevoId()
    // El reducer demo no genera id ni orden: los ponemos aquí (en Supabase 'zona+' inserta
    // exactamente este id, así que el id local coincide con el de la base).
    d({ t: 'zona+', zona: { id, nombre, orden: ordenNuevaZona(zonas) } })
    setNueva(null); setZona(id)
  }
  const guardarRen = () => {
    const nombre = (ren?.nombre || '').trim().slice(0, LARGO_ZONA)
    if (ren && nombre) d({ t: 'zona~', id: ren.id, cambios: { nombre } })
    setRen(null)
  }
  // Reordenar = intercambiar `orden` con el vecino (ver intercambioOrden).
  const moverZona = (i, dir) => {
    const cambios = intercambioOrden(zonas, i, dir)
    if (!cambios) return
    cambios.forEach(c => d({ t: 'zona~', id: c.id, cambios: { orden: c.orden } }))
  }
  const borrarZona = z => {
    if (nMesasZona(z.id) > 0) return // la guarda real está en la UI: sin mesas, se puede
    d({ t: 'zona-', id: z.id })
    setConf(null)
    if (activo === z.id) setZona(zonas.length > 1 ? (zonas.find(x => x.id !== z.id)?.id ?? TODAS) : TODAS)
  }

  // ─────────── mesas ───────────
  const crear = () => {
    if (!destinoAlta) return
    // El nombre va a la base como DATO (igual que 'Mesa 1…5' del seed), no se traduce:
    // si se tradujera, una mesa nueva creada en inglés quedaría 'Table 6' mezclada con
    // 'Mesa 7' en la misma zona. El usuario la renombra si quiere otro nombre.
    const id = nuevoId(), k = nMesasZona(destinoAlta)
    d({ t: 'mesa+', mesa: { id, zona: destinoAlta, nombre: proximaMesaNombre(s.mesas), ...cascadar(k), w: 110, h: 110, forma: 'cuadrada', cap: 4 } })
    setSel(id)
  }
  // Redimensionar también reencuadra x/y: con w/h más grandes la mesa podría salirse del lienzo.
  // Cuadrada y redonda mantienen la proporción 1:1 (cambian ancho y alto juntos); la rectangular
  // permite ancho y alto por separado.
  const tam = (dim, k) => {
    const ajusta = v => Math.max(TAM_MIN, Math.min(dim === 'w' ? W : H, v + k))
    let w = mesaSel.w, h = mesaSel.h
    if (mesaSel.forma === 'rect') { if (dim === 'w') w = ajusta(w); else h = ajusta(h) }
    else { const lado = Math.max(TAM_MIN, Math.min(H, Math.min(w, h) + k)); w = lado; h = lado }
    d({ t: 'mesa~', id: sel, cambios: { w, h, ...dentroDelLienzo(mesaSel.x, mesaSel.y, w, h) } })
  }
  // Cambiar de forma ajusta las medidas: rectangular = más ancha que alta (1.6:1), las otras 1:1.
  const ponerForma = f => {
    if (f === mesaSel.forma) return
    let { w, h } = mesaSel
    if (f === 'rect') { h = Math.min(w, h); w = Math.min(W, Math.round(h * 1.6)) }
    else { const lado = Math.min(w, h); w = lado; h = lado }
    d({ t: 'mesa~', id: sel, cambios: { forma: f, w, h, ...dentroDelLienzo(mesaSel.x, mesaSel.y, w, h) } })
  }
  const cap = k => d({ t: 'mesa~', id: sel, cambios: { cap: limitarCapacidad((mesaSel.cap || 0) + k) } })
  const cambiarZona = id => {
    d({ t: 'mesa~', id: sel, cambios: { zona: id || null } })
    if (id) setZona(id) // seguimos la mesa en el mapa: si no, desaparece del filtro actual
  }
  const renombrarMesa = v => d({ t: 'mesa~', id: sel, cambios: { nombre: v.slice(0, LARGO_MESA) } })
  const borrar = () => {
    if (cuentaSel) return avisar(cuentaSel.mesaIds.length > 1 ? t('salon.alertUnida') : t('salon.alertAbierta'))
    d({ t: 'mesa-', id: sel }); setSel(null)
  }

  return (
    <div className="salon">
      {/* .editando (solo con edit && admin) activa en SalonPage.css el orden móvil
          mapa-arriba / formulario-abajo y el descuento extra de alto en PC. */}
      <section className={'mapa-col' + (edit ? ' editando' : '')}>
        {/* ── franja de salones: filtro + administración inline ── */}
        <div className="zona-strip">
          <div className="zonas-scroll" role="group" aria-label={t('salon.salones')}>
            <button className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS}
              title={t('salon.todasTitle')} onClick={() => { setZona(TODAS); setSel(null) }}>
              <span aria-hidden="true">▦</span> {t('salon.todas')}
            </button>
            {zonas.map((z, i) => (ren && ren.id === z.id ? (
              <span className="zren" key={z.id}>
                <input autoFocus className="zinput" value={ren.nombre} maxLength={LARGO_ZONA}
                  aria-label={t('salon.renombrar')}
                  onChange={e => setRen({ ...ren, nombre: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') guardarRen(); if (e.key === 'Escape') setRen(null) }} />
                <button className="ico ok" title={t('comun.guardar')} aria-label={t('comun.guardar')} onClick={guardarRen}>✓</button>
                <button className="ico" title={t('comun.cancelar')} aria-label={t('comun.cancelar')} onClick={() => setRen(null)}>✕</button>
              </span>
            ) : (
              <span className={'ztab' + (activo === z.id ? ' on' : '')} key={z.id}>
                <button className={activo === z.id ? 'tab on' : 'tab'} aria-pressed={activo === z.id}
                  onClick={() => { setZona(z.id); setSel(null) }}>{z.nombre}
                  {edit && admin && <em className="n">{nMesasZona(z.id)}</em>}
                </button>
                {edit && admin && (
                  <span className="ztools">
                    <button className="ico" title={t('salon.subirZona')} aria-label={t('salon.subirZona')}
                      disabled={i === 0} onClick={() => moverZona(i, -1)}>▲</button>
                    <button className="ico" title={t('salon.bajarZona')} aria-label={t('salon.bajarZona')}
                      disabled={i === zonas.length - 1} onClick={() => moverZona(i, 1)}>▼</button>
                    <button className="ico" title={t('salon.renombrar')} aria-label={t('salon.renombrar')}
                      onClick={() => { setConf(null); setRen({ id: z.id, nombre: z.nombre }) }}>✎</button>
                    {conf === z.id ? (
                      <span className="zconf">
                        <span className="zconf-txt">{t('salon.confirmarEliminarZona')}</span>
                        <button className="ico danger" title={t('comun.confirmar')} aria-label={t('comun.confirmar')}
                          onClick={() => borrarZona(z)}>✓</button>
                        <button className="ico" title={t('comun.cancelar')} aria-label={t('comun.cancelar')}
                          onClick={() => setConf(null)}>✕</button>
                      </span>
                    ) : (
                      <button className="ico" title={nMesasZona(z.id) ? t('salon.zonaConMesas', { n: nMesasZona(z.id) }) : t('salon.eliminarZona')}
                        aria-label={t('salon.eliminarZona')} disabled={nMesasZona(z.id) > 0} onClick={() => setConf(z.id)}>🗑</button>
                    )}
                  </span>
                )}
              </span>
            )))}
            {edit && admin && (
              <button className="tab mas" title={t('salon.nuevaZona')} onClick={() => { setRen(null); setNueva(nueva === null ? '' : null) }}>
                ＋ {t('salon.nuevaZona')}
              </button>
            )}
          </div>
          <div className="vista-sel" role="group" aria-label={t('salon.vista')}>
            <button type="button" className={'tab' + (vista === 'mapa' || edit ? ' on' : '')} aria-pressed={vista === 'mapa' || edit} onClick={() => cambiarVista('mapa')}>🗺 <span className="txt">{t('salon.vistaMapa')}</span></button>
            <button type="button" className={'tab' + (vista === 'lista' && !edit ? ' on' : '')} aria-pressed={vista === 'lista' && !edit} disabled={edit} onClick={() => cambiarVista('lista')}>☰ <span className="txt">{t('salon.vistaLista')}</span></button>
          </div>
          {admin && (
            <button className={edit ? 'primary' : 'ghost'} aria-label={edit ? t('salon.terminarEdicion') : t('salon.editarMapa')}
              title={edit ? t('salon.terminarEdicion') : t('salon.editarMapa')} onClick={() => { setEdit(!edit); setSel(null); setNueva(null); setRen(null); setConf(null) }}>
              <span aria-hidden="true">{edit ? '✓' : '✎'}</span><span className="txt">{edit ? t('salon.terminarEdicion') : t('salon.editarMapa')}</span>
            </button>
          )}
        </div>

        {aviso && (
          <div className="salon-aviso" role="status">
            <span>{aviso}</span>
            <button className="ico" title={t('comun.cancelar')} aria-label={t('comun.cancelar')} onClick={() => setAviso('')}>✕</button>
          </div>
        )}

        {edit && admin && nueva !== null && (
          <div className="barra zona-alta">
            <input autoFocus className="zinput" placeholder={t('salon.nuevaZonaPlace')} value={nueva} maxLength={LARGO_ZONA}
              aria-label={t('salon.nuevaZona')}
              onChange={e => setNueva(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') crearZona(); if (e.key === 'Escape') setNueva(null) }} />
            <button className="primary" onClick={crearZona} disabled={!nueva.trim()}>{t('comun.guardar')}</button>
            <button className="ghost" onClick={() => setNueva(null)}>{t('comun.cancelar')}</button>
          </div>
        )}

        {edit && admin && (
          <div className="barra">
            <button className="ghost" onClick={crear} disabled={!destinoAlta} aria-label={t('salon.masMesa')}
              title={destinoAlta ? t('salon.masMesa') : t('salon.sinZonas')}>
              <span aria-hidden="true">＋</span><span className="txt">{t('salon.masMesa')}</span>
            </button>
            <span className="pista">{movil ? t('salon.arrastraMesaMovil') : t('salon.arrastraMesa')}</span>
          </div>
        )}

        {edit && admin && mesaSel && (
          <div className="mesa-edit" role="group" aria-label={t('salon.mesaSel')}>
            <div className="me-cab"><b>{t('salon.mesaSel')}</b><span className="me-nom">{mesaSel.nombre}</span></div>
            <div className="me-grid">
              <label className="me-campo me-ancho2"><span>{t('pedido.mesaCorta')}</span>
                <input value={mesaSel.nombre} maxLength={LARGO_MESA} onChange={e => renombrarMesa(e.target.value)} />
              </label>
              <label className="me-campo"><span>{t('salon.zona')}</span>
                <select value={mesaSel.zona ?? ''} onChange={e => cambiarZona(e.target.value)}>
                  <option value="">{t('salon.sinZona')}</option>
                  {zonas.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
              </label>
              <div className="me-campo me-ancho2"><span>{t('salon.forma')}</span>
                {/* Solo la figura: el nombre de la forma vive en title/aria-label (patrón
                    tOr para no depender de que i18n tenga ya la clave). */}
                <div className="me-seg" role="radiogroup" aria-label={t('salon.forma')}>
                  {[['cuadrada', '▢', tOr('salon.formaCuadrada', 'Cuadrada')], ['redonda', '◯', tOr('salon.formaRedonda', 'Redonda')], ['rect', '▭', tOr('salon.formaRect', 'Rectangular')]].map(([k, ico, txt]) => (
                    <button key={k} type="button" role="radio" aria-checked={mesaSel.forma === k}
                      title={txt} aria-label={txt}
                      className={'me-opc' + (mesaSel.forma === k ? ' on' : '')} onClick={() => ponerForma(k)}>
                      <span aria-hidden="true">{ico}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="me-campo"><span>{mesaSel.forma === 'rect' ? t('salon.ancho') : t('salon.tamano')}</span>
                <div className="me-step">
                  <button type="button" title={t('salon.tamanoMenos')} aria-label={t('salon.tamanoMenos')} onClick={() => tam('w', -10)}>−</button>
                  <b>{mesaSel.forma === 'rect' ? mesaSel.w : Math.min(mesaSel.w, mesaSel.h)}</b>
                  <button type="button" title={t('salon.tamanoMas')} aria-label={t('salon.tamanoMas')} onClick={() => tam('w', 10)}>＋</button>
                </div>
              </div>
              {mesaSel.forma === 'rect' && (
                <div className="me-campo"><span>{t('salon.alto')}</span>
                  <div className="me-step">
                    <button type="button" title={t('salon.tamanoMenos')} aria-label={t('salon.tamanoMenos')} onClick={() => tam('h', -10)}>−</button>
                    <b>{mesaSel.h}</b>
                    <button type="button" title={t('salon.tamanoMas')} aria-label={t('salon.tamanoMas')} onClick={() => tam('h', 10)}>＋</button>
                  </div>
                </div>
              )}
              <div className="me-campo"><span>{t('salon.capacidad')}</span>
                <div className="me-step">
                  <button type="button" title={t('salon.capacidadMenos')} aria-label={t('salon.capacidadMenos')} onClick={() => cap(-1)}>−</button>
                  <b>{mesaSel.cap}</b>
                  <button type="button" title={t('salon.capacidadMas')} aria-label={t('salon.capacidadMas')} onClick={() => cap(1)}>＋</button>
                </div>
              </div>
              <div className="me-campo"><span aria-hidden="true">&nbsp;</span>
                <button type="button" className="danger solid" onClick={borrar} title={t('comun.eliminar')}>🗑 {t('comun.eliminar')}</button>
              </div>
            </div>
          </div>
        )}

        {!admin && <p className="pista">{t('salon.soloLectura')}</p>}
        {!edit && !s.caja?.turno && !s._supCargando && (
          <div className="salon-aviso sin-turno" role="status">{t('salon.sinTurno')}</div>
        )}

        {vista === 'lista' && !edit && (
          <div className="mesas-lista">
            {mesasZona.length === 0 && <p className="lienzo-vacio" style={{ position: 'static' }}>{t('salon.sinMesasZona')}</p>}
            {mesasZona.map(m => {
              const c = cuentaActiva(s, m.id), est = estadoMesa(c)
              const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
              return (
                <button type="button" key={m.id} className={`mesa-item ${est}`} onClick={() => setSel(m.id)}>
                  <b className="nombre">{m.nombre}{unida ? ` 🔗×${c.mesaIds.length}` : ''}</b>
                  <span className="mi-est">{t('salon.' + est)}</span>
                  {c && <small className="importe">{money(totalFinal(c))}</small>}
                  {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(m.zona)}</span>}
                </button>
              )
            })}
          </div>
        )}

        <div ref={lienzo} hidden={vista === 'lista' && !edit} className={'lienzo' + (edit ? ' edit' : '')} style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={e => { if (e.target === e.currentTarget) setSel(null) }} // tocar el fondo cierra la hoja móvil
          onPointerMove={move} onPointerUp={up} onPointerCancel={suelta}>
          {mesasZona.length === 0 && (
            <p className="lienzo-vacio">{edit && admin ? t('salon.sinMesas') : t('salon.sinMesasZona')}</p>
          )}
          {mesasZona.map(m => {
            const c = cuentaActiva(s, m.id), est = estadoMesa(c)
            const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
            // Capacidad de la cuenta: suma de las mesas unidas (los comensales se comparan
            // contra esa suma, no contra la mesa suelta).
            const capT = capacidadCuenta(c, s.mesas) || (m.cap || 0)
            const com = c ? comDe(c) : null
            const p = mueve && mueve.id === m.id ? mueve : m
            return (
              <div key={m.id} className={`mesa ${m.forma} ${est}${sel === m.id ? ' sel' : ''}${mueve?.id === m.id ? ' arrastrando' : ''}`}
                onPointerDown={e => down(e, m)} onClick={() => { if (!(edit && admin)) setSel(m.id) }} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: `${(p.w / W) * 100}%`, height: `${(p.h / H) * 100}%` }}>
                <b className="nombre">{m.nombre}</b>
                <span className={'pax' + (com !== null && com > capT ? ' alerta' : '')}
                  title={c ? (com > capT ? t('salon.comensalesDeMas', { comensales: com, cap: capT }) : t('salon.comensalesTitle', { comensales: com, cap: capT })) : t('salon.capacidadTitle', { cap: m.cap })}>
                  👥 {c ? `${com}/${capT}` : m.cap}
                </span>
                {c && <small className="importe">{money(totalFinal(c))}</small>}
                {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(m.zona)}</span>}
                {c && heredadas.includes(c.id) && <span className="badge-heredada" title={t('salon.heredadaTitle')}>↩</span>}
                {unida && (
                  <span className="badge-unida" title={t('salon.unidaTitle', { n: c.mesaIds.length, total: money(totalCuenta(c)) })}>
                    🔗 ×{c.mesaIds.length}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <div className="leyenda">
          {[['libre', t('salon.libre')], ['ocupada', t('salon.ocupada')], ['enviada', t('salon.enviada')], ['porcobrar', t('salon.porcobrar')]].map(([k, l]) => (
            <span key={k}><i className={'pt ' + k} />{l}</span>
          ))}
          <span><i className="pt pax" />{t('salon.leyendaPax')}</span>
          <span><i className="pt unida" />{t('salon.leyendaUnidas')}</span>
        </div>
      </section>
      <PedidoPanel rol={rol} sesion={sesion} mesa={mesaSel} onClose={() => setSel(null)} bloqueado={edit} />
    </div>
  )
}

// Escucha el ancho de ventana para el modo celular (los estilos viven en SalonPage.css; esto
// solo decide qué textos/hints se muestran y el aviso de arrastre).
function useViewport(setMovil) {
  useEffect(() => {
    const r = () => setMovil(window.innerWidth <= MAX_PX_MOVIL)
    window.addEventListener('resize', r)
    window.addEventListener('orientationchange', r)
    return () => {
      window.removeEventListener('resize', r)
      window.removeEventListener('orientationchange', r)
    }
  }, [setMovil])
}
