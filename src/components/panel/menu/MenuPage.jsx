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
import { margenDe, utilidadDe, simularMargen, bandaMargen } from './margen.js'

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
// Tipos que se listan por separado en la pantalla de la carta.
const TIPOS = ['grupos', 'productos', 'indicaciones']

// Opciones editadas como píldoras (✕ quita, ＋ o Enter agrega) en lugar del textarea de comas.
function EditorOpciones({ opciones, pendiente, setPendiente, onAgregar, onQuitar, place, ariaAgregar, ariaQuitar }) {
  return (
    <>
      {opciones.length > 0 && (
        <span className="mn-pills">
          {opciones.map(o => (
            <span key={o} className="mn-pill">{o}
              <button type="button" className="mn-pill-x" aria-label={`${ariaQuitar}: ${o}`} onClick={() => onQuitar(o)}>✕</button>
            </span>
          ))}
        </span>
      )}
      <span className="mn-pill-add">
        <input type="text" value={pendiente} maxLength={40} placeholder={place}
          onChange={e => setPendiente(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAgregar() } }} />
        <button type="button" className="mn-circ" aria-label={ariaAgregar} onClick={onAgregar}>＋</button>
      </span>
    </>
  )
}

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
  const [tipo, setTipo] = useState('productos')   // qué se lista: 'grupos' | 'productos' | 'indicaciones'
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
  const [datoCol, setDatoCol] = useState('precio')   // toggle de columna extra: precio | costo | margen
  const [margenTmp, setMargenTmp] = useState('')
  const [costoPctTmp, setCostoPctTmp] = useState('')       // «¿qué % del precio será el costo?»
  const [costoReemplazar, setCostoReemplazar] = useState(false)
  const [vMasiva, setVMasiva] = useState(null)       // vista previa masiva: { tipo:'margen'|'receta', ids, margenPct?, total, sin_costo?, muestra:[…] }
  const [masivaCarg, setMasivaCarg] = useState(null) // 'margen' | 'receta' | 'aplicar' | null
  const [aviso, setAviso] = useState(null)           // mensaje en pantalla (nunca alert/confirm nativo)
  const [optProdTmp, setOptProdTmp] = useState('')   // texto pendiente de la píldora «opción suelta» del producto
  const [optIndTmp, setOptIndTmp] = useState('')     // texto pendiente de la píldora «opción» de una lista de indicaciones
  useEffect(() => {
    if (!aviso) return
    const id = setTimeout(() => setAviso(null), 9000)
    return () => clearTimeout(id)
  }, [aviso])

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
  const alternar = id => setAbiertas(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Nº de ítem: lo asigna el servidor (consecutivo por negocio, no se reutiliza). En demo antiguo sin número: posición.
  const numeroDe = p => p.numero ?? (s.productos.indexOf(p) + 1)

  // ---------- búsqueda y orden ----------
  // Busca en TODO lo que hay aquí: grupos, productos, listas de indicaciones y el texto de sus opciones.
  const q = norm(busqueda).trim().replace(/^#/, '').replace(',', '.')
  const hayBusqueda = Boolean(q)
  const contiene = x => q !== '' && norm(x).includes(q)
  const coincideInd = l => contiene(l.nombre) || (l.opciones || []).some(o => contiene(o))
  // Una indicación «habla» del producto: si el término está en una lista asignada, el producto también coincide.
  const coincide = p => !q
    || contiene(p.nombre)
    || String(numeroDe(p)).startsWith(q)
    || Number(p.precio).toFixed(2).includes(q)
    || (p.opciones || []).some(o => contiene(o))
    || listasDeProd(p).some(coincideInd)
  const coincideGrupo = sec => contiene(sec?.nombre) || s.productos.some(p => p.seccionId === sec?.id && coincide(p))
  const prodsDe = secId => {
    const sec = secciones.find(x => x.id === secId)
    const ok = sec && coincideGrupo(sec)
    return s.productos
      .filter(p => p.seccionId === secId && (ok || coincide(p)))
      .sort((a, b) => {
        const k = orden.k
        const va = k === 'nombre' ? norm(a.nombre) : k === 'precio' ? Number(a.precio) : numeroDe(a)
        const vb = k === 'nombre' ? norm(b.nombre) : k === 'precio' ? Number(b.precio) : numeroDe(b)
        return (va > vb ? 1 : va < vb ? -1 : 0) * orden.dir
      })
  }
  const prodsBuscados = () => s.productos.filter(coincide)
  const ordenarPor = k => setOrden(o => (o.k === k ? { k, dir: -o.dir } : { k, dir: 1 }))
  const flecha = k => (orden.k === k ? (orden.dir === 1 ? ' ▲' : ' ▼') : '')

  // ---------- grupos ----------
  // El grupo de impresión de cada sección vive en Configuración → Impresión; acá solo se edita la carta.
  const abrirNuevoGrupo = () => setVGrupo({ id: null, nombre: '' })
  const abrirEditarGrupo = sec => { setConfSeccion(false); setVGrupo({ id: sec.id, nombre: sec.nombre }) }
  const guardarGrupo = e => {
    e.preventDefault()
    const nombre = vGrupo.nombre.trim()
    if (!nombre) return
    if (vGrupo.id) {
      d({ t: 'seccion~', id: vGrupo.id, cambios: { nombre } })
    } else {
      const id = nuevoId()
      d({ t: 'seccion+', seccion: { id, nombre } })
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
  const abrirNuevaInd = () => { setConfInd(false); setOptIndTmp(''); setVInd({ ...nuevaLista(), id: null, opciones: '' }) }
  const abrirEditarInd = l => { setConfInd(false); setOptIndTmp(''); setVInd({ ...l, opciones: (l.opciones || []).join(', '), max: l.max || 0, min: l.min || 0, detalle: l.detalle || {} }) }
  const guardarInd = e => {
    e.preventDefault()
    const nombre = vInd.nombre.trim()
    // Se guarda también la opción escrita y aún no confirmada con ＋ (no se pierde nada).
    const opciones = parsearOpcionesLista([vInd.opciones, optIndTmp].filter(Boolean).join(', '))
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
  // Opciones como píldoras (＋ agrega, ✕ quita): sustituye al textarea de comas, que era lo mismo mal duplicado.
  const agregarOpcionInd = () => {
    const n = optIndTmp.trim().slice(0, 40)
    if (!n) return
    setVInd(v => ({ ...v, opciones: parsearOpcionesLista([v.opciones, n].join(', ')).join(', ') }))
    setOptIndTmp('')
  }
  const quitarOpcionInd = o => setVInd(v => ({ ...v, opciones: parsearOpcionesLista(v.opciones).filter(x => x !== o).join(', ') }))

  // ---------- productos ----------
  const parsearOpciones = txt => [...new Set(String(txt || '').split(/[,;\n]/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
  // Opciones sueltas del producto (se guardan en producto.opciones, la lista legada que OrderPanel sigue usando).
  const agregarOpcionProd = () => {
    const n = optProdTmp.trim().slice(0, 40)
    if (!n) return
    setVProd(v => ({ ...v, opciones: parsearOpciones([v.opciones, n].join(', ')).join(', ') }))
    setOptProdTmp('')
  }
  const quitarOpcionProd = o => setVProd(v => ({ ...v, opciones: parsearOpciones(v.opciones).filter(x => x !== o).join(', ') }))
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
    setConfProd(false); setAvisoImg(null); setMotivoTmp(''); setOptProdTmp('')
    setVProd({ id: null, seccionId: sid, nombre: '', precio: '', opciones: '', areas: areasPorDefecto(null, sid), costo: '', proveedorId: null })
  }
  const abrirEditarProd = p => {
    setConfProd(false); setAvisoImg(null); setMotivoTmp(''); setOptProdTmp('')
    const c0 = costoDe(p.id)
    setVProd({
      id: p.id, seccionId: p.seccionId, nombre: p.nombre, precio: String(p.precio), opciones: (p.opciones || []).join(', '), areas: areasPorDefecto(p),
      costo: c0?.costo == null || !Number.isFinite(Number(c0.costo)) ? '' : String(c0.costo), proveedorId: c0?.proveedorId ?? null,
    })
  }
  const guardarProducto = e => {
    e.preventDefault()
    const nombre = vProd.nombre.trim()
    const precio = numMonto(vProd.precio)
    if (!nombre || !Number.isFinite(precio) || precio < 0 || !vProd.seccionId) return
    const datos = { nombre, precio, seccionId: vProd.seccionId, areas: vProd.areas, opciones: parsearOpciones(vProd.opciones) }
    // Costo y proveedor (solo admin): se despacha «costo~» únicamente si alguno cambió respecto al store.
    const costoNuevo = vProd.costo === '' ? null : nCosto(vProd.costo)
    const provNuevo = vProd.proveedorId || null
    if (vProd.id) {
      d({ t: 'producto~', id: vProd.id, cambios: datos })
      const c0 = costoDe(vProd.id)
      if (veCostos && (nCosto(c0?.costo) !== costoNuevo || (c0?.proveedorId || null) !== provNuevo)) {
        d({ t: 'costo~', productoId: vProd.id, costo: costoNuevo ?? 0, proveedorId: provNuevo })
      }
    } else {
      // Ítem nuevo con costo/proveedor: se fija un id de cliente para poder despacharle su «costo~».
      const nid = veCostos && (costoNuevo != null || provNuevo) ? nuevoId() : null
      if (nid) {
        d({ t: 'producto+', producto: { id: nid, ...datos } })
        d({ t: 'costo~', productoId: nid, costo: costoNuevo ?? 0, proveedorId: provNuevo })
      } else {
        d({ t: 'producto+', producto: datos })
      }
      setAbiertas(a => new Set([...a, vProd.seccionId]))
    }
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

  // ---------- costo, proveedor, margen y CSV (solo rol admin) ----------
  const veCostos = rol === 'admin'
  const conDato = veCostos && datoCol !== 'precio'
  const costoMap = new Map((s.costos || []).map(c => [c.productoId, c]))
  const provMap = new Map((s.proveedores || []).map(x => [x.id, x]))
  const costoDe = id => costoMap.get(id) || null
  const nombreProv = id => (id ? provMap.get(id)?.nombre || '' : '')
  const nCosto = v => { const x = (v == null || v === '') ? null : Number(v); return x == null || !Number.isFinite(x) ? null : redondear(x) }
  // Select de proveedores activos; si el guardado está inactivo se conserva para no perderlo al editar.
  const provOpciones = idSel => {
    const activos = (s.proveedores || []).filter(x => x.activo)
    if (idSel && !activos.some(x => x.id === idSel) && provMap.has(idSel)) return [...activos, provMap.get(idSel)]
    return activos
  }

  const alternarDatoCol = () => setDatoCol(x => (x === 'precio' ? 'costo' : x === 'costo' ? 'margen' : 'precio'))
  const datoEtiqueta = datoCol === 'precio' ? tOr('menu.colDatoPrecio', 'Precio')
    : datoCol === 'costo' ? tOr('menu.colDatoCosto', 'Costo')
      : tOr('menu.colDatoMargen', 'Margen %')
  const celdaDato = p => {
    const c = costoDe(p.id)
    if (datoCol === 'costo') {
      return c?.costo == null || !Number.isFinite(Number(c.costo))
        ? <span className="mn-dato sin">—</span>
        : <span className="mn-dato">{money(c.costo)}</span>
    }
    const m = margenDe(p.precio, c?.costo)
    return <span className={'mn-dato mg-' + bandaMargen(m)}>{m == null ? '—' : `${m.toFixed(0)} %`}</span>
  }

  // Alcance de las herramientas masivas: la selección si hay algo marcado; si no, toda la carta.
  const alcanceProductos = () => (sel.size ? s.productos.filter(p => sel.has(p.id)) : s.productos)

  // Costo en masa = % del precio. Sin selección: toda la carta. Por defecto solo toca platos sin costo.
  const aplicarCostoPct = () => {
    const n = Number(costoPctTmp)
    if (!Number.isFinite(n) || n < 1 || n > 100) { setAviso({ tono: 'warn', msg: tOr('menu.costoPctRango', 'Escribe un porcentaje entre 1 y 100 (por ejemplo 40 para que el costo sea el 40 % del precio).') }); return }
    const ids = sel.size ? idsSel() : []
    const alcance = alcanceProductos().filter(p => Number(p.precio) > 0)
    const previos = new Map((s.costos || []).map(x => [x.productoId, x.costo]))
    const afectados = alcance.filter(p => costoReemplazar || !(previos.get(p.id) > 0)).length
    if (!afectados) { setAviso({ tono: 'warn', msg: tOr('menu.costoPctNada', 'Ningún producto cambia: todos ya tienen costo. Marca «Reemplazar también los que ya tienen costo» si quieres pisarlos.') }); return }
    d({ t: 'costo-pct', pct: n, productoIds: ids, reemplazar: costoReemplazar })
    setCostoPctTmp('')
    setAviso({ tono: 'ok', msg: tOr('menu.costoPctAplicado', `Costo asignado al ${n} % del precio en ${afectados} producto(s).`, { n, total: afectados }) })
  }

  const simularMargenMasiva = async () => {
    const n = Number(margenTmp)
    if (!Number.isFinite(n) || n < 1 || n > 99) { setAviso({ tono: 'warn', msg: tOr('menu.margenRango', 'Escribe un margen entre 1 y 99 % antes de simular.') }); return }
    const prods = alcanceProductos()
    const ids = prods.map(p => p.id)
    setAviso(null); setMasivaCarg('margen')
    try {
      if (modo === 'supabase') {
        const { rpc } = await import('../../../services/supabaseClient.js')
        const r = await rpc('costos_margen_aplicar', { p_producto_ids: ids, p_margen_pct: n, p_aplicar: false }) || {}
        setVMasiva({ tipo: 'margen', margenPct: n, ids, total: r.afectados ?? (r.muestra?.length ?? 0), sin_costo: r.sin_costo ?? 0, muestra: r.muestra || [] })
      } else {
        const r = simularMargen(prods, s.costos || [], n)
        setVMasiva({ tipo: 'margen', margenPct: n, ids, total: r.total, sin_costo: r.sin_costo, muestra: r.muestra })
      }
    } catch (err) {
      setAviso({ tono: 'danger', msg: err?.message || tOr('menu.errorSimular', 'No se pudo simular el margen.') })
    } finally { setMasivaCarg(null) }
  }
  const aplicarMargenSimulado = async () => {
    if (!vMasiva?.ids?.length) return
    const { ids, margenPct, total } = vMasiva
    setMasivaCarg('aplicar')
    try {
      if (modo === 'supabase') {
        const { rpc } = await import('../../../services/supabaseClient.js')
        await rpc('costos_margen_aplicar', { p_producto_ids: ids, p_margen_pct: margenPct, p_aplicar: true })
      }
      d({ t: 'margen-aplicar', productoIds: ids, margenPct })
      setVMasiva(null); setMargenTmp('')
      setAviso({ tono: 'ok', msg: tOr('menu.margenAplicado', `Precios recalculados al ${margenPct} % de margen (${total} productos).`) })
    } catch (err) {
      setAviso({ tono: 'danger', msg: err?.message || tOr('menu.errorAplicarMargen', 'No se pudieron aplicar los precios.') })
    } finally { setMasivaCarg(null) }
  }

  const simularReceta = async () => {
    if (modo !== 'supabase') return
    const ids = alcanceProductos().map(p => p.id)
    setAviso(null); setMasivaCarg('receta')
    try {
      const { rpc } = await import('../../../services/supabaseClient.js')
      const r = await rpc('costos_desde_receta', { p_producto_ids: ids, p_aplicar: false }) || {}
      const filas = r.filas || []
      if (!filas.length || (r.total ?? filas.length) === 0) {
        setAviso({ tono: 'warn', msg: tOr('menu.recetaVacia', 'No hay insumos ni recetas cargados: regístralos en Inventario para obtener el costo teórico.') })
        return
      }
      setVMasiva({ tipo: 'receta', ids: filas.map(f => f.producto_id), total: r.total ?? filas.length, sin_costo: 0, muestra: filas })
    } catch (err) {
      setAviso({ tono: 'danger', msg: err?.message || tOr('menu.errorSimularReceta', 'No se pudo simular el costo desde la receta.') })
    } finally { setMasivaCarg(null) }
  }
  const aplicarRecetaSimulada = async () => {
    if (!vMasiva?.ids?.length) return
    const { ids, total } = vMasiva
    setMasivaCarg('aplicar')
    try {
      const { rpc } = await import('../../../services/supabaseClient.js')
      await rpc('costos_desde_receta', { p_producto_ids: ids, p_aplicar: true })
      d({ t: 'receta-costo', productoIds: ids })
      setVMasiva(null)
      setAviso({ tono: 'ok', msg: tOr('menu.recetaAplicado', `Costo teórico aplicado a ${total} productos.`) })
    } catch (err) {
      setAviso({ tono: 'danger', msg: err?.message || tOr('menu.errorAplicarReceta', 'No se pudo aplicar el costo desde la receta.') })
    } finally { setMasivaCarg(null) }
  }

  const exportarCartaCSV = () => {
    const nomSec = id => secciones.find(x => x.id === id)?.nombre || ''
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const f2 = v => (v == null || !Number.isFinite(Number(v)) ? '' : Number(v).toFixed(2))
    const cab = [tOr('menu.csvNum', 'Nº'), tOr('menu.csvNombre', 'Nombre'), tOr('menu.csvGrupo', 'Grupo'), tOr('menu.csvPrecio', 'Precio')]
    if (veCostos) cab.push(tOr('menu.csvCosto', 'Costo'), tOr('menu.csvUtilidad', 'Utilidad'), tOr('menu.csvMargen', 'Margen %'), tOr('menu.csvProveedor', 'Proveedor'))
    const filas = [...s.productos].sort((a, b) => numeroDe(a) - numeroDe(b)).map(p => {
      const f = [`#${numeroDe(p)}`, p.nombre, nomSec(p.seccionId), f2(p.precio)]
      if (!veCostos) return f
      const c = costoDe(p.id)
      const u = utilidadDe(p.precio, c?.costo)
      const m = margenDe(p.precio, c?.costo)
      return [...f, f2(c?.costo), u == null ? '' : f2(u), m == null ? '' : m.toFixed(2), nombreProv(c?.proveedorId)]
    })
    try {
      const csv = '\ufeff' + [cab, ...filas].map(f => f.map(esc).join(',')).join('\r\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url; a.download = `carta-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setAviso({ tono: 'danger', msg: err?.message || tOr('menu.errorCSV', 'No se pudo generar el CSV.') })
    }
  }

  // Controles de costo en la barra masiva (se reutilizan con o sin selección).
  const controlesCosto = veCostos && (
    <span className="adm-masivo-grupo">
      <input className="adm-num" type="text" inputMode="numeric" autoComplete="off" value={costoPctTmp}
        onChange={e => setCostoPctTmp(e.target.value.replace(/\D/g, '').slice(0, 3))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aplicarCostoPct() } }}
        onFocus={e => e.target.select()} placeholder={tOr('menu.costoPctPlace', 'Costo % del precio')}
        title={tOr('menu.costoPctAyuda', '¿Qué porcentaje del precio será el costo? Ej.: 40 para el 40 %')}
        aria-label={tOr('menu.costoPctPlace', 'Costo % del precio')} />
      <button type="button" className="info" onClick={aplicarCostoPct}>{tOr('menu.costoPctBtn', 'Asignar costo')}</button>
      <label className="mn-costo-reemp"><input type="checkbox" checked={costoReemplazar} onChange={e => setCostoReemplazar(e.target.checked)} /> {tOr('menu.costoPctReemplazar', 'Reemplazar también los que ya tienen costo')}</label>
      <input className="adm-num" type="text" inputMode="numeric" autoComplete="off" value={margenTmp}
        onChange={e => setMargenTmp(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onFocus={e => e.target.select()} placeholder={tOr('menu.masivoMargen', 'Margen %')} aria-label={tOr('menu.masivoMargen', 'Margen %')} />
      <button type="button" className="info" onClick={simularMargenMasiva} disabled={masivaCarg !== null}>{masivaCarg === 'margen' ? tOr('menu.simulando', 'Simulando…') : tOr('menu.simular', 'Simular')}</button>
      {modo === 'supabase' && (
        <button type="button" className="info" onClick={simularReceta} disabled={masivaCarg !== null} title={tOr('menu.recetaAyuda', 'Toma el costo teórico calculado desde insumos y recetas de Inventario.')}>
          {masivaCarg === 'receta' ? tOr('menu.simulando', 'Simulando…') : tOr('menu.recetaBtn', 'Costo desde receta')}
        </button>
      )}
      <button type="button" className="ghost" onClick={exportarCartaCSV}>{tOr('menu.csvBtn', 'Exportar CSV')}</button>
    </span>
  )

  const vacio = secciones.length === 0
  // ---------- modos de lista (Grupos · Productos · Indicaciones) ----------
  const listasVisibles = listas.filter(l => !hayBusqueda || coincideInd(l) || (l.secciones || []).some(id => contiene(secciones.find(x => x.id === id)?.nombre)))
  const gruposVisibles = secciones.filter(sec => !hayBusqueda || prodsDe(sec.id).length > 0)
  // En modo Grupos el buscador filtra grupos: por su nombre o porque algo de dentro coincide.
  const gruposLista = tipo === 'grupos' ? secciones.filter(sec => !hayBusqueda || coincideGrupo(sec)) : gruposVisibles
  const nombreTipo = k => (k === 'grupos' ? tOr('items.tabGrupos', 'Grupos') : k === 'indicaciones' ? tOr('items.tabIndicaciones', 'Indicaciones') : tOr('items.tabProductos', 'Productos'))
  const etiquetaNuevo = { grupos: t('menu.grupoMas'), productos: t('menu.productoMas'), indicaciones: tOr('items.nuevaInd', 'Indicación') }
  const conteoTipo = { grupos: secciones.length, productos: s.productos.length, indicaciones: listas.length }
  const crearSegunTipo = () => (tipo === 'grupos' ? abrirNuevoGrupo() : tipo === 'indicaciones' ? abrirNuevaInd() : abrirNuevoProd())
  const resultadosModo = tipo === 'grupos' ? gruposLista.length : tipo === 'indicaciones' ? listasVisibles.length : gruposVisibles.length
  // El término vive en otro tipo: aviso discreto con botón para saltar allí.
  const otrosTipos = hayBusqueda && resultadosModo === 0
    ? TIPOS.filter(k => k !== tipo && (k === 'grupos' ? secciones.some(coincideGrupo) : k === 'indicaciones' ? listas.some(coincideInd) : prodsBuscados().length > 0))
    : []
  // Opciones ya confirmadas en cada ventana (la que se está escribiendo se agrega con ＋ o Enter).
  const opcInd = vInd ? parsearOpcionesLista(vInd.opciones) : []
  const opcProd = vProd ? parsearOpciones(vProd.opciones) : []

  return (
    <div className="adm-panel">
      <div className="adm-cab">
        <h2>{tOr('items.titulo', 'Ítems')}</h2>
        <div className="adm-fila mn-acciones">
          {vacio
            ? <button type="button" className="success" onClick={abrirNuevoGrupo}>+ {t('menu.grupoMas')}</button>
            : <button type="button" className="success" onClick={crearSegunTipo}>+ {etiquetaNuevo[tipo]}</button>}
        </div>
      </div>

      {vacio && <div className="adm-aviso mn-vacio">{t('menu.menuVacio')}</div>}

      {!vacio && (
        <div className="mn-tabs" role="group" aria-label={tOr('items.tabsAria', 'Qué lista quieres ver')}>
          {TIPOS.map(k => (
            <button key={k} type="button" className={'tab' + (tipo === k ? ' on' : '')} aria-pressed={tipo === k} onClick={() => setTipo(k)}>
              {nombreTipo(k)}<span className="mn-tab-n" aria-hidden="true">{conteoTipo[k]}</span>
            </button>
          ))}
        </div>
      )}

      {!vacio && (
        <div className="adm-fila menu-barra mn-barra">
          <input className="mn-buscar" type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder={tOr('items.buscarPlace', 'Buscar en grupos, productos e indicaciones…')}
            aria-label={tOr('items.buscarPlace', 'Buscar en grupos, productos e indicaciones…')} />
          {tipo === 'productos' && (
            <>
              <button type="button" className="ghost" onClick={() => setAbiertas(new Set(secciones.map(x => x.id)))}>▾ {t('menu.mostrarTodo')}</button>
              <button type="button" className="ghost" onClick={() => setAbiertas(new Set())}>▸ {t('menu.ocultarTodo')}</button>
            </>
          )}
          {Object.keys(agotados).length > 0 && <span className="adm-chip adm-chip-agotado" title={t('agotado.contadorTitle')}>🚫 {t('agotado.contador', { n: Object.keys(agotados).length })}</span>}
        </div>
      )}

      {otrosTipos.length > 0 && (
        <div className="mn-sugerencia" role="status">
          <span>{tOr('items.estaEn', `«${busqueda.trim()}» no está en ${nombreTipo(tipo)}, pero sí en ${otrosTipos.map(nombreTipo).join(' · ')}.`, { q: busqueda.trim(), actual: nombreTipo(tipo), tipo: otrosTipos.map(nombreTipo).join(' · ') })}</span>
          {otrosTipos.map(k => (
            <button key={k} type="button" className="ghost" onClick={() => setTipo(k)}>{tOr('items.irTipo', `Ver ${nombreTipo(k)}`, { tipo: nombreTipo(k) })}</button>
          ))}
        </div>
      )}

      {aviso && (
        <div className={'mn-mensaje ' + (aviso.tono || 'warn')} role="status">
          <span>{aviso.msg}</span>
          <button type="button" className="ghost mn-mensaje-x" aria-label={tOr('menu.cerrarAviso', 'Cerrar aviso')} onClick={() => setAviso(null)}>✕</button>
        </div>
      )}

      {veCostos && !sel.size && !vacio && tipo === 'productos' && (
        <div className="adm-masivo mn-costos-bar">
          <span className="adm-chip">{tOr('menu.costosAlcance', 'Sin selección: las herramientas de costo aplican a toda la carta (solo productos con costo).')}</span>
          {controlesCosto}
        </div>
      )}

      {sel.size > 0 && tipo === 'productos' && (
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
          {controlesCosto}
          <span className="sp" />
          <button type="button" className="danger" onClick={() => setSel(new Set())}>✕ {t('menu.masivoLimpiar')}</button>
        </div>
      )}

      {tipo === 'indicaciones' && listas.length === 0 && (
        <div className="adm-aviso mn-vacio">{tOr('items.indVacias', `Aún no hay listas de indicaciones. Crea la primera con «+ ${etiquetaNuevo.indicaciones}».`, { n: etiquetaNuevo.indicaciones })}</div>
      )}

      {tipo === 'indicaciones' && listasVisibles.map(l => {
        const secs = (l.secciones || []).map(id => secciones.find(x => x.id === id)?.nombre).filter(Boolean)
        const nProds = (l.productos || []).length
        return (
          <section key={l.id} className="adm-card mn-grupo mn-tarjeta-ind">
            <header className="mn-grupo-cab">
              <h3 className="mn-ind-nombre">{l.nombre}</h3>
              <span className="adm-chip">{tOr('items.indOpcionesN', `${(l.opciones || []).length} opción(es)`, { n: (l.opciones || []).length })}</span>
              <span className="adm-chip">{l.obligatoria ? t('indic.obligatoria') : t('indic.opcional')}</span>
              <span className="adm-chip">{l.max ? t('indic.hasta', { n: l.max }) : t('indic.sinLimite')}</span>
              <span className="cab-acciones">
                <button type="button" className="info" onClick={() => abrirEditarInd(l)}>{t('comun.editar')}</button>
              </span>
            </header>
            <div className="mn-pills">
              {(l.opciones || []).map(o => <span key={o} className="mn-pill mn-pill-soft">{o}</span>)}
            </div>
            <div className="mn-ind-uso">
              {secs.map(x => <span key={x} className="adm-chip">{x}</span>)}
              {nProds > 0 && <span className="adm-chip">{t('indic.aplicaProductos', { n: nProds })}</span>}
              {secs.length === 0 && nProds === 0 && <span className="mn-ind-sin">{tOr('items.indSinUso', 'Todavía no aplica a ningún grupo ni producto.')}</span>}
            </div>
          </section>
        )
      })}

      {hayBusqueda && resultadosModo === 0 && otrosTipos.length === 0 && <div className="adm-aviso">{t('menu.sinResultados')}</div>}

      {tipo !== 'indicaciones' && gruposLista.map(sec => {
        const todos = s.productos.filter(p => p.seccionId === sec.id)
        const prods = prodsDe(sec.id)
        const enGrupos = tipo === 'grupos'
        const abierta = enGrupos || hayBusqueda || abiertas.has(sec.id)
        const i = secciones.indexOf(sec)
        return (
          <section key={sec.id} className="adm-card mn-grupo">
            <header className="mn-grupo-cab">
              <button type="button" className="mn-grupo-btn" aria-expanded={enGrupos ? undefined : abierta} onClick={() => { if (!enGrupos) alternar(sec.id) }}>
                {!enGrupos && <span className="menu-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>}
                <h3>{sec.nombre}</h3>
                <span className="adm-chip">{t('menu.nProductos', { n: todos.length })}</span>
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

            {abierta && (enGrupos ? (
              <p className="mn-grupo-hint">{tOr('items.grupoHint', 'Renombra con Editar, ordena con ▲▼ y agrega productos con ＋ Producto.')}</p>
            ) : (
              <>
                {prods.length === 0 ? <div className="adm-vacio">{hayBusqueda ? t('menu.sinResultados') : t('menu.sinProductos')}</div> : (
                  <ul className="mn-lista">
                    <li className={'mn-fila mn-fila-cab' + (conDato ? ' con-dato' : '')}>
                      <input type="checkbox" className="adm-sel" aria-label={t('menu.todoSeccion')}
                        checked={prods.length > 0 && prods.every(p => sel.has(p.id))} onChange={e => selSeccion(prods, e.target.checked)} />
                      <button type="button" className="mn-orden" onClick={() => ordenarPor('numero')}>{t('menu.colNum')}{flecha('numero')}</button>
                      <button type="button" className="mn-orden mn-orden-nombre" onClick={() => ordenarPor('nombre')}>{t('menu.colNombre')}{flecha('nombre')}</button>
                      <button type="button" className="mn-orden mn-orden-precio" onClick={() => ordenarPor('precio')}>{t('menu.colPrecio')}{flecha('precio')}</button>
                      {veCostos && (
                        <button type="button" className={'mn-orden mn-dato-toggle' + (conDato ? ' on' : '')} onClick={alternarDatoCol}
                          title={tOr('menu.colDatoAyuda', 'Alterna el dato extra de la lista: Precio, Costo o Margen %.')}>
                          {conDato ? datoEtiqueta : `${tOr('menu.colDatoIntro', 'Dato')}: ${datoEtiqueta}`}
                        </button>
                      )}
                      {(!veCostos || conDato) && <span className="mn-cab-esp" />}
                    </li>
                    {prods.map(p => (
                      <li key={p.id} className={'mn-fila' + (p.activo ? '' : ' inactivo') + (agotados[p.id] ? ' agotado' : '') + (sel.has(p.id) ? ' sel' : '') + (conDato ? ' con-dato' : '')}>
                        <input type="checkbox" className="adm-sel" checked={sel.has(p.id)} onChange={() => alternarSel(p.id)} aria-label={t('menu.seleccionar')} />
                        <span className="mn-num">#{numeroDe(p)}</span>
                        <span className="mn-nombre">{p.nombre}
                          {!p.activo && <small> {t('menu.oculto')}</small>}
                          {agotados[p.id] && <small> {t('agotado.badge')}</small>}
                          {((p.opciones || []).length + listasDeProd(p).length) > 0 && <small title={tOr('items.indicBadge', 'Indicaciones y opciones de este artículo')}> ✎{(p.opciones || []).length + listasDeProd(p).length}</small>}
                        </span>
                        <span className="mn-precio">{money(p.precio)}</span>
                        {conDato && celdaDato(p)}
                        <button type="button" className="info" onClick={() => abrirEditarProd(p)}>{t('comun.editar')}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ))}
          </section>
        )
      })}

      {vInd && (
        <Ventana titulo={vInd.id ? t('indic.editar') : t('indic.nueva')} onCerrar={() => setVInd(null)}>
          <form className="mn-form" onSubmit={guardarInd}>
            <label className="adm-campo"><span>{t('menu.nombre')}</span>
              <input autoFocus value={vInd.nombre} maxLength={60} onChange={e => setVInd({ ...vInd, nombre: e.target.value })} placeholder={t('indic.nombrePlace')} />
            </label>
            <div className="adm-campo"><span>{tOr('items.indOpciones', 'Opciones de la lista')}</span>
              <EditorOpciones
                opciones={opcInd} pendiente={optIndTmp} setPendiente={setOptIndTmp}
                onAgregar={agregarOpcionInd} onQuitar={quitarOpcionInd}
                place={t('indic.opcionesPlace')}
                ariaAgregar={tOr('items.agregarOpcion', 'Agregar opción')}
                ariaQuitar={tOr('items.quitarOpcion', 'Quitar opción')} />
            </div>
            <div className="mn-reglas">
              <label className="mn-check" title={tOr('items.indObligarAyuda', 'Si es obligatoria, el mesero debe elegir al menos una opción al pedir.')}>
                <input type="checkbox" checked={vInd.obligatoria} onChange={e => setVInd({ ...vInd, obligatoria: e.target.checked })} />
                <span>{t('indic.obligatoria')}</span>
              </label>
              <div className="mn-dos">
                <label className="adm-campo"><span>{t('indic.min')}</span>
                  <input type="text" inputMode="numeric" autoComplete="off" value={!vInd.min ? '' : String(vInd.min)} placeholder="1"
                    onChange={e => setVInd({ ...vInd, min: e.target.value.replace(/\D/g, '').slice(0, 2) })} onFocus={e => e.target.select()} />
                </label>
                <label className="adm-campo"><span>{t('indic.max')}</span>
                  <input type="text" inputMode="numeric" autoComplete="off" value={vInd.max === 0 ? '' : String(vInd.max)} placeholder={t('indic.sinLimite')}
                    onChange={e => setVInd({ ...vInd, max: e.target.value.replace(/\D/g, '').slice(0, 2) })} onFocus={e => e.target.select()} />
                </label>
              </div>
            </div>
            {opcInd.length > 0 && (
              <details className="mn-avanzado">
                <summary>{t('indic.detalleOpc')}</summary>
                <p className="mn-itemnum">{t('indic.detalleAyuda')}</p>
                {opcInd.map(o => (
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
              <div className="mn-chips" role="group" aria-label={t('indic.aplicaGrupos')}>
                {secciones.map(x => {
                  const on = (vInd.secciones || []).includes(x.id)
                  return (
                    <button key={x.id} type="button" className={'mn-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => alternarEn('secciones', x.id)}>
                      {on && <span aria-hidden="true">✓ </span>}{x.nombre}
                    </button>
                  )
                })}
              </div>
            </div>
            <details className="mn-avanzado">
              <summary>{t('indic.aplicaProductos', { n: (vInd.productos || []).length })}</summary>
              {secciones.map(x => {
                const ps = s.productos.filter(p => p.seccionId === x.id)
                return ps.length === 0 ? null : (
                  <div key={x.id} className="mn-ind-grupo">
                    <small>{x.nombre}</small>
                    <div className="mn-chips" role="group" aria-label={`${t('indic.aplicaProductos', { n: ps.length })} · ${x.nombre}`}>
                      {ps.map(p => {
                        const on = (vInd.productos || []).includes(p.id)
                        return (
                          <button key={p.id} type="button" className={'mn-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => alternarEn('productos', p.id)}>
                            {on && <span aria-hidden="true">✓ </span>}#{numeroDe(p)} {p.nombre}
                          </button>
                        )
                      })}
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
              <button type="submit" className="primary" disabled={!vInd.nombre.trim() || (!opcInd.length && !optIndTmp.trim())}>{t('comun.guardar')}</button>
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
            <p className="mn-nota">{tOr('menu.grupoImpAyuda', 'La impresora de cada grupo se elige en Configuración → Impresión. Ahí una sección puede mandar a varios grupos a la vez.')}</p>
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
            {/* Un solo lugar: «Indicaciones» = las listas de s.config.indicaciones arriba + las opciones sueltas del ítem abajo. */}
            <div className="mn-bloque">
              <h4 className="mn-bloque-tit">{t('indic.asignadas')}</h4>
              <div className="mn-chips">
                {prodEditando && listasDeProd(prodEditando).map(l => (
                  <span key={l.id} className="mn-pill mn-pill-soft">{l.nombre}
                    <small> · {l.obligatoria ? t('indic.obligatoria') : t('indic.opcional')}{l.max ? ` · ${t('indic.hasta', { n: l.max })}` : ''}</small>
                  </span>
                ))}
                {prodEditando && listasDeProd(prodEditando).length === 0 && (
                  <span className="mn-ind-sin">{tOr('items.indNinguna', 'Ninguna lista asignada: se asignan en la pestaña Indicaciones.')}</span>
                )}
                {!prodEditando && (
                  <span className="mn-ind-sin">{tOr('items.indAlCrear', 'Las listas se asignan al crear la indicación, en la pestaña Indicaciones.')}</span>
                )}
              </div>
              <div className="adm-campo"><span>{tOr('items.prodOpciones', 'Opciones de este producto')}</span>
                <EditorOpciones
                  opciones={opcProd} pendiente={optProdTmp} setPendiente={setOptProdTmp}
                  onAgregar={agregarOpcionProd} onQuitar={quitarOpcionProd}
                  place={tOr('items.prodOpcionesPlace', 'Ej. Sin cebolla, sin hielo, término medio')}
                  ariaAgregar={tOr('items.agregarOpcion', 'Agregar opción')}
                  ariaQuitar={tOr('items.quitarOpcion', 'Quitar opción')} />
                <small className="mn-nota">{tOr('items.prodOpcionesNota', 'Salen como botones al pedir el artículo y se imprimen en la comanda.')}</small>
              </div>
            </div>
            {/* #Imprimir en: siempre a la vista; un artículo puede salir en dos grupos a la vez. */}
            <div className="mn-bloque">
              <h4 className="mn-bloque-tit">{t('areas.label')}</h4>
              {checkboxesAreas(vProd.areas, a => setVProd(x => ({ ...x, areas: a })))}
              <small className="mn-nota">{t('areas.ayuda')}</small>
            </div>
            <details className="mn-avanzado">
              <summary>{t('menu.avanzado')}</summary>
              {veCostos && (
                <>
                  <div className="mn-dos">
                    <label className="adm-campo"><span>{tOr('menu.campoCosto', `Costo (${moneda})`, { moneda })}</span>
                      <input type="text" inputMode="decimal" autoComplete="off" value={vProd.costo}
                        onChange={e => setVProd({ ...vProd, costo: limpiarMonto(e.target.value) })}
                        onBlur={() => setVProd(x => ({ ...x, costo: normalizarMonto(x.costo) }))}
                        onFocus={e => e.target.select()} placeholder="0.00" />
                    </label>
                    <label className="adm-campo"><span>{tOr('menu.campoProveedor', 'Proveedor')}</span>
                      <select value={vProd.proveedorId || ''} onChange={e => setVProd({ ...vProd, proveedorId: e.target.value || null })}>
                        <option value="">{tOr('menu.sinProveedor', '— sin proveedor —')}</option>
                        {provOpciones(vProd.proveedorId).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                      </select>
                    </label>
                  </div>
                  {(() => {
                    const costoV = vProd.costo === '' ? null : nCosto(vProd.costo)
                    const pV = numMonto(vProd.precio)
                    const u = utilidadDe(pV, costoV)
                    const m = margenDe(pV, costoV)
                    return u == null
                      ? <p className="mn-margen-vivo sin">{tOr('menu.costoVivoSin', 'Anota el costo para ver la utilidad y el margen en vivo.')}</p>
                      : (
                        <p className="mn-margen-vivo">
                          {tOr('menu.utilidad', 'Utilidad')}: <b>{money(u)}</b>
                          {' · '}{tOr('menu.margen', 'Margen')}: <b className={'mn-mg mg-' + bandaMargen(m)}>{m == null ? '—' : `${m.toFixed(1)} %`}</b>
                        </p>
                      )
                  })()}
                </>
              )}
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

      {vMasiva && (
        <Ventana
          titulo={vMasiva.tipo === 'margen'
            ? tOr('menu.margenSimTitulo', `Simulación de margen al ${vMasiva.margenPct} %`)
            : tOr('menu.recetaSimTitulo', 'Costo teórico desde receta')}
          onCerrar={() => setVMasiva(null)}
        >
          <p className="mn-masiva-res">
            {tOr('menu.margenTocaraN', `Se tocarán ${vMasiva.total} productos.`, { n: vMasiva.total })}
            {vMasiva.sin_costo > 0 && <> · <span className="mn-mg mg-bjo">{tOr('menu.sinCostoN', `${vMasiva.sin_costo} productos quedan sin costo y se omiten.`)}</span></>}
          </p>
          <div className="mn-tabla-wrap">
            <table className="mn-tabla">
              <thead>
                <tr>
                  <th>{tOr('menu.colNombreTabla', 'Nombre')}</th>
                  <th>{tOr('menu.colCosto', 'Costo')}</th>
                  {vMasiva.tipo === 'margen' && (
                    <>
                      <th>{tOr('menu.colPrecioActual', 'Precio actual')}</th>
                      <th>{tOr('menu.colPrecioNuevo', 'Precio nuevo')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {vMasiva.muestra.map(f => (
                  <tr key={f.producto_id}>
                    <td>{f.nombre}</td>
                    <td>{money(f.costo)}</td>
                    {vMasiva.tipo === 'margen' && (
                      <>
                        <td>{money(f.antes)}</td>
                        <td><b>{money(f.despues)}</b></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {vMasiva.total > vMasiva.muestra.length && (
              <p className="mn-tabla-mas">{tOr('menu.muestraParcial', `Se muestran solo ${vMasiva.muestra.length} filas de ejemplo.`)}</p>
            )}
          </div>
          <div className="mn-pie">
            <button type="button" className="ghost" onClick={() => setVMasiva(null)}>{t('comun.cancelar')}</button>
            <span className="sp" />
            <button type="button" className="primary" disabled={!vMasiva.total || masivaCarg !== null}
              onClick={vMasiva.tipo === 'margen' ? aplicarMargenSimulado : aplicarRecetaSimulada}>
              {masivaCarg === 'aplicar'
                ? tOr('menu.aplicando', 'Aplicando…')
                : tOr('menu.aplicarN', `Aplicar a ${vMasiva.total} productos`, { n: vMasiva.total })}
            </button>
          </div>
        </Ventana>
      )}
    </div>
  )
}
