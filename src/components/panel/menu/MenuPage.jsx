import { useEffect, useState } from 'react'
import { MONEDA } from '../../../services/config.js'
import { useStore, nuevoId } from '../../../context/StoreContext.jsx'
import { gruposDeComanda, grupoDeSeccion } from '../../../services/printing.js'
import { agotadosHoy, conMarca, conMarcas } from '../../../services/soldOut.js'
import { puede } from '../../../services/permissions'
import { listasConfig, nuevaLista, parsearOpcionesLista } from '../../../services/indicaciones.js'
import { sb } from '../../../services/supabaseClient.js'
import {
  LADO_VISUAL_PX, urlImagenProducto, procesarYGuardarImagen, quitarImagenGuardada,
} from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import '../../../styles/admin.css'
import './MenuPage.css'
import { formatearMonto } from '../../../services/money.js'
import { limpiarMonto, numMonto } from '../../../services/format.js'

// El % de precio masivo admite signo negativo (bajar precios), así que necesita su propio sanitizer:
// limpiarMonto eliminaría el «-». Permite un «-» inicial y hasta 2 decimales.
const limpiarPct = txt => {
  const s0 = String(txt ?? '').replace(/[^0-9.,-]/g, '').replace(',', '.')
  const neg = s0.startsWith('-')
  const m = s0.replace(/-/g, '').match(/^\d*\.?\d{0,2}/)
  return (neg ? '-' : '') + (m ? m[0] : '')
}
const normalizarPct = v => (v !== '' && v !== '-' ? Number(v).toFixed(2) : '')
const normalizarMonto = v => (v !== '' ? numMonto(v).toFixed(2) : '')

function Miniatura({ producto }) {
  const url = urlImagenProducto(producto)
  const inicial = ((producto.nombre || '').trim().charAt(0) || '?').toUpperCase()
  return (
    <span className="adm-thumb" style={{ width: LADO_VISUAL_PX, height: LADO_VISUAL_PX }}>
      {url
        ? <img src={url} alt={`Foto de ${producto.nombre}`} loading="lazy" />
        : <span className="adm-thumb-ini" aria-hidden="true">{inicial}</span>}
    </span>
  )
}

// Ventana en primer plano (sobre todo lo demás): se cierra con Esc o tocando fuera.
function Ventana({ titulo, onCerrar, children }) {
  useEffect(() => {
    const f = e => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', f)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', f); document.body.style.overflow = previo }
  }, [onCerrar])
  return (
    <div className="mn-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="mn-ventana" role="dialog" aria-modal="true" aria-label={titulo}>
        <h3 className="mn-ventana-tit">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}

const norm = x => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export default function MenuPage({ rol }) {
  const { s, d, modo } = useStore()
  const { t, tOr } = useIdioma()
  const moneda = s.config?.moneda || MONEDA
  const money = n => formatearMonto(n, moneda)

  const [abiertas, setAbiertas] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('pos-menu-abiertas')) || []) } catch { return new Set() }
  })
  useEffect(() => { try { sessionStorage.setItem('pos-menu-abiertas', JSON.stringify([...abiertas])) } catch { /* sin almacenamiento */ } }, [abiertas])
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState({ k: 'numero', dir: 1 })
  const [vGrupo, setVGrupo] = useState(null)   // ventana de grupo: { id|null, nombre, grupoImp }
  const [vProd, setVProd] = useState(null)     // ventana de producto: { id|null, seccionId, nombre, precio, areas, opciones }
  const [vInd, setVInd] = useState(null)       // ventana de lista de indicaciones: { id|null, nombre, obligatoria, max, opciones(texto), secciones, productos }
  const [confInd, setConfInd] = useState(false)
  const [confSeccion, setConfSeccion] = useState(false)
  const [confProd, setConfProd] = useState(false)
  const [subiendoId, setSubiendoId] = useState(null)
  const [avisoImg, setAvisoImg] = useState(null)
  const [sel, setSel] = useState(() => new Set())
  const [pctTmp, setPctTmp] = useState('')
  const [fijoTmp, setFijoTmp] = useState('')
  const [seccionTmp, setSeccionTmp] = useState('')
  const [areasTmp, setAreasTmp] = useState([])
  const [motivoTmp, setMotivoTmp] = useState('')

  const esAdmin = puede(rol, 'gestionar_menu')
  if (!esAdmin) {
    return (
      <div className="adm-panel">
        <div className="adm-aviso">{t('menu.sinPermiso', { rol })}</div>
      </div>
    )
  }

  const secciones = [...s.secciones].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.nombre > b.nombre ? 1 : -1))
  const grupos = gruposDeComanda(s.config)             // grupos de impresión (Cocina, Barra…)
  const grupoActual = id => grupoDeSeccion(s.config, id)
  const areasIds = grupos.map(g => g.id)
  const asignarGrupo = (seccionId, grupoId) => {
    if (!grupoId || (grupoActual(seccionId)?.id === grupoId && s.config?.impresoraPorSeccion?.[seccionId] === grupoId)) return
    d({ t: 'cfg~', cambios: { impresoraPorSeccion: { ...(s.config?.impresoraPorSeccion || {}), [seccionId]: grupoId } } })
  }
  const alternar = id => setAbiertas(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Nº de ítem: lo asigna el servidor (consecutivo por negocio, no se reutiliza). En demo antiguo sin número: posición.
  const numeroDe = p => p.numero ?? (s.productos.indexOf(p) + 1)

  // ---------- búsqueda y orden ----------
  const q = norm(busqueda).trim().replace(/^#/, '').replace(',', '.')
  const coincide = p => !q
    || norm(p.nombre).includes(q)
    || String(numeroDe(p)).startsWith(q)
    || Number(p.precio).toFixed(2).includes(q)
  const prodsDe = secId => s.productos
    .filter(p => p.seccionId === secId && coincide(p))
    .sort((a, b) => {
      const k = orden.k
      const va = k === 'nombre' ? norm(a.nombre) : k === 'precio' ? Number(a.precio) : numeroDe(a)
      const vb = k === 'nombre' ? norm(b.nombre) : k === 'precio' ? Number(b.precio) : numeroDe(b)
      return (va > vb ? 1 : va < vb ? -1 : 0) * orden.dir
    })
  const ordenarPor = k => setOrden(o => (o.k === k ? { k, dir: -o.dir } : { k, dir: 1 }))
  const flecha = k => (orden.k === k ? (orden.dir === 1 ? ' ▲' : ' ▼') : '')

  // ---------- grupos ----------
  const abrirNuevoGrupo = () => setVGrupo({ id: null, nombre: '', grupoImp: grupos[0]?.id || '' })
  const abrirEditarGrupo = sec => { setConfSeccion(false); setVGrupo({ id: sec.id, nombre: sec.nombre, grupoImp: grupoActual(sec.id)?.id || grupos[0]?.id || '' }) }
  const guardarGrupo = e => {
    e.preventDefault()
    const nombre = vGrupo.nombre.trim()
    if (!nombre) return
    if (vGrupo.id) {
      d({ t: 'seccion~', id: vGrupo.id, cambios: { nombre } })
      asignarGrupo(vGrupo.id, vGrupo.grupoImp)
    } else {
      const id = nuevoId()
      d({ t: 'seccion+', seccion: { id, nombre } })
      asignarGrupo(id, vGrupo.grupoImp || grupos[0]?.id)
      setAbiertas(a => new Set([...a, id]))
    }
    setVGrupo(null)
  }
  const borrarSeccion = sec => {
    d({ t: 'seccion-', id: sec.id })
    d({ t: 'cfg~', cambios: { agotados: conMarcas(s.config, s.productos.filter(p => p.seccionId === sec.id).map(p => p.id), null) } })
    setAbiertas(a => { const n = new Set(a); n.delete(sec.id); return n })
    setVGrupo(null); setConfSeccion(false)
  }
  const mover = (idx, dir) => {
    const a = secciones[idx]
    const b = secciones[idx + dir]
    if (!b) return
    let oa = a.orden ?? idx + 1
    let ob = b.orden ?? idx + 2 + dir
    if (oa === ob) ob = oa + dir
    d({ t: 'seccion~', id: a.id, cambios: { orden: ob } })
    d({ t: 'seccion~', id: b.id, cambios: { orden: oa } })
  }

  // ---------- listas de indicaciones ----------
  const listas = listasConfig(s.config)
  const guardarListas = nuevas => d({ t: 'cfg~', cambios: { indicaciones: nuevas } })
  const abrirNuevaInd = () => { setConfInd(false); setVInd({ ...nuevaLista(), id: null, opciones: '' }) }
  const abrirEditarInd = l => { setConfInd(false); setVInd({ ...l, opciones: (l.opciones || []).join(', '), max: l.max || 0, min: l.min || 0, detalle: l.detalle || {} }) }
  const guardarInd = e => {
    e.preventDefault()
    const nombre = vInd.nombre.trim()
    const opciones = parsearOpcionesLista(vInd.opciones)
    if (!nombre || !opciones.length) return
    const max = Math.max(0, Math.floor(Number(vInd.max) || 0))
    const min = Math.max(0, Math.min(Math.floor(Number(vInd.min) || 0), max || 99))
    const detalle = {}
    opciones.forEach(o => {
      const x = vInd.detalle?.[o]
      const extra = Math.max(0, numMonto(x?.extra))
      if ((Number.isFinite(extra) && extra > 0) || x?.producto_id) detalle[o] = { ...(extra > 0 ? { extra: Math.round(extra * 100) / 100 } : {}), ...(x?.producto_id ? { producto_id: x.producto_id } : {}) }
    })
    const l = { id: vInd.id || nuevoId(), nombre, obligatoria: Boolean(vInd.obligatoria), min, max, detalle, opciones, secciones: vInd.secciones || [], productos: vInd.productos || [] }
    guardarListas(vInd.id ? listas.map(x => (x.id === l.id ? l : x)) : [...listas, l])
    setVInd(null)
  }
  const borrarInd = () => { guardarListas(listas.filter(x => x.id !== vInd.id)); setVInd(null); setConfInd(false) }
  const alternarEn = (k, id) => setVInd(v => ({ ...v, [k]: (v[k] || []).includes(id) ? v[k].filter(x => x !== id) : [...(v[k] || []), id] }))
  const listasDeProd = p => listas.filter(l => (l.productos || []).includes(p.id) || (l.secciones || []).includes(p.seccionId))

  // ---------- productos ----------
  const parsearOpciones = txt => [...new Set(String(txt || '').split(/[,;\n]/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
  const areasDe = p => (Array.isArray(p.areas) && p.areas.length ? p.areas : null)
  const nombreArea = id => grupos.find(g => g.id === id)?.nombre || tOr('cocina.sinArea', 'Sin área')
  const areasPorDefecto = (p, secId) => {
    const base = (p && areasDe(p)) || [grupoActual(secId ?? p?.seccionId)?.id]
    const filtradas = base.filter(id => areasIds.includes(id))
    return filtradas.length ? filtradas : [areasIds[0] || 'cocina']
  }
  const alternarArea = (lista, setLista, id) => {
    const n = lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]
    if (!n.length) return
    setLista(n)
  }
  const checkboxesAreas = (lista, setLista) => (
    <span className="menu-areas" role="group" aria-label={tOr('areas.label', 'Imprimir en')}>
      {areasIds.map(id => (
        <label key={id} className="menu-area" title={tOr('areas.ayuda', 'Marca todos los grupos donde se imprime este artículo')}>
          <input type="checkbox" checked={lista.includes(id)} onChange={() => alternarArea(lista, setLista, id)} />
          {nombreArea(id)}
        </label>
      ))}
    </span>
  )
  const abrirNuevoProd = secId => {
    const sid = secId || secciones.find(x => abiertas.has(x.id))?.id || secciones[0]?.id
    if (!sid) return
    setConfProd(false); setAvisoImg(null); setMotivoTmp('')
    setVProd({ id: null, seccionId: sid, nombre: '', precio: '', opciones: '', areas: areasPorDefecto(null, sid) })
  }
  const abrirEditarProd = p => {
    setConfProd(false); setAvisoImg(null); setMotivoTmp('')
    setVProd({ id: p.id, seccionId: p.seccionId, nombre: p.nombre, precio: String(p.precio), opciones: (p.opciones || []).join(', '), areas: areasPorDefecto(p) })
  }
  const guardarProducto = e => {
    e.preventDefault()
    const nombre = vProd.nombre.trim()
    const precio = numMonto(vProd.precio)
    if (!nombre || !Number.isFinite(precio) || precio < 0 || !vProd.seccionId) return
    const datos = { nombre, precio, seccionId: vProd.seccionId, areas: vProd.areas, opciones: parsearOpciones(vProd.opciones) }
    if (vProd.id) d({ t: 'producto~', id: vProd.id, cambios: datos })
    else { d({ t: 'producto+', producto: datos }); setAbiertas(a => new Set([...a, vProd.seccionId])) }
    setVProd(null)
  }
  const prodEditando = vProd?.id ? s.productos.find(x => x.id === vProd.id) : null

  const dispatchFoto = (p, cambios) => {
    const actual = s.productos.find(x => x.id === p.id) || p
    d({ t: 'producto~', id: p.id, cambios: { nombre: actual.nombre, precio: actual.precio, activo: actual.activo, ...cambios } })
  }
  const subirFoto = async (p, e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !esAdmin) return
    setSubiendoId(p.id); setAvisoImg(null)
    try {
      const cambios = await procesarYGuardarImagen({ sb, modo, empresaId: s._empresaId, productoId: p.id, file })
      dispatchFoto(p, cambios)
    } catch (err) {
      setAvisoImg({ id: p.id, msg: err?.message || tOr('menu.errorFoto', 'No se pudo procesar la imagen.') })
    } finally { setSubiendoId(null) }
  }
  const quitarFoto = async p => {
    if (!esAdmin) return
    setSubiendoId(p.id); setAvisoImg(null)
    try {
      const actual = s.productos.find(x => x.id === p.id) || p
      const cambios = await quitarImagenGuardada({ sb, modo, empresaId: s._empresaId, productoId: p.id, imagen_path: actual.imagen_path })
      dispatchFoto(p, cambios)
    } catch (err) {
      setAvisoImg({ id: p.id, msg: err?.message || tOr('menu.errorQuitarFoto', 'No se pudo quitar la imagen.') })
    } finally { setSubiendoId(null) }
  }

  const agotados = agotadosHoy(s.config)
  const marcarAgotado = (ids, marca) => d({ t: 'cfg~', cambios: { agotados: conMarcas(s.config, ids, marca) } })

  // ---------- selección y cambios masivos ----------
  const redondear = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
  const idsSel = () => s.productos.filter(p => sel.has(p.id)).map(p => p.id)
  const alternarSel = id => setSel(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selSeccion = (lista, on) => setSel(a => { const n = new Set(a); lista.forEach(p => { if (on) n.add(p.id); else n.delete(p.id) }); return n })
  const aplicarASeleccion = cambios => idsSel().forEach(id => d({ t: 'producto~', id, cambios }))
  const aplicarPorcentaje = () => {
    const pct = Number(pctTmp)
    if (!Number.isFinite(pct) || pct === 0 || pct <= -100) return
    s.productos.filter(p => sel.has(p.id)).forEach(p => d({ t: 'producto~', id: p.id, cambios: { precio: redondear(Math.max(0, p.precio * (1 + pct / 100))) } }))
    setPctTmp('')
  }
  const aplicarPrecioFijo = () => {
    const v = numMonto(fijoTmp)
    if (!Number.isFinite(v) || v < 0) return
    aplicarASeleccion({ precio: redondear(v) })
    setFijoTmp('')
  }
  const aplicarSeccion = () => { if (seccionTmp) { aplicarASeleccion({ seccionId: seccionTmp }); setSeccionTmp('') } }
  const aplicarAreas = () => { if (areasTmp.length) aplicarASeleccion({ areas: areasTmp }) }

  const vacio = secciones.length === 0
  const hayBusqueda = Boolean(q)
  const gruposVisibles = secciones.filter(sec => !hayBusqueda || prodsDe(sec.id).length > 0)

  return (
    <div className="adm-panel">
      <div className="adm-cab">
        <h2>{t('menu.titulo')}</h2>
        <div className="adm-fila mn-acciones">
          <button type="button" className="success" onClick={abrirNuevoGrupo}>+ {t('menu.grupoMas')}</button>
          {!vacio && <button type="button" className="success" onClick={() => abrirNuevoProd()}>+ {t('menu.productoMas')}</button>}
          {!vacio && <button type="button" className="success" onClick={abrirNuevaInd}>+ {t('indic.mas')}</button>}
        </div>
      </div>

      {vacio && <div className="adm-aviso mn-vacio">{t('menu.menuVacio')}</div>}

      {!vacio && (
        <div className="adm-fila menu-barra mn-barra">
          <input className="mn-buscar" type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder={t('menu.buscarPlace')} aria-label={t('menu.buscarPlace')} />
          <button type="button" className="ghost" onClick={() => setAbiertas(new Set(secciones.map(x => x.id)))}>▾ {t('menu.mostrarTodo')}</button>
          <button type="button" className="ghost" onClick={() => setAbiertas(new Set())}>▸ {t('menu.ocultarTodo')}</button>
          {Object.keys(agotados).length > 0 && <span className="adm-chip adm-chip-agotado" title={t('agotado.contadorTitle')}>🚫 {t('agotado.contador', { n: Object.keys(agotados).length })}</span>}
        </div>
      )}

      {sel.size > 0 && (
        <div className="adm-masivo">
          <span className="adm-chip">{t('menu.masivoSel', { n: sel.size })}</span>
          <span className="adm-masivo-grupo">
            <input className="adm-num" type="text" inputMode="decimal" autoComplete="off" value={pctTmp}
              onChange={e => setPctTmp(limpiarPct(e.target.value))} onBlur={() => setPctTmp(normalizarPct(pctTmp))}
              onFocus={e => e.target.select()} placeholder={t('menu.masivoPorcentaje')} aria-label={t('menu.masivoPorcentaje')} />
            <button type="button" className="ghost" onClick={aplicarPorcentaje}>{t('menu.masivoAplicar')}</button>
            <input className="adm-num" type="text" inputMode="decimal" autoComplete="off" value={fijoTmp}
              onChange={e => setFijoTmp(limpiarMonto(e.target.value))} onBlur={() => setFijoTmp(normalizarMonto(fijoTmp))}
              onFocus={e => e.target.select()} placeholder={t('menu.masivoFijo')} aria-label={t('menu.masivoFijo')} />
            <button type="button" className="ghost" onClick={aplicarPrecioFijo}>{t('menu.masivoAplicar')}</button>
          </span>
          <span className="adm-masivo-grupo">
            <select value={seccionTmp} onChange={e => setSeccionTmp(e.target.value)} aria-label={t('menu.masivoSeccion')}>
              <option value="">{t('menu.masivoSeccion')}</option>
              {secciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <button type="button" className="ghost" onClick={aplicarSeccion}>{t('menu.masivoAplicar')}</button>
          </span>
          <span className="adm-masivo-grupo">
            {checkboxesAreas(areasTmp, setAreasTmp)}
            <button type="button" className="ghost" onClick={aplicarAreas} disabled={!areasTmp.length}>{t('menu.masivoAplicar')}</button>
          </span>
          <button type="button" className="success" onClick={() => aplicarASeleccion({ activo: true })}>{t('menu.activar')}</button>
          <button type="button" className="warning" onClick={() => aplicarASeleccion({ activo: false })}>{t('menu.desactivar')}</button>
          <span className="adm-masivo-grupo">
            <input value={motivoTmp} maxLength={60} onChange={e => setMotivoTmp(e.target.value)} placeholder={t('agotado.motivoPlace')} aria-label={t('agotado.motivoPlace')} />
            <button type="button" className="danger" onClick={() => { marcarAgotado(idsSel(), { motivo: motivoTmp }); setMotivoTmp('') }}>{t('agotado.hoy')}</button>
            <button type="button" className="ghost" onClick={() => marcarAgotado(idsSel(), null)}>{t('agotado.disponible')}</button>
          </span>
          <span className="sp" />
          <button type="button" className="danger" onClick={() => setSel(new Set())}>✕ {t('menu.masivoLimpiar')}</button>
        </div>
      )}

      {!vacio && listas.length > 0 && !hayBusqueda && (
        <section className="adm-card mn-grupo mn-indics">
          <header className="mn-grupo-cab"><h3>{t('indic.titulo')}</h3><span className="adm-chip">{listas.length}</span></header>
          <ul className="mn-lista">
            {listas.map(l => (
              <li key={l.id} className="mn-fila mn-fila-ind">
                <span className="mn-nombre">{l.nombre}
                  <small> · {l.opciones.join(', ')}</small>
                  <small> · {l.obligatoria ? t('indic.obligatoria') : t('indic.opcional')}{l.max ? ` · ${t('indic.hasta', { n: l.max })}` : ''}</small>
                </span>
                <button type="button" className="info" onClick={() => abrirEditarInd(l)}>{t('comun.editar')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hayBusqueda && gruposVisibles.length === 0 && <div className="adm-aviso">{t('menu.sinResultados')}</div>}

      {gruposVisibles.map(sec => {
        const todos = s.productos.filter(p => p.seccionId === sec.id)
        const prods = prodsDe(sec.id)
        const abierta = hayBusqueda || abiertas.has(sec.id)
        const i = secciones.indexOf(sec)
        return (
          <section key={sec.id} className="adm-card mn-grupo">
            <header className="mn-grupo-cab">
              <button type="button" className="mn-grupo-btn" aria-expanded={abierta} onClick={() => alternar(sec.id)}>
                <span className="menu-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
                <h3>{sec.nombre}</h3>
                <span className="adm-chip">{t('menu.nProductos', { n: todos.length })}</span>
                {grupoActual(sec.id) && <span className="adm-chip menu-chip-imp" title={t('menu.imprimirEnTitle')}>🖨 {grupoActual(sec.id).nombre}</span>}
              </button>
              {abierta && (
                <span className="cab-acciones">
                  <button type="button" className="ghost" title={t('menu.subir')} disabled={i === 0} onClick={() => mover(i, -1)}>▲</button>
                  <button type="button" className="ghost" title={t('menu.bajar')} disabled={i === secciones.length - 1} onClick={() => mover(i, 1)}>▼</button>
                  <button type="button" className="info" onClick={() => abrirEditarGrupo(sec)}>{t('comun.editar')}</button>
                  <button type="button" className="success" onClick={() => abrirNuevoProd(sec.id)}>+ {t('menu.productoMas')}</button>
                </span>
              )}
            </header>

            {abierta && (
              <>
                {prods.length === 0 ? <div className="adm-vacio">{hayBusqueda ? t('menu.sinResultados') : t('menu.sinProductos')}</div> : (
                  <ul className="mn-lista">
                    <li className="mn-fila mn-fila-cab">
                      <input type="checkbox" className="adm-sel" aria-label={t('menu.todoSeccion')}
                        checked={prods.length > 0 && prods.every(p => sel.has(p.id))} onChange={e => selSeccion(prods, e.target.checked)} />
                      <button type="button" className="mn-orden" onClick={() => ordenarPor('numero')}>{t('menu.colNum')}{flecha('numero')}</button>
                      <button type="button" className="mn-orden mn-orden-nombre" onClick={() => ordenarPor('nombre')}>{t('menu.colNombre')}{flecha('nombre')}</button>
                      <button type="button" className="mn-orden mn-orden-precio" onClick={() => ordenarPor('precio')}>{t('menu.colPrecio')}{flecha('precio')}</button>
                      <span />
                    </li>
                    {prods.map(p => (
                      <li key={p.id} className={'mn-fila' + (p.activo ? '' : ' inactivo') + (agotados[p.id] ? ' agotado' : '') + (sel.has(p.id) ? ' sel' : '')}>
                        <input type="checkbox" className="adm-sel" checked={sel.has(p.id)} onChange={() => alternarSel(p.id)} aria-label={t('menu.seleccionar')} />
                        <span className="mn-num">#{numeroDe(p)}</span>
                        <span className="mn-nombre">{p.nombre}
                          {!p.activo && <small> {t('menu.oculto')}</small>}
                          {agotados[p.id] && <small> {t('agotado.badge')}</small>}
                          {((p.opciones || []).length + listasDeProd(p).length) > 0 && <small title={t('menu.opcionesTitle')}> ✎{(p.opciones || []).length + listasDeProd(p).length}</small>}
                        </span>
                        <span className="mn-precio">{money(p.precio)}</span>
                        <button type="button" className="info" onClick={() => abrirEditarProd(p)}>{t('comun.editar')}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        )
      })}

      {vInd && (
        <Ventana titulo={vInd.id ? t('indic.editar') : t('indic.nueva')} onCerrar={() => setVInd(null)}>
          <form className="mn-form" onSubmit={guardarInd}>
            <label className="adm-campo"><span>{t('menu.nombre')}</span>
              <input autoFocus value={vInd.nombre} maxLength={60} onChange={e => setVInd({ ...vInd, nombre: e.target.value })} placeholder={t('indic.nombrePlace')} />
            </label>
            <label className="adm-campo"><span>{t('indic.opciones')}</span>
              <input value={vInd.opciones} maxLength={600} onChange={e => setVInd({ ...vInd, opciones: e.target.value })} placeholder={t('indic.opcionesPlace')} />
            </label>
            <div className="mn-dos">
              <label className="menu-area"><input type="checkbox" checked={vInd.obligatoria} onChange={e => setVInd({ ...vInd, obligatoria: e.target.checked })} /> {t('indic.obligatoria')}</label>
              <label className="adm-campo"><span>{t('indic.min')}</span>
                <input type="text" inputMode="numeric" autoComplete="off" value={!vInd.min ? '' : String(vInd.min)} placeholder="1"
                  onChange={e => setVInd({ ...vInd, min: e.target.value.replace(/\D/g, '').slice(0, 2) })} onFocus={e => e.target.select()} />
              </label>
              <label className="adm-campo"><span>{t('indic.max')}</span>
                <input type="text" inputMode="numeric" autoComplete="off" value={vInd.max === 0 ? '' : String(vInd.max)} placeholder={t('indic.sinLimite')}
                  onChange={e => setVInd({ ...vInd, max: e.target.value.replace(/\D/g, '').slice(0, 2) })} onFocus={e => e.target.select()} />
              </label>
            </div>
            {parsearOpcionesLista(vInd.opciones).length > 0 && (
              <details className="mn-avanzado">
                <summary>{t('indic.detalleOpc')}</summary>
                <p className="mn-itemnum">{t('indic.detalleAyuda')}</p>
                {parsearOpcionesLista(vInd.opciones).map(o => (
                  <div key={o} className="mn-dos mn-det">
                    <span className="mn-nombre">{o}</span>
                    <input type="text" inputMode="decimal" autoComplete="off" aria-label={t('indic.extra')} placeholder={t('indic.extra')}
                      value={vInd.detalle?.[o]?.extra ?? ''} onFocus={e => e.target.select()}
                      onChange={e => setVInd(v => ({ ...v, detalle: { ...(v.detalle || {}), [o]: { ...(v.detalle?.[o] || {}), extra: limpiarMonto(e.target.value) } } }))} />
                    <select aria-label={t('indic.producto')} value={vInd.detalle?.[o]?.producto_id || ''}
                      onChange={e => setVInd(v => ({ ...v, detalle: { ...(v.detalle || {}), [o]: { ...(v.detalle?.[o] || {}), producto_id: e.target.value } } }))}>
                      <option value="">{t('indic.sinProducto')}</option>
                      {s.productos.map(p => <option key={p.id} value={p.id}>#{numeroDe(p)} {p.nombre}</option>)}
                    </select>
                  </div>
                ))}
              </details>
            )}
            <div className="adm-campo"><span>{t('indic.aplicaGrupos')}</span>
              <div className="mn-chips">
                {secciones.map(x => (
                  <button key={x.id} type="button" className={'mn-chip' + ((vInd.secciones || []).includes(x.id) ? ' on' : '')} onClick={() => alternarEn('secciones', x.id)}>{x.nombre}</button>
                ))}
              </div>
            </div>
            <details className="mn-avanzado">
              <summary>{t('indic.aplicaProductos', { n: (vInd.productos || []).length })}</summary>
              {secciones.map(x => {
                const ps = s.productos.filter(p => p.seccionId === x.id)
                return ps.length === 0 ? null : (
                  <div key={x.id} className="mn-ind-grupo">
                    <small>{x.nombre}</small>
                    <div className="mn-chips">
                      {ps.map(p => <button key={p.id} type="button" className={'mn-chip' + ((vInd.productos || []).includes(p.id) ? ' on' : '')} onClick={() => alternarEn('productos', p.id)}>#{numeroDe(p)} {p.nombre}</button>)}
                    </div>
                  </div>
                )
              })}
            </details>
            <div className="mn-pie">
              {vInd.id && (confInd ? (
                <>
                  <span className="imp-dato">{t('indic.confirmarEliminar', { nombre: vInd.nombre })}</span>
                  <button type="button" className="danger solid" onClick={borrarInd}>{t('comun.confirmar')}</button>
                  <button type="button" className="ghost" onClick={() => setConfInd(false)}>{t('comun.cancelar')}</button>
                </>
              ) : <button type="button" className="danger" onClick={() => setConfInd(true)}>{t('comun.eliminar')}</button>)}
              <span className="sp" />
              <button type="button" className="ghost" onClick={() => setVInd(null)}>{t('comun.cancelar')}</button>
              <button type="submit" className="primary" disabled={!vInd.nombre.trim() || !parsearOpcionesLista(vInd.opciones).length}>{t('comun.guardar')}</button>
            </div>
          </form>
        </Ventana>
      )}

      {vGrupo && (
        <Ventana titulo={vGrupo.id ? t('menu.grupoEditar') : t('menu.grupoNuevo')} onCerrar={() => setVGrupo(null)}>
          <form className="mn-form" onSubmit={guardarGrupo}>
            <label className="adm-campo"><span>{t('menu.grupoNombre')}</span>
              <input autoFocus value={vGrupo.nombre} maxLength={80} onChange={e => setVGrupo({ ...vGrupo, nombre: e.target.value })} placeholder={t('menu.grupoPlace')} />
            </label>
            <div className="adm-campo"><span>{t('menu.grupoEnviaA')}</span>
              <div className="mn-chips" role="radiogroup" aria-label={t('menu.grupoEnviaA')}>
                {grupos.map(g => (
                  <button key={g.id} type="button" role="radio" aria-checked={vGrupo.grupoImp === g.id}
                    className={'mn-chip' + (vGrupo.grupoImp === g.id ? ' on' : '')} onClick={() => setVGrupo({ ...vGrupo, grupoImp: g.id })}>🖨 {g.nombre}</button>
                ))}
              </div>
            </div>
            <div className="mn-pie">
              {vGrupo.id && (confSeccion ? (
                <>
                  <span className="imp-dato">{t('menu.confirmarEliminarSeccion', { n: s.productos.filter(p => p.seccionId === vGrupo.id).length })}</span>
                  <button type="button" className="danger solid" onClick={() => borrarSeccion(secciones.find(x => x.id === vGrupo.id))}>{t('comun.confirmar')}</button>
                  <button type="button" className="ghost" onClick={() => setConfSeccion(false)}>{t('comun.cancelar')}</button>
                </>
              ) : <button type="button" className="danger" onClick={() => setConfSeccion(true)}>{t('comun.eliminar')}</button>)}
              <span className="sp" />
              <button type="button" className="ghost" onClick={() => setVGrupo(null)}>{t('comun.cancelar')}</button>
              <button type="submit" className="primary" disabled={!vGrupo.nombre.trim()}>{t('comun.guardar')}</button>
            </div>
          </form>
        </Ventana>
      )}

      {vProd && (
        <Ventana titulo={vProd.id ? t('menu.productoEditar') : t('menu.productoNuevo')} onCerrar={() => setVProd(null)}>
          <form className="mn-form" onSubmit={guardarProducto}>
            {prodEditando && <p className="mn-itemnum">{t('menu.itemNum', { n: numeroDe(prodEditando) })}</p>}
            <label className="adm-campo"><span>{t('menu.nombre')}</span>
              <input autoFocus value={vProd.nombre} maxLength={120} onChange={e => setVProd({ ...vProd, nombre: e.target.value })} placeholder={t('menu.nombreProducto')} />
            </label>
            <div className="mn-dos">
              <label className="adm-campo"><span>{t('menu.precioMoneda', { moneda })}</span>
                <input type="text" inputMode="decimal" autoComplete="off" value={vProd.precio}
                  onChange={e => setVProd({ ...vProd, precio: limpiarMonto(e.target.value) })}
                  onBlur={() => setVProd(x => ({ ...x, precio: normalizarMonto(x.precio) }))} onFocus={e => e.target.select()} />
              </label>
              <label className="adm-campo"><span>{t('menu.grupoLabel')}</span>
                <select value={vProd.seccionId} onChange={e => setVProd({ ...vProd, seccionId: e.target.value, areas: areasPorDefecto(prodEditando, e.target.value) })}>
                  {secciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </label>
            </div>
            <label className="adm-campo"><span>{t('menu.opcionesTitle')}</span>
              <input className="adm-opciones" value={vProd.opciones} maxLength={400} onChange={e => setVProd({ ...vProd, opciones: e.target.value })} placeholder={t('menu.opcionesPlace')} />
            </label>
            {prodEditando && listasDeProd(prodEditando).length > 0 && (
              <p className="mn-itemnum">{t('indic.asignadas')}: {listasDeProd(prodEditando).map(l => l.nombre).join(', ')}</p>
            )}
            <details className="mn-avanzado">
              <summary>{t('menu.avanzado')}</summary>
              {checkboxesAreas(vProd.areas, a => setVProd(x => ({ ...x, areas: a })))}
            </details>

            {prodEditando && (
              <div className="mn-extra">
                <div className="adm-prod-img">
                  <Miniatura producto={prodEditando} />
                  {subiendoId === prodEditando.id ? (
                    <span className="adm-spinner" role="status"><span className="adm-spinner-aro" aria-hidden="true" />{tOr('menu.procesandoFoto', 'Procesando foto…')}</span>
                  ) : (
                    <>
                      <label className="adm-btn-foto">
                        <input type="file" accept="image/*" onChange={e => subirFoto(prodEditando, e)} />
                        {prodEditando.imagen_path || prodEditando.imagen_dataurl ? tOr('menu.cambiarFoto', 'Cambiar foto') : tOr('menu.subirFoto', 'Subir foto')}
                      </label>
                      {urlImagenProducto(prodEditando) && <button type="button" className="danger" onClick={() => quitarFoto(prodEditando)}>{tOr('menu.quitarFoto', 'Quitar foto')}</button>}
                    </>
                  )}
                </div>
                {avisoImg && avisoImg.id === prodEditando.id && <div className="adm-img-aviso">{avisoImg.msg}</div>}
                <div className="mn-estado">
                  <button type="button" className={prodEditando.activo ? 'warning' : 'success'} onClick={() => d({ t: 'producto~', id: prodEditando.id, cambios: { activo: !prodEditando.activo } })}>
                    {prodEditando.activo ? t('menu.desactivar') : t('menu.activar')}
                  </button>
                  {agotados[prodEditando.id] ? (
                    <button type="button" className="success" title={agotados[prodEditando.id]?.motivo || undefined} onClick={() => marcarAgotado([prodEditando.id], null)}>{t('agotado.disponible')}</button>
                  ) : (
                    <>
                      <input className="adm-motivo" maxLength={60} value={motivoTmp} onChange={e => setMotivoTmp(e.target.value)} placeholder={t('agotado.motivoPlace')} aria-label={t('agotado.motivoPlace')} />
                      <button type="button" className="danger" onClick={() => { marcarAgotado([prodEditando.id], { motivo: motivoTmp }); setMotivoTmp('') }}>{t('agotado.hoy')}</button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="mn-pie">
              {prodEditando && (confProd ? (
                <>
                  <span className="imp-dato">{t('menu.confirmarEliminar', { nombre: prodEditando.nombre })}</span>
                  <button type="button" className="danger solid" onClick={() => { d({ t: 'producto-', id: prodEditando.id }); d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, prodEditando.id, null) } }); setConfProd(false); setVProd(null) }}>{t('comun.confirmar')}</button>
                  <button type="button" className="ghost" onClick={() => setConfProd(false)}>{t('comun.cancelar')}</button>
                </>
              ) : <button type="button" className="danger" onClick={() => setConfProd(true)}>{t('comun.eliminar')}</button>)}
              <span className="sp" />
              <button type="button" className="ghost" onClick={() => setVProd(null)}>{t('comun.cancelar')}</button>
              <button type="submit" className="primary" disabled={!vProd.nombre.trim() || vProd.precio === ''}>{t('comun.guardar')}</button>
            </div>
          </form>
        </Ventana>
      )}
    </div>
  )
}
