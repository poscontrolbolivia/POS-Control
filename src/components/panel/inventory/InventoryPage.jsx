import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import CabeceraPagina from '../../ui/CabeceraPagina.jsx'
import MasMenu from '../../ui/MasMenu.jsx'
import { useMoneda } from '../../../services/money.js'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import { limpiarMonto, numMonto } from '../../../services/format.js'
import { puede } from '../../../services/permissions.js'
import { equivalencia, resolverCantidad, costoDePresentacion, aplicarEntrada, MOTIVOS_MERMA, MOTIVO_ETIQUETA, round3 } from '../../../services/inventario.js'
import CantidadUnidad from './CantidadUnidad.jsx'
import MermasTab from './MermasTab.jsx'
import ProveedoresTab from './ProveedoresTab.jsx'
import CuentasTab from './CuentasTab.jsx'
import './InventoryPage.css'

const DIAS = [7, 30, 90]
const LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' }

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const presentacionesActivasDe = i => (Array.isArray(i?.presentaciones) ? i.presentaciones : []).filter(p => p && p.activo !== false && num(p.cantidad) > 0)

// En el schema (tabla insumos / insumos_movimientos / recetas) stock, stock_min y las cantidades
// son numeric(12,3): admiten 3 decimales, NO son enteros. Por eso las cantidades usan un sanitizer
// propio de 3 decimales; el costo (dinero, numeric(12,2)) reutiliza limpiarMonto (2 decimales).
const limpiarCant = txt => {
  const s = String(txt ?? '').replace(/[^0-9.,]/g, '').replace(',', '.')
  const m = s.match(/^\d*\.?\d{0,3}/)
  return m ? m[0] : ''
}
const normalizarCant = v => { const n = Number(v); return v !== '' && Number.isFinite(n) ? String(n) : '' }
// El costo por unidad base admite 4 decimales (numeric(14,4)): Bs 0,0425 por gramo.
const limpiarCosto = txt => {
  const s = String(txt ?? '').replace(/[^0-9.,]/g, '').replace(',', '.')
  const m = s.match(/^\d*\.?\d{0,4}/)
  return m ? m[0] : ''
}
const normalizarCosto = v => (v !== '' ? String(Math.round(numMonto(v) * 10000) / 10000) : '')
let kPres = 0

const CADUCA_PREGUNTA = 4000
const CADUCA_AVISO = 5000

export default function InventoryPage({ rol, sesion }) {
  const { s, d, modo } = useStore()
  const { tOr, idiom } = useIdioma()
  const { moneda: MONEDA } = useMoneda()
  const locale = LOCALE[idiom] || 'es'
  const fmtNum = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale])
  const fmt = v => fmtNum.format(num(v))
  const fmtCosto = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }), [locale])
  const fmtC = v => fmtCosto.format(num(v))
  const fmtFecha = iso => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const [pestana, setPestana] = useState('insumos')
  const [insumosSup, setInsumosSup] = useState([])
  const [productosSup, setProductosSup] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const [form, setForm] = useState(null)
  const [formErr, setFormErr] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [mov, setMov] = useState(null)
  const [movErr, setMovErr] = useState('')
  const [movEnVio, setMovEnVio] = useState(false)

  const [confirmaBorrar, setConfirmaBorrar] = useState(null)
  const [borrandoId, setBorrandoId] = useState(null)
  const timerPregunta = useRef(null)
  const timerAviso = useRef(null)

  const [buscador, setBuscador] = useState('')
  const [provFiltro, setProvFiltro] = useState('')
  // Señales para abrir el alta desde la barra de pestañas, sin dejar el botón escondido.
  const [provAlta, setProvAlta] = useState(false)
  const [cuentaAlta, setCuentaAlta] = useState(false)
  const [prodSel, setProdSel] = useState(null)
  const [lineas, setLineas] = useState([])
  const [recErr, setRecErr] = useState('')
  const [guardandoRec, setGuardandoRec] = useState(false)

  const [dias, setDias] = useState(7)
  const [movsSup, setMovsSup] = useState([])
  const [cargandoMovs, setCargandoMovs] = useState(false)
  const [errorMovs, setErrorMovs] = useState('')

  const esAdmin = rol === 'admin'
  // ver_inventario: ve la pantalla; gestionar_inventario: además escribe (el servidor lo vuelve a validar en cada RPC).
  const puedeVer = puede(rol, 'ver_inventario')
  const puedeGestionar = puede(rol, 'gestionar_inventario')
  const enBase = modo === 'supabase'
  const quien = sesion?.nombre || sesion?.usuario || ''
  const ocupado = guardando || movEnVio || guardandoRec || Boolean(borrandoId)

  // En demo el inventario vive en el store con las MISMAS formas que devuelve la base
  // (insumo con id/nombre/unidad/stock/stock_min/costo/activo, receta con insumo_id,
  //  movimiento con en/insumo_nombre/tipo/cantidad/stock_after), así la pantalla no tiene dos códigos.
  const insumos = enBase ? insumosSup : (s.insumos || [])

  useEffect(() => () => { clearTimeout(timerPregunta.current); clearTimeout(timerAviso.current) }, [])

  const avisar = txt => {
    setAviso(txt)
    clearTimeout(timerAviso.current)
    timerAviso.current = setTimeout(() => setAviso(''), CADUCA_AVISO)
  }

  const cargar = async (silenciosa = false) => {
    if (!silenciosa) setCargando(true)
    setError('')
    try {
      const datos = await rpc('inventario_listar')
      setInsumosSup(Array.isArray(datos?.insumos) ? datos.insumos : [])
      setProductosSup(Array.isArray(datos?.productos) ? datos.productos : [])
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    if (puedeVer && enBase) cargar()

  }, [puedeVer, enBase])

  const cargarMovs = async () => {
    setCargandoMovs(true)
    setErrorMovs('')
    try {
      const filas = await rpc('movimientos_listar', { p_dias: dias, p_limite: 200 })
      setMovsSup(Array.isArray(filas) ? filas : [])
    } catch (err) {
      setErrorMovs(mensajeError(err))
    } finally {
      setCargandoMovs(false)
    }
  }
  useEffect(() => {
    if (puedeVer && enBase && pestana === 'movimientos') cargarMovs()

  }, [pestana, dias, puedeVer, enBase])

  // En demo los movimientos ya salen del store (los escriben el cobro y las pestañas de Insumos).
  const movs = useMemo(() => {
    if (enBase) return movsSup
    const desde = Date.now() - dias * 86400000
    return (s.movimientos || []).filter(m => {
      const t = new Date(m?.en).getTime()
      return Number.isFinite(t) && t >= desde
    }).slice(0, 200)
  }, [enBase, movsSup, s.movimientos, dias])

  const stockBajo = i => num(i.stock) <= num(i.stock_min)
  const stockMedio = i => !stockBajo(i) && num(i.stock) < num(i.stock_min) * 1.5
  const nBajos = insumos.filter(stockBajo).length
  const insumoPorId = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos])

  // Recetas agrupadas por producto: del rpc en la base, de s.recetas (líneas sueltas) en demo.
  const recetasPorProducto = useMemo(() => {
    const m = new Map()
    if (enBase) {
      for (const p of productosSup) if (p?.id && Array.isArray(p.recetas)) m.set(p.id, p.recetas)
      return m
    }
    for (const r of s.recetas || []) {
      if (!r?.productoId || !r?.insumo_id) continue
      if (!m.has(r.productoId)) m.set(r.productoId, [])
      m.get(r.productoId).push({ insumo_id: r.insumo_id, cantidad: num(r.cantidad) })
    }
    return m
  }, [enBase, productosSup, s.recetas])

  const productosMenu = useMemo(() => {
    const mapa = new Map()
    for (const p of s.productos || []) {
      if (!p?.id) continue
      mapa.set(p.id, { id: p.id, nombre: p.nombre, precio: p.precio, seccionId: p.seccionId, activo: p.activo !== false, recetas: [] })
    }
    for (const [id, lineas] of recetasPorProducto) {
      const p = mapa.get(id)
      if (p) p.recetas = lineas
    }
    return [...mapa.values()].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), locale))
  }, [s.productos, recetasPorProducto, locale])

  const filtro = buscador.trim().toLowerCase()
  const productosFiltrados = filtro
    ? productosMenu.filter(p => String(p.nombre || '').toLowerCase().includes(filtro))
    : productosMenu
  const productoSel = productosMenu.find(p => p.id === prodSel) || null

  const analisisReceta = useMemo(() => {
    const validas = lineas.filter(l => l.insumo_id && num(l.cantidad) > 0)
    let costo = 0
    let porciones = validas.length ? Infinity : null
    const insuficientes = []
    for (const l of validas) {
      const ins = insumoPorId.get(l.insumo_id)
      if (!ins) continue
      costo += num(ins.costo) * num(l.cantidad)
      const alcanza = Math.floor(num(ins.stock) / num(l.cantidad))
      if (alcanza < porciones) porciones = alcanza
      if (alcanza < 1) insuficientes.push(ins.nombre)
    }
    return { costo, porciones: Number.isFinite(porciones) ? porciones : null, insuficientes }
  }, [lineas, insumoPorId])

  const abrirNuevo = () => {
    setError(''); setFormErr(''); setMov(null)
    setForm({ id: undefined, nombre: '', unidad: '', stock: '', stock_min: '', minSel: 'base', costo: '', activo: true, presentaciones: [], con_merma: false, rendimiento_esp: '' })
  }
  const abrirEditar = i => {
    setError(''); setFormErr(''); setMov(null); cerrarConfirmar()
    setForm({
      id: i.id,
      nombre: i.nombre || '',
      unidad: i.unidad || '',
      stock: String(i.stock ?? ''),
      stock_min: String(i.stock_min ?? ''),
      minSel: 'base',
      costo: String(i.costo ?? ''),
      activo: Boolean(i.activo),
      presentaciones: (Array.isArray(i.presentaciones) ? i.presentaciones : []).map(p => ({
        k: ++kPres, id: p.id || '', nombre: p.nombre || '', cantidad: String(p.cantidad ?? ''),
        costo: p.costo === null || p.costo === undefined ? '' : String(p.costo), activo: p.activo !== false, principal: Boolean(p.principal) })),
      con_merma: Boolean(i.con_merma),
      rendimiento_esp: i.rendimiento_esp === null || i.rendimiento_esp === undefined ? '' : String(i.rendimiento_esp),
    })
  }
  const cambiarPres = (ix, k, v) => { setForm(f => ({ ...f, presentaciones: f.presentaciones.map((p, j) => (j === ix ? { ...p, [k]: v } : p)) })); setFormErr('') }
  const marcarPrincipal = ix => setForm(f => ({ ...f, presentaciones: f.presentaciones.map((p, j) => ({ ...p, principal: j === ix ? !p.principal : false })) }))
  const anadirPres = () => setForm(f => ({ ...f, presentaciones: [...f.presentaciones, { k: ++kPres, id: '', nombre: '', cantidad: '', costo: '', activo: true, principal: !f.presentaciones.some(p => p.principal) }] }))
  const quitarPres = ix => setForm(f => ({ ...f, presentaciones: f.presentaciones.filter((_, j) => j !== ix) }))
  const setCampo = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setFormErr('') }

  const guardarInsumo = async e => {
    e.preventDefault()
    if (ocupado || !form) return
    if (!form.nombre.trim()) { setFormErr(tOr('inventario.faltaNombre', 'Escribe el nombre del insumo.')); return }
    if (!form.unidad.trim()) { setFormErr(tOr('inventario.faltaUnidad', 'Escribe la unidad: kg, litro, unidad…')); return }
    for (const k of ['stock', 'stock_min', 'costo']) {
      const v = form[k]
      if (v !== '' && v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        setFormErr(tOr('inventario.numeroInvalido', 'Stock, mínimo y costo deben ser números 0 o mayores.'))
        return
      }
    }
    for (const p of form.presentaciones) {
      if (!p.nombre.trim() || !(Number(p.cantidad) > 0)) {
        setFormErr(tOr('inventario.presInvalida', 'Cada presentación necesita un nombre y una cantidad mayor que 0.'))
        return
      }
    }
    const rend = form.rendimiento_esp === '' ? null : Number(String(form.rendimiento_esp).replace(',', '.'))
    if (rend !== null && !(rend > 0 && rend <= 100)) {
      setFormErr(tOr('inventario.rendInvalido', 'El rendimiento esperado debe estar entre 1 y 100 %.'))
      return
    }
    const minBase = resolverCantidad({ unidad: form.unidad, presentaciones: form.presentaciones.filter(p => p.id).map(p => ({ ...p, cantidad: Number(p.cantidad) })) }, form.stock_min, form.minSel).base
    setFormErr(''); setError(''); setGuardando(true)
    const nuevo = {
      ...(form.id ? { id: form.id } : {}),
      nombre: form.nombre.trim(),
      unidad: form.unidad.trim(),
      stock: numMonto(form.stock),
      stock_min: minBase,
      costo: Math.round(numMonto(form.costo) * 10000) / 10000,
      activo: Boolean(form.activo),
      con_merma: Boolean(form.con_merma),
      rendimiento_esp: rend,
      presentaciones: form.presentaciones.map(p => ({
        ...(p.id ? { id: p.id } : {}), nombre: p.nombre.trim(), cantidad: round3(Number(p.cantidad)),
        costo: p.costo === '' ? null : numMonto(p.costo), activo: Boolean(p.activo), principal: Boolean(p.principal) })),
    }
    try {
      if (enBase) await rpc('insumo_guardar', { p_insumo: nuevo })
      else d({ t: 'insumo+', insumo: nuevo })
      setForm(null)
      avisar(tOr('inventario.guardadoOk', 'Insumo guardado.'))
      if (enBase) await cargar(true)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setGuardando(false)
    }
  }

  const cerrarConfirmar = () => { setConfirmaBorrar(null); clearTimeout(timerPregunta.current) }
  const pulsarBorrar = i => {
    clearTimeout(timerPregunta.current)
    if (confirmaBorrar === i.id) { borrarInsumo(i); return }
    setConfirmaBorrar(i.id)
    timerPregunta.current = setTimeout(() => setConfirmaBorrar(null), CADUCA_PREGUNTA)
  }
  const borrarInsumo = async i => {
    if (ocupado) return
    setError(''); setAviso(''); setBorrandoId(i.id)
    try {
      if (enBase) await rpc('insumo_borrar', { p_insumo_id: i.id })
      else d({ t: 'insumo-', id: i.id })
      if (form?.id === i.id) setForm(null)
      if (mov?.insumoId === i.id) setMov(null)
      if (prodSel && !enBase) { setProdSel(null); setLineas([]) }
      avisar(tOr('inventario.borradoOk', 'Insumo borrado.'))
      if (enBase) await cargar(true)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setBorrandoId(null)
      cerrarConfirmar()
    }
  }

  const abrirMov = (i, tipo) => {
    setError(''); setMovErr(''); setForm(null); cerrarConfirmar()
    setMov(c => (c && c.insumoId === i.id && c.tipo === tipo ? null : { insumoId: i.id, tipo, cantidad: '', sel: 'base', nota: '', limpio: '', limpioSel: 'base', costoTotal: '', motivo: 'desecho' }))
  }
  // Misma regla que private.insumo_mover en el servidor: conversión de presentaciones y unidades,
  // rendimiento de limpieza y costo promedio ponderado sobre lo limpio.
  const analizarMov = (i, m) => {
    if (!i || !m) return null
    const r = resolverCantidad(i, m.cantidad, m.sel)
    const out = { r, base: r.base, stock: null, costo: num(i.costo), det: {}, limpio: null, costoTotal: null, error: '' }
    if (m.tipo === 'ajuste' ? m.cantidad === '' : !(r.base > 0)) return out
    if (m.tipo === 'entrada') {
      if (i.con_merma && m.limpio !== '') out.limpio = resolverCantidad({ unidad: i.unidad, presentaciones: [] }, m.limpio, m.limpioSel).base
      out.costoTotal = m.costoTotal !== '' ? numMonto(m.costoTotal) : null
      let ct = out.costoTotal
      if (!(ct > 0) && r.pres && num(r.pres.costo) > 0) ct = Math.round(r.cantPres * num(r.pres.costo) * 100) / 100
      try {
        const e = aplicarEntrada(i, { cantidad: r.base, limpio: out.limpio, costoTotal: ct })
        out.stock = e.stock; out.costo = e.costo; out.det = e.detalle
      } catch (ex) { out.error = tOr('inventario.limpioInvalido', 'El peso limpio debe ser mayor que 0 y no superar lo recibido.') }
    } else if (m.tipo === 'salida' || m.tipo === 'merma') out.stock = round3(num(i.stock) - r.base)
    else out.stock = r.base
    return out
  }
  const enviarMov = async e => {
    e.preventDefault()
    if (!mov || ocupado) return
    const i = insumoPorId.get(mov.insumoId)
    const an = analizarMov(i, mov)
    if (!an || (mov.tipo === 'ajuste' ? mov.cantidad === '' : !(an.base > 0))) { setMovErr(tOr('inventario.cantidadInvalida', 'La cantidad debe ser un número mayor que 0.')); return }
    if (an.error) { setMovErr(an.error); return }
    setMovErr(''); setError(''); setMovEnVio(true)
    const nota = mov.nota.trim() || null
    try {
      let nuevo = an.stock
      if (enBase) {
        nuevo = await rpc('insumo_movimiento', {
          p_insumo_id: mov.insumoId, p_tipo: mov.tipo, p_nota: nota,
          ...(an.r.presId ? { p_presentacion_id: an.r.presId, p_cant_pres: an.r.cantPres } : { p_cantidad: an.base }),
          ...(mov.tipo === 'entrada' && an.limpio !== null ? { p_limpio: an.limpio } : {}),
          ...(mov.tipo === 'entrada' && an.costoTotal > 0 ? { p_costo_total: an.costoTotal } : {}),
          ...(mov.tipo === 'merma' ? { p_motivo: mov.motivo } : {}),
        })
      } else {
        d({ t: 'insumo-mov', id: mov.insumoId, tipo: mov.tipo, cantidad: an.base, presId: an.r.presId, cantPres: an.r.cantPres,
          limpio: an.limpio, costoTotal: an.costoTotal, motivo: mov.motivo, nota, usuario: quien })
      }
      setMov(null)
      avisar(`${i?.nombre ?? ''} — ${tOr('inventario.nuevoStock', 'Nuevo stock')}: ${fmt(nuevo)} ${i?.unidad ?? ''}`.trim())
      if (enBase) await cargar(true)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setMovEnVio(false)
    }
  }

  const elegirProducto = p => {
    setRecErr(''); setError('')
    if (prodSel === p.id) { setProdSel(null); setLineas([]); return }
    setProdSel(p.id)
    setLineas((p.recetas || []).map(l => ({ insumo_id: l.insumo_id, cantidad: String(l.cantidad ?? '') })))
  }
  const anadirLinea = () => setLineas(l => [...l, { insumo_id: '', cantidad: '' }])
  // Alta de línea siempre a la vista: si no hay producto elegido, se elige el primero de la
  // lista filtrada y se le añade la línea; así el botón nunca queda muerto.
  const anadirLineaDesdeBarra = () => {
    if (!insumos.length) return
    if (productoSel) { anadirLinea(); return }
    const p = productosFiltrados[0] || productosMenu[0]
    if (!p) return
    setRecErr(''); setError('')
    setProdSel(p.id)
    setLineas([...(p.recetas || []).map(l => ({ insumo_id: l.insumo_id, cantidad: String(l.cantidad ?? '') })), { insumo_id: '', cantidad: '' }])
  }
  const quitarLinea = ix => setLineas(l => l.filter((_, k) => k !== ix))
  const cambiarLinea = (ix, k, v) => { setLineas(l => l.map((x, j) => (j === ix ? { ...x, [k]: v } : x))); setRecErr('') }

  const guardarReceta = async () => {
    if (!productoSel || ocupado) return
    const limpias = lineas.filter(l => String(l.insumo_id).trim() !== '' || num(l.cantidad) > 0)
    if (limpias.some(l => !l.insumo_id)) { setRecErr(tOr('inventario.recFaltaInsumo', 'Elige un insumo en todas las líneas.')); return }
    if (limpias.some(l => !(numMonto(l.cantidad) > 0))) { setRecErr(tOr('inventario.recFaltaCantidad', 'Cada línea necesita una cantidad mayor que 0.')); return }
    setRecErr(''); setError(''); setGuardandoRec(true)
    const pLineas = limpias.map(l => ({ insumo_id: l.insumo_id, cantidad: numMonto(l.cantidad) }))
    try {
      if (enBase) await rpc('receta_reemplazar', { p_producto_id: productoSel.id, p_lineas: pLineas })
      else d({ t: 'receta~', productoId: productoSel.id, lineas: pLineas })
      avisar(tOr('inventario.recetaOk', 'Receta guardada: ya se descuenta al cobrar.'))
      if (enBase) await cargar(true)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setGuardandoRec(false)
    }
  }

  const etiquetaTipo = t => {
    const clave = 'inventario.tipo.' + t
    const defecto = { entrada: 'Entrada', salida: 'Salida', venta: 'Venta', ajuste: 'Ajuste', merma: 'Merma' }[t] || String(t || '—')
    return tOr(clave, defecto)
  }
  const cantidadConSigno = m => {
    const n = num(m.cantidad)
    if (m.tipo === 'salida' || m.tipo === 'venta' || m.tipo === 'merma') return '−' + fmt(Math.abs(n))
    if (m.tipo === 'entrada') return '+' + fmt(Math.abs(n))
    return fmt(n)
  }
  // Nota del movimiento + detalle de rendimiento / motivo (los guarda el servidor en `detalle`).
  const notaMov = m => {
    const det = m?.detalle || {}
    const partes = []
    if (m?.nota) partes.push(m.nota)
    if (det.bruto !== undefined) partes.push(`${tOr('inventario.bruto', 'Bruto')} ${fmt(det.bruto)} · ${tOr('inventario.limpio', 'limpio')} ${fmt(det.limpio)} · ${tOr('inventario.rendimiento', 'Rendimiento')} ${fmt(det.rendimiento)} % · ${tOr('inventario.mermaLimpieza', 'Merma de limpieza')} ${fmt(det.merma_limpieza)}`)
    if (det.motivo) partes.push(`${tOr('inventario.motivoTitulo', 'Motivo')}: ${tOr('inventario.motivo.' + det.motivo, MOTIVO_ETIQUETA[det.motivo] || det.motivo)}`)
    return partes.join(' · ')
  }
  const exportarCSV = () => {
    if (!movs.length) return
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const cab = [
      tOr('inventario.colFecha', 'Fecha'), tOr('inventario.colInsumo', 'Insumo'), tOr('inventario.colTipo', 'Tipo'),
      tOr('inventario.colCantidad', 'Cantidad'), tOr('inventario.colStock', 'Stock después'),
      tOr('inventario.colNota', 'Nota'), tOr('inventario.colUsuario', 'Usuario'),
    ]
    const filas = movs.map(m => [fmtFecha(m.en), m.insumo_nombre, etiquetaTipo(m.tipo), cantidadConSigno(m), m.stock_after, notaMov(m), m.usuario_nombre || ''])
    const csv = '\ufeff' + [cab, ...filas].map(f => f.map(esc).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `inventario-${dias}-dias.csv`
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  if (!puedeVer) {
    return (
      <div className="inv-page">
        <div className="auth-aviso">{tOr('inventario.sinPermiso', 'Inventario: solo administrador.')}</div>
      </div>
    )
  }
  // Insumos, recetas y movimientos funcionan en los dos modos: en la base por rpc y en demo
  // con el store, que replica las formas del servidor y descuenta stock al cobrar.

  const bloqueForm = form && (
    <form className="inv-form" onSubmit={guardarInsumo}>
      <b>{form.id ? `${tOr('inventario.editando', 'Editando')}: ${form.nombre}` : tOr('inventario.altaTitulo', 'Nuevo insumo')}</b>
      <div className="inv-campos">
        <label className="adm-campo">
          <span>{tOr('inventario.nombre', 'Nombre')}</span>
          <input name="pista-nombre" autoFocus value={form.nombre} onChange={setCampo('nombre')} maxLength={80}
            placeholder={tOr('inventario.pistaNombre', 'p. ej. Aceite, Carne molida')} />
        </label>
        <label className="adm-campo">
          <span>{tOr('inventario.unidad', 'Unidad')}</span>
          <input name="pista-unidad" value={form.unidad} onChange={setCampo('unidad')} maxLength={20}
            placeholder={tOr('inventario.pistaUnidad', 'kg, litro, unidad')} />
        </label>
        <label className="adm-campo">
          <span>{tOr('inventario.stock', 'Stock')} ({form.unidad || tOr('inventario.unidadBase', 'unidad base')})</span>
          <input name="stock" type="text" inputMode="decimal" autoComplete="off" value={form.stock}
            onChange={e => { setForm(f => ({ ...f, stock: limpiarCant(e.target.value) })); setFormErr('') }}
            onBlur={() => setForm(f => ({ ...f, stock: normalizarCant(f.stock) }))}
            onFocus={e => e.target.select()} placeholder="0" />
        </label>
        <CantidadUnidad ins={{ unidad: form.unidad, presentaciones: form.presentaciones.filter(p => p.id).map(p => ({ ...p, cantidad: Number(p.cantidad) })) }}
          etiqueta={tOr('inventario.minimo', 'Mínimo')} valor={form.stock_min} sel={form.minSel} name="stock-min"
          onValor={v => { setForm(f => ({ ...f, stock_min: v })); setFormErr('') }} onSel={v => setForm(f => ({ ...f, minSel: v }))} />
        <label className="adm-campo">
          <span>{tOr('inventario.costoPorUnidad', 'Costo por unidad base')} ({MONEDA}{form.unidad ? ' / ' + form.unidad : ''})</span>
          <input name="costo" type="text" inputMode="decimal" autoComplete="off" value={form.costo}
            onChange={e => { setForm(f => ({ ...f, costo: limpiarCosto(e.target.value) })); setFormErr('') }}
            onBlur={() => setForm(f => ({ ...f, costo: normalizarCosto(f.costo) }))}
            onFocus={e => e.target.select()} placeholder="0" />
        </label>
        <label className="inv-check">
          <input name="activo" type="checkbox" className="sw" checked={Boolean(form.activo)} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
          {tOr('inventario.activo', 'Activo')}
        </label>
      </div>

      <div className="inv-campos">
        <label className="inv-check">
          <input name="con-merma" type="checkbox" className="sw" checked={Boolean(form.con_merma)} onChange={e => setForm(f => ({ ...f, con_merma: e.target.checked }))} />
          {tOr('inventario.conMerma', 'Con merma de limpieza (al recibir se indica el peso limpio)')}
        </label>
        {form.con_merma && (
          <label className="adm-campo">
            <span>{tOr('inventario.rendEsperado', 'Rendimiento esperado (%)')}</span>
            <input name="rendimiento-esp" type="text" inputMode="decimal" autoComplete="off" value={form.rendimiento_esp}
              onChange={e => { setForm(f => ({ ...f, rendimiento_esp: limpiarMonto(e.target.value) })); setFormErr('') }}
              onFocus={e => e.target.select()} placeholder="84" />
          </label>
        )}
      </div>

      <div className="inv-pres-lista">
        <b>{tOr('inventario.presTitulo', 'Presentaciones (como las compras)')}</b>
        <span className="adm-sub">{tOr('inventario.presAyuda', 'Cada presentación equivale a una cantidad en la unidad base. Ej.: «Botella 32 oz» = 32. El stock siempre se guarda en la unidad base.')}</span>
        {form.presentaciones.map((p, ix) => (
          <div key={p.k} className="inv-pres-fila">
            <label className="adm-campo inv-pres-nombre">
              <span>{tOr('inventario.presNombre', 'Nombre')}</span>
              <input name="pres-nombre" value={p.nombre} maxLength={60} onChange={e => cambiarPres(ix, 'nombre', e.target.value)} placeholder={tOr('inventario.presPista', 'Botella 750 ml, Bolsa 5 kg…')} />
            </label>
            <label className="adm-campo">
              <span>{tOr('inventario.presCantidad', 'Cantidad')} ({form.unidad || tOr('inventario.unidadBase', 'unidad base')})</span>
              <input name="pres-cantidad" type="text" inputMode="decimal" autoComplete="off" value={p.cantidad} onChange={e => cambiarPres(ix, 'cantidad', limpiarCant(e.target.value))} onFocus={e => e.target.select()} placeholder="0" />
            </label>
            <label className="adm-campo">
              <span>{tOr('inventario.presCosto', 'Costo de referencia')} ({MONEDA})</span>
              <input name="pres-costo" type="text" inputMode="decimal" autoComplete="off" value={p.costo} onChange={e => cambiarPres(ix, 'costo', limpiarMonto(e.target.value))} onFocus={e => e.target.select()} placeholder="0" />
            </label>
            <label className="inv-check"><input type="checkbox" className="sw" checked={Boolean(p.principal)} onChange={() => marcarPrincipal(ix)} />{tOr('inventario.presPrincipal', 'Principal')}</label>
            <label className="inv-check"><input type="checkbox" className="sw" checked={p.activo !== false} onChange={e => cambiarPres(ix, 'activo', e.target.checked)} />{tOr('inventario.activo', 'Activo')}</label>
            {numMonto(p.costo) > 0 && numMonto(p.cantidad) > 0 && (
              <button type="button" className="ghost" onClick={() => setForm(f => ({ ...f, costo: String(costoDePresentacion({ cantidad: numMonto(p.cantidad), costo: numMonto(p.costo) })) }))}>
                {tOr('inventario.usarCosto', 'Usar como costo por unidad')}: {MONEDA} {fmtC(costoDePresentacion({ cantidad: numMonto(p.cantidad), costo: numMonto(p.costo) }))}
              </button>
            )}
            <button type="button" className="danger" onClick={() => quitarPres(ix)}>✕ {tOr('inventario.quitarFila', 'Quitar')}</button>
          </div>
        ))}
        <div className="adm-fila">
          <button type="button" className="success" onClick={anadirPres}>＋ {tOr('inventario.anadirPres', 'Presentación')}</button>
        </div>
      </div>
      {formErr && <span className="adm-msg warn">{formErr}</span>}
      <div className="adm-fila">
        <button type="submit" className="primary" disabled={guardando}>
          {guardando ? tOr('inventario.guardando', 'Guardando…') : tOr('inventario.guardar', 'Guardar')}
        </button>
        <button type="button" onClick={() => { setForm(null); setFormErr('') }} disabled={guardando}>
          {tOr('inventario.cancelar', 'Cancelar')}
        </button>
      </div>
    </form>
  )

  return (
    <div className="inv-page">
      <CabeceraPagina
        titulo={tOr('inventario.titulo', 'Inventario')}
        datos={(
          <span className="adm-chip">
            {insumos.length} {tOr('inventario.chipInsumos', 'insumos')}
            {nBajos > 0 && <> · {nBajos} {tOr('inventario.chipBajos', 'con stock bajo')}</>}
          </span>
        )}
        acciones={enBase && (
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>
            {cargando ? tOr('inventario.cargando', 'Cargando…') : tOr('inventario.actualizar', 'Actualizar')}
          </button>
        )}
      />

      <div className="inv-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={pestana === 'insumos'} className={'tab' + (pestana === 'insumos' ? ' on' : '')} onClick={() => setPestana('insumos')}>
          {tOr('inventario.tabInsumos', 'Insumos')}
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'recetas'} className={'tab' + (pestana === 'recetas' ? ' on' : '')} onClick={() => setPestana('recetas')}>
          {tOr('inventario.tabRecetas', 'Recetas')}
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'movimientos'} className={'tab' + (pestana === 'movimientos' ? ' on' : '')} onClick={() => setPestana('movimientos')}>
          {tOr('inventario.tabMovimientos', 'Movimientos')}
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'mermas'} className={'tab' + (pestana === 'mermas' ? ' on' : '')} onClick={() => setPestana('mermas')}>
          {tOr('inventario.tabMermas', 'Mermas')}
        </button>
        {esAdmin && <>
        <button type="button" role="tab" aria-selected={pestana === 'proveedores'} className={'tab' + (pestana === 'proveedores' ? ' on' : '')} onClick={() => setPestana('proveedores')}>
          {tOr('inventario.tabProveedores', 'Proveedores')}
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'cuentas'} className={'tab' + (pestana === 'cuentas' ? ' on' : '')} onClick={() => setPestana('cuentas')}>
          {tOr('inventario.tabCuentas', 'Cuentas por pagar')}
        </button>
        </>}
      </div>

      {error && (
        <div className="auth-aviso inv-error" role="alert">
          ⚠️ {error}
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>{tOr('inventario.reintentar', 'Reintentar')}</button>
        </div>
      )}
      {aviso && <div className="inv-ok">✅ {aviso}</div>}

      {pestana === 'insumos' && (
        <section className="adm-card inv-bloque">
          <div className="adm-card-cab">
            <h3>{tOr('inventario.insumosTitulo', 'Insumos')}</h3>
            <span className="sp" />
            {puedeGestionar && (
              <button type="button" className="primary" disabled={ocupado || Boolean(form)} onClick={abrirNuevo}>
                ＋ {tOr('inventario.nuevoInsumo', 'Insumo')}
              </button>
            )}
          </div>

          {form && !form.id && bloqueForm}

          {cargando && insumos.length === 0
            ? <div className="adm-vacio">{tOr('inventario.consultando', 'Consultando el inventario…')}</div>
            : !insumos.length
              ? <div className="adm-vacio">{tOr('inventario.vacioInsumos', 'Aún no hay insumos. Crea el primero con «＋ Insumo».')}</div>
              : (
                <div className="inv-lista">
                  {insumos.map(i => {
                    const enForm = form?.id === i.id
                    const enMov = mov?.insumoId === i.id
                    const preguntando = confirmaBorrar === i.id
                    const cls = stockBajo(i) ? 'bajo' : stockMedio(i) ? 'medio' : ''
                    return (
                      <div key={i.id} className={'inv-fila inv-fila-insumo ' + cls}>
                        <div className="inv-datos">
                          <span className={'inv-stock ' + cls}>{fmt(i.stock)} <small>{i.unidad}</small></span>
                          <span className="inv-nombre">{i.nombre}{!i.activo && <em className="inv-inactivo"> · {tOr('inventario.inactivo', 'inactivo')}</em>}</span>
                          {(() => {
                            const eq = equivalencia(i)
                            if (!eq) return null
                            const otras = presentacionesActivasDe(i).filter(p => p.id !== eq.pres.id)
                            return (
                              <span className="inv-equiv">
                                ≈ <b>{fmt(eq.n)} × {eq.pres.nombre}</b>{eq.resto > 0 ? ` + ${fmt(eq.resto)} ${i.unidad}` : ''}
                                {otras.length > 0 && <> · {otras.map(p => `${fmt(round3(num(i.stock) / num(p.cantidad)))} × ${p.nombre}`).join(' · ')}</>}
                              </span>
                            )
                          })()}
                          <span className="inv-dato">{tOr('inventario.minimo', 'Mínimo')}: {fmt(i.stock_min)}</span>
                          <span className="inv-dato">{MONEDA} {fmtC(i.costo)} / {i.unidad}</span>
                          <span className={'inv-chip-estado ' + cls}>
                            {cls === 'bajo' ? '🔴 ' + tOr('inventario.stockBajo', 'Stock bajo') : cls === 'medio' ? '🟠 ' + tOr('inventario.stockCerca', 'Cerca del mínimo') : '🟢 ' + tOr('inventario.stockOk', 'Bien')}
                          </span>
                        </div>
                        {puedeGestionar && <div className="inv-acciones">
                          <button type="button" className="success" disabled={ocupado} onClick={() => abrirMov(i, 'entrada')}>{tOr('inventario.entrada', 'Entrada')}</button>
                          <button type="button" className="ghost" disabled={ocupado} onClick={() => abrirMov(i, 'salida')}>{tOr('inventario.salida', 'Salida')}</button>
                          <MasMenu desactivado={ocupado} items={[
                            { clave: 'merma', texto: tOr('inventario.registrarMerma', 'Registrar merma'), onClick: () => abrirMov(i, 'merma') },
                            { clave: 'ajuste', texto: tOr('inventario.ajuste', 'Ajuste'), onClick: () => abrirMov(i, 'ajuste') },
                            { clave: 'editar', texto: enForm ? tOr('inventario.cerrar', 'Cerrar') : tOr('inventario.editar', 'Editar'), onClick: () => (enForm ? setForm(null) : abrirEditar(i)) },
                            { clave: 'borrar', peligro: true, mantener: !preguntando, desactivado: ocupado, onClick: () => pulsarBorrar(i),
                              texto: borrandoId === i.id ? tOr('inventario.borrando', 'Borrando…') : preguntando ? tOr('inventario.seguro', '¿Seguro?') : tOr('inventario.borrar', 'Borrar') },
                          ]} />
                        </div>}

                        {enMov && (() => {
                          const an = analizarMov(i, mov)
                          const det = an?.det || {}
                          const unid = i.unidad
                          return (
                            <form className="inv-mov" onSubmit={enviarMov}>
                              <b>{tOr('inventario.mov', 'Registrar')} {etiquetaTipo((mov.tipo || '').toLowerCase())} · {i.nombre}</b>
                              <div className="inv-mov-campos">
                                <CantidadUnidad ins={i} autoFocus etiqueta={`${tOr('inventario.cantidad', 'Cantidad')}${mov.tipo === 'ajuste' ? ' (' + tOr('inventario.stockFinal', 'stock final') + ')' : ''}`}
                                  valor={mov.cantidad} sel={mov.sel} onValor={v => { setMov(m => ({ ...m, cantidad: v })); setMovErr('') }} onSel={v => setMov(m => ({ ...m, sel: v }))} />
                                {mov.tipo === 'merma' && (
                                  <label className="adm-campo">
                                    <span>{tOr('inventario.motivoTitulo', 'Motivo')}</span>
                                    <select name="motivo" value={mov.motivo} onChange={e => setMov(m => ({ ...m, motivo: e.target.value }))}>
                                      {MOTIVOS_MERMA.map(k => <option key={k} value={k}>{tOr('inventario.motivo.' + k, MOTIVO_ETIQUETA[k])}</option>)}
                                    </select>
                                  </label>
                                )}
                                {mov.tipo === 'entrada' && i.con_merma && (
                                  <>
                                    <CantidadUnidad ins={i} conPresentaciones={false} name="limpio" etiqueta={tOr('inventario.pesoLimpio', 'Peso limpio (opcional)')}
                                      valor={mov.limpio} sel={mov.limpioSel} onValor={v => { setMov(m => ({ ...m, limpio: v })); setMovErr('') }} onSel={v => setMov(m => ({ ...m, limpioSel: v }))} />
                                    {num(i.rendimiento_esp) > 0 && an?.base > 0 && (
                                      <button type="button" className="ghost" onClick={() => {
                                        const sug = round3(an.base * num(i.rendimiento_esp) / 100)
                                        const sel = mov.limpioSel
                                        const fac = resolverCantidad({ unidad: i.unidad }, 1, sel).base || 1
                                        setMov(m => ({ ...m, limpio: String(round3(sug / fac)) }))
                                      }}>{tOr('inventario.sugerirLimpio', 'Sugerir con')} {fmt(i.rendimiento_esp)} %</button>
                                    )}
                                  </>
                                )}
                                {mov.tipo === 'entrada' && (
                                  <label className="adm-campo">
                                    <span>{tOr('inventario.costoTotal', 'Total pagado (opcional)')} ({MONEDA})</span>
                                    <input name="costo-total" type="text" inputMode="decimal" autoComplete="off" value={mov.costoTotal}
                                      onChange={e => setMov(m => ({ ...m, costoTotal: limpiarMonto(e.target.value) }))} onFocus={e => e.target.select()} placeholder="0" />
                                  </label>
                                )}
                                <label className="adm-campo inv-mov-nota">
                                  <span>{tOr('inventario.nota', 'Nota')}</span>
                                  <input name="pista-nota" type="text" value={mov.nota} onChange={e => setMov(m => ({ ...m, nota: e.target.value }))}
                                    placeholder={tOr('inventario.pistaNota', 'opcional: motivo, proveedor…')} />
                                </label>
                              </div>
                              {an && an.stock !== null && !an.error && (
                                <div className="inv-aviso-calc">
                                  {an.r.presId && <>{fmt(an.r.cantPres)} × {an.r.pres.nombre} = {fmt(an.base)} {unid} · </>}
                                  {!an.r.presId && an.r.base !== num(mov.cantidad) && <>{fmt(mov.cantidad)} {mov.sel.slice(2)} = {fmt(an.base)} {unid} · </>}
                                  {det.limpio !== undefined && <>{tOr('inventario.rendimiento', 'Rendimiento')} {fmt(det.rendimiento)} % · {tOr('inventario.mermaLimpieza', 'Merma de limpieza')} {fmt(det.merma_limpieza)} {unid} · </>}
                                  {tOr('inventario.nuevoStock', 'Nuevo stock')}: <b>{fmt(an.stock)} {unid}</b>
                                  {mov.tipo === 'entrada' && an.costo !== num(i.costo) && <> · {tOr('inventario.nuevoCosto', 'Costo por unidad')}: {MONEDA} {fmtC(an.costo)}</>}
                                </div>
                              )}
                              {movErr && <span className="adm-msg warn">{movErr}</span>}
                              <div className="adm-fila">
                                <button type="submit" className="primary" disabled={movEnVio}>
                                  {movEnVio ? tOr('inventario.registrando', 'Registrando…') : tOr('inventario.registrar', 'Registrar')}
                                </button>
                                <button type="button" onClick={() => setMov(null)} disabled={movEnVio}>{tOr('inventario.cancelar', 'Cancelar')}</button>
                              </div>
                            </form>
                          )
                        })()}

                        {enForm && bloqueForm}
                      </div>
                    )
                  })}
                </div>
              )}
          <p className="adm-sub">{tOr('inventario.insumosAyuda', '«Stock» guarda el valor absoluto del insumo; para moverlo sin editar usa Entrada, Salida o Ajuste.')}</p>
        </section>
      )}

      {pestana === 'recetas' && (
        <section className="adm-card inv-bloque">
          <div className="adm-card-cab">
            <h3>{tOr('inventario.recTitulo', 'Recetas del menú')}</h3>
            <span className="adm-chip">
              {productosMenu.filter(p => (p.recetas || []).length).length} / {productosMenu.length} {tOr('inventario.recCon', 'con receta')}
            </span>
          </div>
          <p className="adm-sub">{tOr('inventario.recIntro', 'Vincula cada plato con sus insumos: al cobrar una venta, la base descuenta el stock según la receta.')}</p>

          {!!productosMenu.length && puedeGestionar && (
            <div className="adm-fila inv-receta-barra">
              <button type="button" className="success" disabled={guardandoRec || ocupado || !insumos.length} onClick={anadirLineaDesdeBarra}
                title={!insumos.length ? tOr('inventario.primeroInsumos', 'Primero crea insumos en la pestaña Insumos.')
                  : productoSel ? `${tOr('inventario.anadirLinea', 'Añadir línea')}: ${productoSel.nombre}` : tOr('inventario.anadirLinea', 'Añadir línea')}>
                ＋ {tOr('inventario.anadirLinea', 'Añadir línea')}
              </button>
              {!insumos.length && <span className="adm-msg warn">{tOr('inventario.primeroInsumos', 'Primero crea insumos en la pestaña Insumos.')}</span>}
            </div>
          )}

          {!cargando && !productosMenu.length && (
            <div className="adm-vacio">{tOr('inventario.vacioProductos', 'El menú no tiene productos todavía. Crea primero los platos en Menú.')}</div>
          )}

          {!!productosMenu.length && (
            <>
              <input name="rec-buscador" className="inv-buscador" value={buscador} onChange={e => setBuscador(e.target.value)}
                placeholder={tOr('inventario.recBuscador', 'Buscar producto…')} />
              <div className="inv-lista">
                {productosFiltrados.map(p => {
                  const nLineas = (p.recetas || []).length
                  const sel = prodSel === p.id
                  return (
                    <div key={p.id} className={'inv-fila inv-fila-producto' + (sel ? ' sel' : '')}>
                      <div className="inv-datos">
                        <span className="inv-nombre">{p.nombre}{p.activo === false && <em className="inv-inactivo"> · {tOr('inventario.inactivo', 'inactivo')}</em>}</span>
                        <span className={'inv-chip-receta ' + (nLineas ? 'ok' : 'off')}>
                          {nLineas ? `🍲 ${nLineas} ${tOr('inventario.lineas', 'línea(s)')}` : '⚠️ ' + tOr('inventario.sinReceta', 'Sin receta')}
                        </span>
                      </div>
                      <div className="inv-acciones">
                        <button type="button" className={sel ? 'info' : 'ghost'} disabled={ocupado} onClick={() => elegirProducto(p)}>
                          {sel ? tOr('inventario.cerrar', 'Cerrar') : tOr('inventario.verReceta', 'Ver / editar receta')}
                        </button>
                      </div>

                      {sel && (
                        <div className="inv-receta">
                          <b>{tOr('inventario.lineas', 'Líneas de insumo')}</b>
                          {!lineas.length && <span className="adm-vacio">{tOr('inventario.sinLineas', 'Sin líneas todavía: añade la primera. (Dejar la receta vacía también es válido: guárdala sin líneas.)')}</span>}
                          {lineas.map((l, ix) => (
                            <div key={ix} className="inv-linea">
                              <select name="insumo-id" className="inv-sel-insumo" value={l.insumo_id} disabled={!puedeGestionar} onChange={e => cambiarLinea(ix, 'insumo_id', e.target.value)}>
                                <option value="">{tOr('inventario.elegirInsumo', 'Elige un insumo')}</option>
                                {insumos.map(i => (
                                  <option key={i.id} value={i.id}>{i.nombre} ({i.unidad}) · {tOr('inventario.disponibles', 'disponibles')}: {fmt(i.stock)}</option>
                                ))}
                              </select>
                              <input name="pista-cantidad" className="inv-cant" type="text" inputMode="decimal" autoComplete="off" value={l.cantidad} disabled={!puedeGestionar}
                                onChange={e => cambiarLinea(ix, 'cantidad', limpiarCant(e.target.value))}
                                onBlur={() => cambiarLinea(ix, 'cantidad', normalizarCant(l.cantidad))}
                                onFocus={e => e.target.select()}
                                placeholder={tOr('inventario.pistaCantidad', 'cantidad por preparación')} />
                              <span className="inv-unid">{insumoPorId.get(l.insumo_id)?.unidad || ''}</span>
                              {puedeGestionar && <button type="button" className="danger" disabled={guardandoRec} onClick={() => quitarLinea(ix)}>✕</button>}
                            </div>
                          ))}

                          <div className="inv-receta-resumen">
                            <span className="adm-chip">{tOr('inventario.costoTeorico', 'Costo teórico')}: {MONEDA} {fmtC(analisisReceta.costo)}</span>
                            {analisisReceta.porciones !== null && (
                              <span className={'adm-chip' + (analisisReceta.insuficientes.length ? ' inv-chip-alerta' : '')}>
                                {analisisReceta.porciones < 1
                                  ? `${tOr('inventario.stockInsuficiente', 'Stock insuficiente: alcanzará para')} ${fmt(analisisReceta.porciones)}`
                                  : `${tOr('inventario.alcanza', 'Alcanza para')} ${fmt(analisisReceta.porciones)} ${tOr('inventario.preparaciones', 'preparaciones')}`}
                              </span>
                            )}
                          </div>

                          {recErr && <span className="adm-msg warn">{recErr}</span>}
                          {puedeGestionar && <div className="adm-fila">
                            <button type="button" className="primary" disabled={guardandoRec || ocupado} onClick={guardarReceta}>
                              {guardandoRec ? tOr('inventario.guardando', 'Guardando…') : tOr('inventario.guardarReceta', 'Guardar receta')}
                            </button>
                            <button type="button" disabled={guardandoRec} onClick={() => { setProdSel(null); setLineas([]); setRecErr('') }}>
                              {tOr('inventario.cancelar', 'Cancelar')}
                            </button>
                          </div>}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!productosFiltrados.length && <div className="adm-vacio">{tOr('inventario.sinCoincidencias', 'Ningún producto coincide con la búsqueda.')}</div>}
              </div>
            </>
          )}
        </section>
      )}

      {pestana === 'movimientos' && (
        <section className="adm-card inv-bloque">
          <div className="adm-card-cab">
            <h3>{tOr('inventario.movsTitulo', 'Historial de movimientos')}</h3>
            <span className="sp" />
            {DIAS.map(n => (
              <button key={n} type="button" className={'tab' + (dias === n ? ' on' : '')} onClick={() => setDias(n)}>
                {tOr('inventario.diasRange', `${n} días`, { n })}
              </button>
            ))}
            <button type="button" className="ghost" disabled={cargandoMovs || !movs.length} onClick={exportarCSV}>
              {tOr('inventario.exportar', 'Exportar CSV')}
            </button>
          </div>

          {errorMovs && (
            <div className="auth-aviso inv-error" role="alert">
              ⚠️ {errorMovs}
              <button type="button" className="ghost" disabled={cargandoMovs} onClick={cargarMovs}>{tOr('inventario.reintentar', 'Reintentar')}</button>
            </div>
          )}
          {cargandoMovs && !movs.length
            ? <div className="adm-vacio">{tOr('inventario.consultandoMovs', 'Consultando movimientos…')}</div>
            : !errorMovs && !cargandoMovs && !movs.length
              ? <div className="adm-vacio">{tOr('inventario.vacioMovs', 'Sin movimientos en este periodo.')}</div>
              : (
                <div className="inv-lista inv-movs">
                  <div className="inv-movs-cab">
                    <span>{tOr('inventario.colFecha', 'Fecha')}</span>
                    <span>{tOr('inventario.colInsumo', 'Insumo')}</span>
                    <span>{tOr('inventario.colTipo', 'Tipo')}</span>
                    <span className="der">{tOr('inventario.colCantidad', 'Cantidad')}</span>
                    <span className="der">{tOr('inventario.colStock', 'Stock después')}</span>
                    <span>{tOr('inventario.colUsuario', 'Usuario')}</span>
                    <span>{tOr('inventario.colNota', 'Nota')}</span>
                  </div>
                  {movs.map((m, ix) => {
                    const t = String(m.tipo || '').toLowerCase()
                    return (
                      <div key={ix} className="inv-movs-fila">
                        <span className="inv-movs-fecha">{fmtFecha(m.en)}</span>
                        <span className="inv-movs-insumo">{m.insumo_nombre || '—'}</span>
                        <span className={'inv-tipo inv-tipo-' + t}>{etiquetaTipo(t)}</span>
                        <span className={'inv-cantidad der inv-cantidad-' + t}>{cantidadConSigno(m)}</span>
                        <span className="der">{fmt(m.stock_after)}</span>
                        <span>{m.usuario_nombre || tOr('inventario.sistema', 'sistema')}</span>
                        <span className="inv-nota">{notaMov(m)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
          <p className="adm-sub">{tOr('inventario.movsNota', '«Venta» lo genera el sistema al cobrar (descuenta stock por la receta); Entrada, Salida, Ajuste y Merma los registras aquí.')}</p>
        </section>
      )}

      {pestana === 'mermas' && (
        <MermasTab insumos={insumos} puedeGestionar={puedeGestionar} quien={quien} enBase={enBase} locale={locale} fmt={fmt} onCambio={() => cargar(true)} />
      )}

      {pestana === 'proveedores' && esAdmin && (
        <ProveedoresTab onPagar={id => { setProvFiltro(id); setPestana('cuentas') }} alta={provAlta} onAltaDone={() => setProvAlta(false)} />
      )}

      {pestana === 'cuentas' && esAdmin && (
        <CuentasTab filtroProveedor={provFiltro} onFiltro={setProvFiltro} alta={cuentaAlta} onAltaDone={() => setCuentaAlta(false)} />
      )}
    </div>
  )
}
