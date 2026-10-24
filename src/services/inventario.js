// Lógica pura del inventario (presentaciones, conversión de unidades, rendimiento y merma).
// La usan el modo demo (reducer de StoreContext) y la pantalla; el servidor repite las mismas
// reglas en private.insumo_mover (install/supabase-setup-final.sql, bloque I).

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export const round3 = x => Math.round(num(x) * 1000) / 1000
export const round4 = x => Math.round(num(x) * 10000) / 10000

export const MOTIVOS_MERMA = ['limpieza', 'desecho', 'vencido', 'derrame', 'otro']
export const MOTIVO_ETIQUETA = { limpieza: 'Limpieza', desecho: 'Desecho', vencido: 'Vencido', derrame: 'Derrame', otro: 'Otro' }

// Unidades que se pueden convertir entre sí sin ambigüedad (g/kg y ml/l).
const ALIAS = { gr: 'g', grs: 'g', gramo: 'g', gramos: 'g', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  mililitro: 'ml', mililitros: 'ml', litro: 'l', litros: 'l', lt: 'l', lts: 'l' }
const FACTOR = { g: ['masa', 1], kg: ['masa', 1000], ml: ['vol', 1], l: ['vol', 1000] }
export const normUnidad = u => {
  const k = String(u || '').trim().toLowerCase().replace(/\.$/, '')
  return ALIAS[k] || k
}
// Unidades alternativas para escribir una cantidad (kg si la base es g, etc.).
export function unidadesCompatibles(unidadBase) {
  const b = FACTOR[normUnidad(unidadBase)]
  if (!b) return []
  return Object.keys(FACTOR).filter(u => FACTOR[u][0] === b[0] && u !== normUnidad(unidadBase))
}
export function convertirAUnidadBase(cant, unidadOrigen, unidadBase) {
  const o = FACTOR[normUnidad(unidadOrigen)], b = FACTOR[normUnidad(unidadBase)]
  if (!o || !b || o[0] !== b[0]) return round3(cant)
  return round3(num(cant) * o[1] / b[1])
}

export const presentacionesDe = ins => (Array.isArray(ins?.presentaciones) ? ins.presentaciones : [])
export const presentacionesActivas = ins => presentacionesDe(ins).filter(p => p && p.activo !== false && num(p.cantidad) > 0)
export function presPrincipal(ins) {
  const act = presentacionesActivas(ins)
  return act.find(p => p.principal) || act[0] || null
}

// Selección de unidad de una cantidad: 'base' | 'p:<id>' | 'u:<unidad compatible>'.
// Devuelve { base, presId, cantPres } para mandar al servidor / aplicar en demo.
export function resolverCantidad(ins, cant, sel) {
  const c = num(cant)
  if (typeof sel === 'string' && sel.startsWith('p:')) {
    const id = sel.slice(2)
    const p = presentacionesDe(ins).find(x => x.id === id)
    if (p) return { base: round3(c * num(p.cantidad)), presId: p.id, cantPres: round3(c), pres: p }
  }
  if (typeof sel === 'string' && sel.startsWith('u:')) {
    return { base: convertirAUnidadBase(c, sel.slice(2), ins?.unidad), presId: null, cantPres: null, pres: null }
  }
  return { base: round3(c), presId: null, cantPres: null, pres: null }
}

// «42 oz ≈ 1 × Botella 32 oz + 10 oz» (usa la presentación principal; null si no hay ninguna).
export function equivalencia(ins) {
  const p = presPrincipal(ins)
  if (!p) return null
  const stock = num(ins.stock)
  if (stock <= 0) return { n: 0, pres: p, resto: round3(stock) }
  const n = Math.floor(round3(stock / num(p.cantidad)) + 1e-9)
  return { n, pres: p, resto: round3(stock - n * num(p.cantidad)) }
}

// Costo por unidad base desde el costo de una presentación (Bs 120 / 32 oz = 3,75).
export const costoDePresentacion = p => (num(p?.cantidad) > 0 && num(p?.costo) > 0 ? round4(num(p.costo) / num(p.cantidad)) : 0)

// Entrada con posible rendimiento. Devuelve stock y costo nuevos (costo promedio ponderado sobre lo LIMPIO).
export function aplicarEntrada(ins, { cantidad, limpio = null, costoTotal = null }) {
  const bruto = round3(cantidad)
  let suma = bruto
  const detalle = {}
  if (ins?.con_merma && limpio !== null && limpio !== '' && limpio !== undefined) {
    const l = round3(limpio)
    if (!(l > 0) || l > bruto) throw new Error('El peso limpio debe ser mayor que cero y no superar lo recibido')
    suma = l
    Object.assign(detalle, { bruto, limpio: l, merma_limpieza: round3(bruto - l), rendimiento: Math.round(l / bruto * 10000) / 100 })
  }
  const stock0 = num(ins?.stock)
  let costo = num(ins?.costo)
  if (num(costoTotal) > 0) {
    costo = round4((Math.max(stock0, 0) * costo + num(costoTotal)) / (Math.max(stock0, 0) + suma))
    detalle.costo_total = num(costoTotal)
  }
  return { stock: round3(stock0 + suma), costo, mov: suma, detalle }
}

const claveDia = iso => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Resumen de merma a partir de filas {en, insumo_id, insumo_nombre, unidad, costo, tipo, cantidad, detalle}.
// Devuelve { porInsumo[], porDia[], totales } con merma manual, merma de limpieza, rendimiento promedio y costo.
export function resumenMerma(filas = [], desdeMs = 0) {
  const ins = new Map(), dias = new Map()
  const tot = { manual: 0, limpieza: 0, costo: 0 }
  for (const m of filas) {
    const t = new Date(m?.en).getTime()
    if (!Number.isFinite(t) || t < desdeMs) continue
    const det = m.detalle || {}
    let manual = 0, limp = 0, rend = null
    if (m.tipo === 'merma') manual = num(m.cantidad)
    else if (m.tipo === 'entrada' && det.merma_limpieza !== undefined) { limp = num(det.merma_limpieza); rend = num(det.rendimiento) }
    else continue
    const costoUnit = num(det.costo_unit) || num(m.costo)
    const costo = round4((manual + limp) * costoUnit)
    const id = m.insumo_id || m.insumo_nombre
    const a = ins.get(id) || { insumo_id: id, nombre: m.insumo_nombre, unidad: m.unidad || '', manual: 0, limpieza: 0, costo: 0, rendSuma: 0, rendN: 0 }
    a.manual = round3(a.manual + manual); a.limpieza = round3(a.limpieza + limp); a.costo = round4(a.costo + costo)
    if (rend !== null) { a.rendSuma += rend; a.rendN += 1 }
    ins.set(id, a)
    const k = claveDia(m.en)
    const b = dias.get(k) || { dia: k, manual: 0, limpieza: 0, costo: 0 }
    b.manual = round3(b.manual + manual); b.limpieza = round3(b.limpieza + limp); b.costo = round4(b.costo + costo)
    dias.set(k, b)
    tot.manual = round3(tot.manual + manual); tot.limpieza = round3(tot.limpieza + limp); tot.costo = round4(tot.costo + costo)
  }
  const porInsumo = [...ins.values()].map(a => ({ ...a, rendimiento: a.rendN ? Math.round(a.rendSuma / a.rendN * 100) / 100 : null }))
    .sort((x, y) => y.costo - x.costo)
  const porDia = [...dias.values()].sort((x, y) => (x.dia < y.dia ? 1 : -1))
  return { porInsumo, porDia, totales: tot }
}
