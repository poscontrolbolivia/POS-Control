// Grupos de impresión (Cocina, Barra, Caja…) y reparto de la comanda por grupo.
// Todo vive en `config` (empresas.config jsonb en Supabase, localStorage en demo), así que no
// hace falta migrar la base:
//   config.gruposImpresion   = [{ id, nombre, ancho (32|48), baud, tickets? }]
//   config.impresoraPorSeccion = { [seccionId]: grupoId }   ← se edita al crear/editar la sección
// Un grupo con `tickets:true` (Caja) recibe tickets/pre-cuentas; no se asigna a secciones.

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

/** Grupo al que va una sección: el elegido, o el primero de comanda si no hay ninguno asignado. */
export function grupoDeSeccion(config, seccionId) {
  const lista = gruposDeComanda(config)
  const id = config?.impresoraPorSeccion?.[seccionId]
  return lista.find(g => g.id === id) || lista[0] || null
}

/**
 * Reparte items pendientes por grupo de impresión según la sección de cada producto.
 * Devuelve [{ grupo, items }] en el orden de los grupos (solo los que tienen algo que imprimir).
 */
export function repartirPorGrupo(items, productos, config) {
  const porGrupo = new Map()
  items.forEach(i => {
    const prod = productos.find(p => p.id === i.productoId)
    const g = grupoDeSeccion(config, prod?.seccionId)
    if (!g) return
    if (!porGrupo.has(g.id)) porGrupo.set(g.id, { grupo: g, items: [] })
    porGrupo.get(g.id).items.push(i)
  })
  return gruposDeComanda(config).map(g => porGrupo.get(g.id)).filter(Boolean)
}

export const slugGrupo = nombre => (String(nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'grupo')
