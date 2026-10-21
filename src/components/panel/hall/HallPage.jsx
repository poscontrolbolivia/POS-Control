import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, cuentaActiva, cuentasDeMesa, totalCuenta, totalFinal, pagadoCuenta, saldoCuenta, nuevoId } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { round2 } from '../../../services/format.js'
import { useMoneda } from '../../../services/money.js'
import { useIdioma } from '../../../i18n/index.jsx'
import OrderPanel from '../order/OrderPanel.jsx'
import './HallPage.css'

const W = 1000, H = 600
const TODAS = 'todas'
const LLEVAR = 'llevar'

const LARGO_ZONA = 80, LARGO_MESA = 60, CAP_MIN = 1, CAP_MAX = 50
const COM_MIN = 1, COM_MAX = 99
const TAM_MIN = 60
const PASO_TAM = 25
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.5, ZOOM_PASO = 0.25
const MAX_PX_MOVIL = 768

const estadoMesa = c => (!c ? 'libre' : c.estado === 'precuenta' ? 'porcobrar' : c.items.some(i => i.estado === 'enviado') ? 'enviada' : 'ocupada')

const estadoVarias = cs => {
  if (!cs.length) return 'libre'
  const e = cs.map(c => estadoMesa(c))
  return e.every(x => x === 'porcobrar') ? 'porcobrar' : e.includes('enviada') ? 'enviada' : 'ocupada'
}

const ordenarZonas = zonas => zonas
  .map((z, i) => ({ ...z, _i: i }))
  .sort((a, b) => ((a.orden ?? a._i + 1) - (b.orden ?? b._i + 1)) || (a._i - b._i))

const ordenNuevaZona = zonas => zonas.reduce((max, z, i) => Math.max(max, z.orden ?? i + 1), 0) + 1

const intercambioOrden = (zonas, i, dir) => {
  const a = zonas[i], b = zonas[i + dir]
  if (!a || !b) return null
  const oa = a.orden ?? i + 1
  let ob = b.orden ?? (i + dir) + 1
  if (oa === ob) ob = oa + dir
  return [{ id: a.id, orden: ob }, { id: b.id, orden: oa }]
}

const dentroDelLienzo = (x, y, w, h) => ({
  x: Math.max(0, Math.min(W - w, Math.round(x))),
  y: Math.max(0, Math.min(H - h, Math.round(y))),
})

const limitarCapacidad = cap => Math.max(CAP_MIN, Math.min(CAP_MAX, cap))

const proximaMesaNombre = mesas => {
  const nums = mesas.map(m => Number(String(m.nombre).match(/(\d+)\s*$/)?.[1] || 0))
  return 'Mesa ' + (Math.max(0, ...nums) + 1)
}

// El número manda en el mapa: se saca del nombre (las cifras del final); si no hay, se muestra el nombre entero.
const numeroDeMesa = m => String(m.nombre).match(/(\d+)\s*$/)?.[1] ?? ''

const mesasPorZona = (mesas, id) => mesas.filter(m => m.zona === id).length

const capacidadCuenta = (c, mesas) => {
  if (!c) return 0
  const ids = c.tipo === 'mesa' && c.mesaIds.length > 1 ? c.mesaIds : [c.mesaIds[0]]
  return ids.reduce((t, id) => t + (mesas.find(m => m.id === id)?.cap ?? 0), 0)
}

export default function HallPage({ rol, sesion, foco }) {
  const { s, d, modo } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const admin = puede(rol, 'editar_mapa')

  const [zona, setZona] = useState(() => s.zonas[0]?.id ?? TODAS)
  const [edit, setEdit] = useState(false)

  const [vista, setVista] = useState(() => {
    try { const v = localStorage.getItem('pos-salon-vista'); if (v === 'mapa' || v === 'lista') return v } catch {  }
    return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
  })
  const cambiarVista = v => { setVista(v); try { localStorage.setItem('pos-salon-vista', v) } catch {  } }
  const [sel, setSel] = useState(null)

  const [nueva, setNueva] = useState(null)
  const [ren, setRen] = useState(null)
  const [conf, setConf] = useState(null)

  const [cli, setCli] = useState(null)
  const [aMesa, setAMesa] = useState(null)
  const [llevarSelId, setLlevarSelId] = useState(null)

  const [aviso, setAviso] = useState('')
  const avisoTimer = useRef(null)

  // Zoom del lienzo: escale de TODO el mapa (mesas, textos y rejilla) sin cambiar las coordenadas guardadas.
  const [zoom, setZoom] = useState(1)
  const aplicarZoom = z => setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100)))
  const zoomAcercar = () => aplicarZoom(zoom + ZOOM_PASO)
  const zoomAlejar = () => aplicarZoom(zoom - ZOOM_PASO)

  // Una alerta o la Caja pueden traer el foco de vuelta: se abre el salón completo y se selecciona su cuenta.
  // `desde: 'caja'` abre además el modo cobro: solo lo necesario para cobrar, sin la carta del mesero.
  const [cobro, setCobro] = useState(false)
  useEffect(() => {
    if (!foco?.seq) return
    setCobro(foco.desde === 'caja')
    setEdit(false)
    if (foco.mesaId) { setZona(TODAS); setSel(foco.mesaId); setLlevarSelId(null) }
    else if (foco.cuentaId) { setZona(LLEVAR); setSel(null); setLlevarSelId(foco.cuentaId) }
  }, [foco?.seq])

  // Tocar una mesa o un pedido uno mismo vuelve a la vista normal: el modo cobro solo viene de Caja.
  const abrirMesa = id => { setCobro(false); setSel(id) }
  const abrirLlevar = id => { setCobro(false); setLlevarSelId(id) }

  const [mueve, setMueve] = useState(null)
  const of = useRef(null)
  const lienzo = useRef(null)
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MAX_PX_MOVIL)
  useViewport(setMovil)

  const zonas = useMemo(() => ordenarZonas(s.zonas), [s.zonas])

  const activo = zona === TODAS || zona === LLEVAR || zonas.some(z => z.id === zona) ? zona : (zonas[0]?.id ?? TODAS)
  const destinoAlta = activo === TODAS ? (zonas[0]?.id ?? null) : activo
  const mesasZona = s.mesas.filter(m => activo === TODAS || m.zona === activo)
  const mesaSel = s.mesas.find(m => m.id === sel)
  const enLlevar = activo === LLEVAR
  const llevarCuentas = s.cuentas.filter(c => c.canal === 'llevar' && c.estado !== 'cerrada').sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const llevarSel = llevarSelId ? llevarCuentas.find(c => c.id === llevarSelId) : null
  const mesasLibres = s.mesas.filter(m => cuentasDeMesa(s, m.id).length === 0)
  useEffect(() => {
    if (!enLlevar || modo !== 'supabase') return undefined
    const id = setInterval(() => { if (!document.hidden) window.dispatchEvent(new Event('pos-reanudar')) }, 20000)
    return () => clearInterval(id)
  }, [enLlevar, modo])
  const cuentaSel = sel ? cuentaActiva(s, sel) : null
  const comDe = c => (c ? c.comensales ?? 0 : 0)
  const heredadas = s.caja?.turno?.heredadas || []
  const avisar = m => {
    setAviso(m)
    clearTimeout(avisoTimer.current)
    avisoTimer.current = setTimeout(() => setAviso(''), 4500)
  }
  // ✎ Editar (para teléfono): cambia nombre/teléfono de un pedido «para llevar» ya creado.
  // La creación ya no pasa por aquí: el botón «Nuevo pedido» abre el pedido de una.
  const guardarCli = () => {
    if (!cli?.id) return
    const nombre = (cli.nombre || '').trim().slice(0, 80)
    const tel = (cli.tel || '').trim().slice(0, 40)
    d({ t: 'llevar~', cuentaId: cli.id, nombre, tel })
    setCli(null)
  }
  const pasarAMesa = () => {
    const m = s.mesas.find(x => x.id === aMesa?.mesaId)
    const c = llevarCuentas.find(x => x.id === aMesa?.cuentaId)
    if (!m || !c) return
    d({ t: 'llevar-mesa', cuentaId: c.id, mesaId: m.id, comensales: Math.max(1, Number(aMesa.com) || 1) })
    avisar(t('salon.llevarMovida', { nombre: c.clienteNombre, mesa: m.nombre }))
    setAMesa(null); setLlevarSelId(null); setZona(m.zona ?? TODAS); abrirMesa(m.id)
  }
  const zonaNombre = id => zonas.find(z => z.id === id)?.nombre ?? t('salon.sinZona')
  const nMesasZona = id => mesasPorZona(s.mesas, id)

  // Un toque: crea el pedido para llevar vacío, lo deja abierto y trae el panel de la orden enfrente.
  // El nombre del cliente se escribe después, dentro del panel (OrderPanel).
  const nuevoLlevar = () => {
    const id = nuevoId()
    d({ t: 'abrir-llevar', id, nombre: '', tel: '', usuario: sesion?.usuario || sesion?.nombre || rol })
    setZona(LLEVAR)
    abrirLlevar(id)
  }

  const aCoord = e => {
    const r = lienzo.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const posMesa = (e, m) => {
    const p = aCoord(e)
    return { id: m.id, ...dentroDelLienzo(p.x - of.current.dx, p.y - of.current.dy, m.w, m.h) }
  }
  const down = (e, m) => {
    if (!(edit && admin)) return
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
  const suelta = () => { of.current = null; setMueve(null) }

  const crearZona = () => {
    const nombre = (nueva || '').trim().slice(0, LARGO_ZONA)
    if (!nombre) return
    const id = nuevoId()

    d({ t: 'zona+', zona: { id, nombre, orden: ordenNuevaZona(zonas) } })
    setNueva(null); setZona(id)
  }
  const guardarRen = () => {
    const nombre = (ren?.nombre || '').trim().slice(0, LARGO_ZONA)
    if (ren && nombre) d({ t: 'zona~', id: ren.id, cambios: { nombre } })
    setRen(null)
  }

  const moverZona = (i, dir) => {
    const cambios = intercambioOrden(zonas, i, dir)
    if (!cambios) return
    cambios.forEach(c => d({ t: 'zona~', id: c.id, cambios: { orden: c.orden } }))
  }
  const borrarZona = z => {
    if (nMesasZona(z.id) > 0) return
    d({ t: 'zona-', id: z.id })
    setConf(null)
    if (activo === z.id) setZona(zonas.length > 1 ? (zonas.find(x => x.id !== z.id)?.id ?? TODAS) : TODAS)
  }

  const crear = () => {
    if (!destinoAlta) return

    const id = nuevoId(), k = nMesasZona(destinoAlta)
    d({ t: 'mesa+', mesa: { id, zona: destinoAlta, nombre: proximaMesaNombre(s.mesas), ...cascadar(k), w: 110, h: 110, forma: 'cuadrada', cap: 4 } })
    setSel(id)
  }

  const tam = (dim, k) => {
    const ajusta = v => Math.max(TAM_MIN, Math.min(dim === 'w' ? W : H, v + k))
    let w = mesaSel.w, h = mesaSel.h
    if (mesaSel.forma === 'rect') { if (dim === 'w') w = ajusta(w); else h = ajusta(h) }
    else { const lado = Math.max(TAM_MIN, Math.min(H, Math.min(w, h) + k)); w = lado; h = lado }
    d({ t: 'mesa~', id: sel, cambios: { w, h, ...dentroDelLienzo(mesaSel.x, mesaSel.y, w, h) } })
  }

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
    if (id) setZona(id)
  }
  const renombrarMesa = v => d({ t: 'mesa~', id: sel, cambios: { nombre: v.slice(0, LARGO_MESA) } })
  const borrar = () => {
    if (cuentaSel) return avisar(cuentaSel.mesaIds.length > 1 ? t('salon.alertUnida') : t('salon.alertAbierta'))
    d({ t: 'mesa-', id: sel }); setSel(null)
  }

  return (
    <div className="salon">
      <section className={'mapa-col' + (edit ? ' editando' : '')}>
        <div className="zona-strip">
          <div className="zonas-scroll" role="group" aria-label={t('salon.salones')}>
            <button className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS}
              title={t('salon.todasTitle')} onClick={() => { setZona(TODAS); setSel(null) }}>
              <span aria-hidden="true">▦</span> {t('salon.todas')}
            </button>
            <button className={enLlevar ? 'tab on' : 'tab'} aria-pressed={enLlevar} onClick={() => { setZona(LLEVAR); setSel(null); setEdit(false); setNueva(null); setRen(null); setConf(null) }}>
              <span aria-hidden="true">🥡</span> {t('salon.llevar')}{llevarCuentas.length > 0 && <span className="llevar-n">{llevarCuentas.length}</span>}
            </button>
            {zonas.map((z, i) => (ren && ren.id === z.id ? (
              <span className="zren" key={z.id}>
                <input name="renombrar" autoFocus className="zinput" value={ren.nombre} maxLength={LARGO_ZONA}
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
            <button className={edit ? 'primary' : 'ghost'} disabled={enLlevar} aria-label={edit ? t('salon.terminarEdicion') : t('salon.editarMapa')}
              title={edit ? t('salon.terminarEdicion') : t('salon.editarMapa')} onClick={() => { if (edit) setZoom(1); setEdit(!edit); setSel(null); setNueva(null); setRen(null); setConf(null) }}>
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
            <input name="nueva-zona" autoFocus className="zinput" placeholder={t('salon.nuevaZonaPlace')} value={nueva} maxLength={LARGO_ZONA}
              aria-label={t('salon.nuevaZona')}
              onChange={e => setNueva(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') crearZona(); if (e.key === 'Escape') setNueva(null) }} />
            <button className="primary" onClick={crearZona} disabled={!nueva.trim()}>{t('comun.guardar')}</button>
            <button className="danger" onClick={() => setNueva(null)}>{t('comun.cancelar')}</button>
          </div>
        )}

        {edit && admin && (
          <div className="barra">
            <button className="success" onClick={crear} disabled={!destinoAlta} aria-label={t('salon.masMesa')}
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
                <input name="nombre" value={mesaSel.nombre} maxLength={LARGO_MESA} onChange={e => renombrarMesa(e.target.value)} />
              </label>
              <label className="me-campo"><span>{t('salon.zona')}</span>
                <select name="zona" value={mesaSel.zona ?? ''} onChange={e => cambiarZona(e.target.value)}>
                  <option value="">{t('salon.sinZona')}</option>
                  {zonas.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                </select>
              </label>
              <div className="me-campo me-ancho2"><span>{t('salon.forma')}</span>
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
                  <button type="button" title={t('salon.tamanoMenos')} aria-label={t('salon.tamanoMenos')} onClick={() => tam('w', -PASO_TAM)}>−</button>
                  <b>{mesaSel.forma === 'rect' ? mesaSel.w : Math.min(mesaSel.w, mesaSel.h)}</b>
                  <button type="button" title={t('salon.tamanoMas')} aria-label={t('salon.tamanoMas')} onClick={() => tam('w', PASO_TAM)}>＋</button>
                </div>
              </div>
              {mesaSel.forma === 'rect' && (
                <div className="me-campo"><span>{t('salon.alto')}</span>
                  <div className="me-step">
                    <button type="button" title={t('salon.tamanoMenos')} aria-label={t('salon.tamanoMenos')} onClick={() => tam('h', -PASO_TAM)}>−</button>
                    <b>{mesaSel.h}</b>
                    <button type="button" title={t('salon.tamanoMas')} aria-label={t('salon.tamanoMas')} onClick={() => tam('h', PASO_TAM)}>＋</button>
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

        {vista === 'lista' && !edit && !enLlevar && (
          <div className="mesas-lista">
            {mesasZona.length === 0 && <p className="lienzo-vacio" style={{ position: 'static' }}>{t('salon.sinMesasZona')}</p>}
            {mesasZona.map(m => {
              const cs = cuentasDeMesa(s, m.id), c = cs[0], est = estadoVarias(cs), total = cs.reduce((a, x) => a + totalFinal(x), 0)
              const abono = round2(cs.reduce((a, x) => a + pagadoCuenta(x), 0))
              const resto = round2(cs.reduce((a, x) => a + saldoCuenta(x), 0))
              const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
              return (
                <button type="button" key={m.id} className={`mesa-item ${est}`} onClick={() => abrirMesa(m.id)}>
                  <b className="nombre">{m.nombre}{unida ? ` 🔗×${c.mesaIds.length}` : cs.length > 1 ? ` ✂×${cs.length}` : ''}</b>
                  <span className="mi-est">{t('salon.' + est)}</span>
                  {c && <small className="importe">{money(resto)}{abono > 0.009 && <em className="abonado" title={t('salon.totalAbonado', { total: money(total) })}>✓ {money(abono)}</em>}</small>}
                  {c && <small className="mi-quien">👥 {comDe(c)}/{capacidadCuenta(c, s.mesas) || m.cap || 0}{c.abiertaPor ? ` · 👤 ${c.abiertaPor}` : ''}{c.detalle ? ' · 📝' : ''}</small>}
                  {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(m.zona)}</span>}
                </button>
              )
            })}
          </div>
        )}

        <div className="lienzo-area" hidden={(vista === 'lista' && !edit) || enLlevar}>
          <div className="lienzo-wrap">
            <div ref={lienzo} className={'lienzo' + (edit ? ' edit' : '')} style={{ ['--z']: String(zoom) }}
              onPointerDown={e => { if (e.target === e.currentTarget) setSel(null) }}
              onPointerMove={move} onPointerUp={up} onPointerCancel={suelta}>
          {mesasZona.length === 0 && (
            <p className="lienzo-vacio">{edit && admin ? t('salon.sinMesas') : t('salon.sinMesasZona')}</p>
          )}
          {mesasZona.map(m => {
            const cs = cuentasDeMesa(s, m.id), c = cs[0], est = estadoVarias(cs)
            const resto = round2(cs.reduce((a, x) => a + saldoCuenta(x), 0))
            const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1

            const capT = capacidadCuenta(c, s.mesas) || (m.cap || 0)
            const com = c ? comDe(c) : null
            const p = mueve && mueve.id === m.id ? mueve : m
            const num = numeroDeMesa(m)
            const sub = c ? `${money(resto)} · 👥 ${com}/${capT}${c.abiertaPor ? ` · 👤 ${c.abiertaPor}` : ''}` : `${t('salon.' + est)} · 👥 ${m.cap}`
            return (
              <div key={m.id} className={`mesa ${m.forma} ${est}${sel === m.id ? ' sel' : ''}${mueve?.id === m.id ? ' arrastrando' : ''}`}
                title={sub}
                onPointerDown={e => down(e, m)} onClick={() => { if (!(edit && admin)) abrirMesa(m.id) }} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: `${(p.w / W) * 100}%`, height: `${(p.h / H) * 100}%` }}>
                <b className="nombre">{num || m.nombre}</b>
                {num && <span className="mesa-nom">{m.nombre}</span>}
                {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(m.zona)}</span>}
                {c && heredadas.includes(c.id) && <span className="badge-heredada" title={t('salon.heredadaTitle')}>↩</span>}
                {!unida && cs.length > 1 && <span className="badge-unida" title={t('pedido.menuDividir')}>✂ ×{cs.length}</span>}
                {unida && (
                  <span className="badge-unida" title={t('salon.unidaTitle', { n: c.mesaIds.length, total: money(totalCuenta(c)) })}>
                    🔗 ×{c.mesaIds.length}
                  </span>
                )}
              </div>
            )
          })}
            </div>
          </div>
          {/* El zoom es una herramienta de edición del mapa: fuera de «Editar salón» estorbaba la vista de las mesas. */}
          {edit && admin && (
            <div className="zoom-ctrl" role="group" aria-label={tOr('salon.zoomTitulo', 'Zoom del mapa')}>
              <button type="button" className="ico" onClick={zoomAlejar} disabled={zoom <= ZOOM_MIN} title={tOr('salon.zoomAlejar', 'Alejar el mapa')} aria-label={tOr('salon.zoomAlejar', 'Alejar el mapa')}>−</button>
              <button type="button" className="zoom-pct" onClick={() => setZoom(1)} title={tOr('salon.zoomReset', 'Restablecer zoom')} aria-label={tOr('salon.zoomReset', 'Restablecer zoom')}>{Math.round(zoom * 100)} %</button>
              <button type="button" className="ico" onClick={zoomAcercar} disabled={zoom >= ZOOM_MAX} title={tOr('salon.zoomAcercar', 'Acercar el mapa')} aria-label={tOr('salon.zoomAcercar', 'Acercar el mapa')}>＋</button>
            </div>
          )}
        </div>

        {enLlevar && (
          <div className="llevar">
            <p className="llevar-ayuda">{tOr('salon.llevarAyuda', 'Pedidos que se retiran, sin mesa: se cobran acá mismo o desde Caja.')}</p>
            {puede(rol, 'abrir_mesa') && !cli && (
              <div className="barra"><button className="success" onClick={nuevoLlevar}>＋ {tOr('salon.llevarNuevoPedido', 'Nuevo pedido')}</button></div>
            )}
            {cli && (
              <div className="llevar-form">
                <input name="llevar-nombre" autoFocus value={cli.nombre} maxLength={80} placeholder={t('salon.llevarNombre')} aria-label={t('salon.llevarNombre')}
                  onChange={e => setCli({ ...cli, nombre: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') guardarCli(); if (e.key === 'Escape') setCli(null) }} />
                <input name="llevar-tel" value={cli.tel} maxLength={40} inputMode="tel" placeholder={t('salon.llevarTel')} aria-label={t('salon.llevarTel')}
                  onChange={e => setCli({ ...cli, tel: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') guardarCli(); if (e.key === 'Escape') setCli(null) }} />
                <button className="primary" onClick={guardarCli}>{t('comun.guardar')}</button>
                <button className="ghost" onClick={() => setCli(null)}>{t('comun.cancelar')}</button>
              </div>
            )}
            {llevarCuentas.length === 0 && !cli && <p className="lienzo-vacio" style={{ position: 'static' }}>{t('salon.llevarVacio')}</p>}
            <div className="llevar-lista">
              {llevarCuentas.map(c => (
                <div key={c.id} className={'llevar-card ' + estadoMesa(c)}>
                  <button type="button" className="llevar-main" onClick={() => abrirLlevar(c.id)}>
                    <b>{c.clienteNombre ? t('salon.llevarCliente', { n: c.numero }) : tOr('salon.llevarPedido', 'Pedido {n}', { n: c.numero })}</b>
                    {c.clienteNombre && <span className="llevar-nombre">{c.clienteNombre}</span>}
                    {!c.clienteNombre && <small className="llevar-sin-nombre">{tOr('salon.llevarSinNombre', 'Sin nombre · escríbelo en el pedido')}</small>}
                    {c.clienteTel && <small>{c.clienteTel}</small>}
                    <small className="importe">{money(saldoCuenta(c))} · {t('salon.' + estadoMesa(c))}</small>
                  </button>
                  {puede(rol, 'abrir_mesa') && (
                    <div className="llevar-acc">
                      <button type="button" className="ghost" onClick={() => setCli({ id: c.id, nombre: c.clienteNombre || '', tel: c.clienteTel || '' })}>✎ {t('salon.llevarEditar')}</button>
                      <button type="button" className="ghost" onClick={() => setAMesa(aMesa?.cuentaId === c.id ? null : { cuentaId: c.id, mesaId: '', com: 1 })}>➜ {t('salon.llevarAMesa')}</button>
                    </div>
                  )}
                  {aMesa?.cuentaId === c.id && (
                    <div className="llevar-mesa">
                      {mesasLibres.length === 0 ? <small>{t('salon.llevarSinMesas')}</small> : (
                        <>
                          <select name="llevar-elegir-mesa" value={aMesa.mesaId} aria-label={t('salon.llevarElegirMesa')} onChange={e => setAMesa({ ...aMesa, mesaId: e.target.value })}>
                            <option value="">{t('salon.llevarElegirMesa')}</option>
                            {mesasLibres.map(m => <option key={m.id} value={m.id}>{m.nombre} · {zonaNombre(m.zona)}</option>)}
                          </select>
                          <input name="comensales" type="number" min={COM_MIN} max={COM_MAX} value={aMesa.com} aria-label={t('pedido.comensales')} onChange={e => setAMesa({ ...aMesa, com: e.target.value })} />
                          <button className="primary" disabled={!aMesa.mesaId} onClick={pasarAMesa}>{t('salon.llevarMover')}</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!enLlevar && <div className="leyenda">
          {[['libre', t('salon.libre')], ['ocupada', t('salon.ocupada')], ['enviada', t('salon.enviada')], ['porcobrar', t('salon.porcobrar')]].map(([k, l]) => (
            <span key={k}><i className={'pt ' + k} />{l}</span>
          ))}
          <span><i className="pt pax" />{t('salon.leyendaPax')}</span>
          <span><i className="pt unida" />{t('salon.leyendaUnidas')}</span>
        </div>}
      </section>
      <OrderPanel rol={rol} sesion={sesion} mesa={enLlevar ? undefined : mesaSel} cuenta={enLlevar ? llevarSel : undefined}
        cobro={cobro} onEdicion={() => setCobro(false)}
        onClose={() => { setCobro(false); setSel(null); setLlevarSelId(null) }} bloqueado={edit} />
    </div>
  )
}

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
