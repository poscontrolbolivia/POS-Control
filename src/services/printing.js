export const GRUPOS_BASE = [
  { id: 'cocina', nombre: 'Cocina', ancho: 32, baud: 9600 },
  { id: 'barra', nombre: 'Barra', ancho: 32, baud: 9600 },
  { id: 'caja', nombre: 'Caja (tickets)', ancho: 32, baud: 9600, tickets: true },
]

export const gruposDe = config => (
  Array.isArray(config?.gruposImpresion) && config.gruposImpresion.length ? config.gruposImpresion : GRUPOS_BASE
)
export const gruposDeComanda = config => gruposDe(config).filter(g => !g.tickets)
export const grupoTickets = config => gruposDe(config).find(g => g.tickets) || null

export function grupoDeSeccion(config, seccionId) {
  const lista = gruposDeComanda(config)
  const id = config?.impresoraPorSeccion?.[seccionId]
  return lista.find(g => g.id === id) || lista[0] || null
}

export const areasDeComanda = config => gruposDeComanda(config).map(g => g.id)
export const nombreDeArea = (config, id, respaldo) => gruposDeComanda(config).find(g => g.id === id)?.nombre || respaldo || id

export const SIN_AREA = '_sin_area'

export function areasDelItem(item, productos = []) {
  if (Array.isArray(item?.areas) && item.areas.length) return item.areas
  const prod = productos.find(p => p.id === item?.productoId)
  return Array.isArray(prod?.areas) && prod.areas.length ? prod.areas : null
}

export function gruposDelItem(item, productos = [], config = {}) {
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
  const g = grupoDeSeccion(config, prod?.seccionId)
  return g ? [g] : []
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
