export const GRUPO_DIRECTA = 'directa'

const GRUPOS_BASE = [
  { id: 'cocina', nombre: 'Cocina', ancho: 32, baud: 9600 },
  { id: 'barra', nombre: 'Barra', ancho: 32, baud: 9600 },
  { id: GRUPO_DIRECTA, nombre: 'Venta directa', ancho: 32, baud: 9600 },
  { id: 'caja', nombre: 'Caja (tickets)', ancho: 32, baud: 9600, tickets: true },
]

// Un negocio ya tiene sus grupos guardados en config, así que «Venta directa» se añade al final
// cuando falta. Nunca al principio: una sección sin asignación tiene que seguir cayendo en Cocina.
const conDirecta = lista => (lista.some(g => g.id === GRUPO_DIRECTA) ? lista
  : [...lista.filter(g => !g.tickets), { id: GRUPO_DIRECTA, nombre: 'Venta directa', ancho: 32, baud: 9600 }, ...lista.filter(g => g.tickets)])

export const gruposDe = config => (
  Array.isArray(config?.gruposImpresion) && config.gruposImpresion.length ? conDirecta(config.gruposImpresion) : GRUPOS_BASE
)
export const gruposDeComanda = config => gruposDe(config).filter(g => !g.tickets)
export const grupoTickets = config => gruposDe(config).find(g => g.tickets) || null

// Una sección puede mandar su comanda a varios grupos a la vez; el valor guardado admite
// `'cocina'` (una) o `['cocina','barra']` (varias), y sin asignación válida cae en el primer grupo.
export function gruposDeSeccion(config, seccionId) {
  const lista = gruposDeComanda(config)
  const guardado = config?.impresoraPorSeccion?.[seccionId]
  const ids = Array.isArray(guardado) ? guardado : (guardado ? [guardado] : [])
  const elegidos = []
  for (const id of ids) {
    const g = lista.find(x => x.id === String(id).toLowerCase())
    if (g && !elegidos.includes(g)) elegidos.push(g)
  }
  return elegidos.length ? elegidos : lista.slice(0, 1)
}
export const grupoDeSeccion = (config, seccionId) => gruposDeSeccion(config, seccionId)[0] || null
export const nombreDeArea = (config, id, respaldo) => gruposDeComanda(config).find(g => g.id === id)?.nombre || respaldo || id

export const SIN_AREA = '_sin_area'

export function areasDelItem(item, productos = []) {
  if (Array.isArray(item?.areas) && item.areas.length) return item.areas
  const prod = productos.find(p => p.id === item?.productoId)
  return Array.isArray(prod?.areas) && prod.areas.length ? prod.areas : null
}

function gruposDelItem(item, productos = [], config = {}) {
  const lista = gruposDeComanda(config)
  const validos = []
  const vistos = new Set()
  const agregar = id => {
    const g = lista.find(x => x.id === String(id).toLowerCase())
    if (g && !vistos.has(g.id)) { vistos.add(g.id); validos.push(g) }
  }
  const areas = areasDelItem(item, productos)
  if (areas) areas.forEach(agregar)
  if (validos.length) return validos
  const prod = productos.find(p => p.id === item?.productoId)
  return gruposDeSeccion(config, prod?.seccionId)
}

export function repartirPorGrupo(items, productos, config) {
  const porGrupo = new Map()
  items.forEach(i => {
    gruposDelItem(i, productos, config).forEach(g => {
      if (!porGrupo.has(g.id)) porGrupo.set(g.id, { grupo: g, items: [] })
      porGrupo.get(g.id).items.push(i)
    })
  })
  return gruposDeComanda(config).map(g => porGrupo.get(g.id)).filter(Boolean)
}

export const slugGrupo = nombre => (String(nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'grupo')

export function opcionesDeGrupo(config, grupoId) {
  const g = gruposDe(config).find(x => x.id === String(grupoId)) || {}
  return {
    grupo: g,
    copias: Math.min(3, Math.max(1, Number(g.copias) || 1)),
    pie: String(g.pie || '').trim().slice(0, 120),
    corte: g.corte !== false,
  }
}
