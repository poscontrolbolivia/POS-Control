// Listas de indicaciones («Término de carne», «Salsas»…). Se guardan en empresas.config.indicaciones (jsonb).
// Lista: { id, nombre, obligatoria, max, opciones: string[], secciones: id[], productos: id[] }
//  - obligatoria: cada unidad pedida debe elegir al menos 1 opción de la lista.
//  - max: cuántas opciones puede elegir cada unidad (0 = sin límite).
// Las «opciones» sueltas antiguas del producto (p.opciones) se tratan como una lista opcional sin límite.
export const MAX_NOTA = 120

export const listasConfig = config => (Array.isArray(config?.indicaciones) ? config.indicaciones : [])

export function listasDe(config, producto) {
  if (!producto) return []
  const propias = listasConfig(config).filter(l =>
    (l.productos || []).includes(producto.id) || (l.secciones || []).includes(producto.seccionId))
  const sueltas = (producto.opciones || []).length
    ? [{ id: `_op_${producto.id}`, nombre: '', obligatoria: false, max: 0, opciones: producto.opciones, legacy: true }]
    : []
  return [...propias, ...sueltas]
}

export const minDe = l => (l.obligatoria ? Math.max(1, Number(l.min) || 0) : 0)
export const maxDe = l => (Number(l.max) > 0 ? Number(l.max) : Infinity)

// Detalle por opción: l.detalle[opcion] = { extra: número (precio extra), producto_id: uuid (descuenta su receta del inventario) }
export const extraDe = (l, o) => Math.max(0, Number(l.detalle?.[o]?.extra) || 0)
export const extraDeUnidad = (listas, u) => listas.reduce((t, l) => t + (u.sel[l.id] || []).reduce((a, o) => a + extraDe(l, o), 0), 0)
// Lo que se manda al servidor: solo lista y opción (el servidor calcula precio e inventario desde la configuración).
export const selDeUnidad = (listas, u) => listas.filter(l => !l.legacy).flatMap(l => (u.sel[l.id] || []).map(o => ({ l: l.id, o })))

// Una unidad cumple una lista si eligió entre min y max opciones.
export const cumple = (l, elegidas) => (elegidas || []).length >= minDe(l) && (elegidas || []).length <= maxDe(l)

export function notaDeUnidad(listas, unidad) {
  const partes = listas.flatMap(l => unidad.sel[l.id] || [])
  if (unidad.texto?.trim()) partes.push(unidad.texto.trim())
  return partes.join(', ').slice(0, MAX_NOTA)
}

export const nuevaLista = () => ({ nombre: '', obligatoria: true, max: 1, opciones: [], secciones: [], productos: [] })

export const parsearOpcionesLista = txt =>
  [...new Set(String(txt || '').split(/[,;\n]/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 40)
