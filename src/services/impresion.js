// Grupos de impresión (Cocina, Barra, Caja…) y reparto de la comanda por grupo.
// Todo vive en `config` (empresas.config jsonb en Supabase, localStorage en demo), así que no
// hace falta migrar la base:
//   config.gruposImpresion   = [{ id, nombre, ancho (32|48), baud, tickets? }]
//   config.impresoraPorSeccion = { [seccionId]: grupoId }   ← se edita al crear/editar la sección
// Un grupo con `tickets:true` (Caja) recibe tickets/pre-cuentas; no se asigna a secciones.
// Además, cada producto puede listar varias ÁREAS de impresión (`productos.areas` y su snapshot
// en `cuenta_items.areas`, p. ej. ['cocina','barra'] para un combo): al enviar, el ítem sale
// simultáneamente por la impresora de cada grupo. Sin `areas`, manda la sección (modos viejos).

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
 * Áreas por producto (columna `productos.areas` / snapshot `cuenta_items.areas` en Supabase).
 * Un combo puede ir a VARIOS grupos a la vez; en modo demo los productos viejos no traen
 * `areas` y caen al reparto clásico por sección.
 */
// v0.18: las áreas ya no son fijas. Son los grupos de comanda de la empresa (Configuración → Impresoras):
// crear «Heladería» ahí la vuelve casilla del producto, impresora propia y vista en la pantalla de cocina.
export const areasDeComanda = config => gruposDeComanda(config).map(g => g.id)
export const nombreDeArea = (config, id, respaldo) => gruposDeComanda(config).find(g => g.id === id)?.nombre || respaldo || id
/** Id reservado: vista de cocina para ítems cuya área ya no existe (área borrada). */
export const SIN_AREA = '_sin_area'

/** Áreas efectivas de un ítem: snapshot del ítem → áreas del producto → null (fallback por sección). */
export function areasDelItem(item, productos = []) {
  if (Array.isArray(item?.areas) && item.areas.length) return item.areas
  const prod = productos.find(p => p.id === item?.productoId)
  return Array.isArray(prod?.areas) && prod.areas.length ? prod.areas : null
}

/**
 * Grupos de comanda a los que va un ítem (puede devolver VARIOS: combo cocina+barra).
 * Prioridad: `areas` del ítem/producto (ignorando áreas desconocidas sin crashear) y, si no
 * hay ninguna válida, el grupo de su sección (`config.impresoraPorSeccion` → `grupoDeSeccion`).
 */
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

/**
 * Reparte items pendientes por grupo de impresión. Un ítem con `areas` de más de un valor
 * aparece en TODOS sus grupos (cocina y barra a la vez); sin `areas` vale la sección.
 * Devuelve [{ grupo, items }] en el orden de los grupos (solo los que tienen algo que imprimir).
 */
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
