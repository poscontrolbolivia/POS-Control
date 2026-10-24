import { gruposDeComanda, repartirPorGrupo, areasDelItem, GRUPO_DIRECTA } from './printing.js'

// Lógica de Despacho separada de la pantalla: lo que cuenta el badge rojo de cada pestaña y lo
// que hay que entregar del mostrador. Está acá para poder probarla sin navegador.

// Un ítem «enviado» es el que todavía falta sacar; «listo» ya salió y «pendiente» aún no es comanda.
export const POR_SACAR = 'enviado'

// Un plato que sale a cocina y barra a la vez se saca de un área y del área que falta sigue debiendo.
// Como el `estado` del ítem es global (pasa a «listo» recién cuando salieron TODAS), el badge no puede
// mirar el estado: mira qué áreas del ítem todavía no tienen salida. Si ya salió de todas, no cuenta.
function porSacarPorArea(item, productos) {
  const areas = areasDelItem(item, productos)
  if (!areas) return [item]
  const listas = item.areasListas || []
  const quedan = areas.filter(x => !listas.includes(x))
  if (quedan.length === areas.length) return [item]
  return quedan.length ? [{ ...item, areas: quedan }] : []
}

// Contador por área: ítems que faltan sacar de cada grupo de comanda, en cuentas abiertas.
// Se calcula sobre el store (en Supabase trae las cuentas del turno abierto), así los badges no
// obligan a pedir la cola de cada área cada pocos segundos.
export function pendientesPorGrupo(cuentas, productos, config) {
  const out = {}
  gruposDeComanda(config).forEach(g => { out[g.id] = 0 })
  ;(cuentas || []).filter(c => c.estado !== 'cerrada').forEach(c => {
    const vivos = (c.items || []).filter(i => i.estado === POR_SACAR).flatMap(i => porSacarPorArea(i, productos || []))
    if (!vivos.length) return
    repartirPorGrupo(vivos, productos || [], config).forEach(({ grupo, items }) => {
      out[grupo.id] = (out[grupo.id] || 0) + items.length
    })
  })
  return out
}

// La venta directa se cobra y la cuenta se cierra al instante: el servidor ya no la devuelve en
// la cola de un área, pero el producto sigue sin entregarse. Estas filas son ésas, y tienen la
// misma forma que una fila de cola para que la pantalla las pinte y las marque igual.
export function mostradorPendientes(cuentas) {
  return (cuentas || [])
    .filter(c => c.tipo === 'directa' && c.canal !== 'llevar')
    .map(c => {
      const en = c.cerradaEn || c.abiertaEn || null
      // Un plato de mostrador que también va a cocina puede estar servido en el área de entrega y
      // seguir «enviado» en el estado global: ahí ya no queda nada que entregar.
      const items = (c.items || []).filter(i => i.estado === POR_SACAR && !(i.areasListas || []).includes(GRUPO_DIRECTA)).map(i => ({
        id: i.id, nombre: i.nombre, qty: i.qty, nota: i.nota || '', estado: POR_SACAR,
        areas: i.areas || [], enviada_en: i.enviadoEn || en, listo_en: null,
      }))
      return items.length ? {
        cuenta_id: c.id, area: GRUPO_DIRECTA, mesa: c.numero ? `#${c.numero}` : (c.clienteNombre || ''),
        etiqueta: '', comensales: 0, canal: 'mostrador', abiertaPor: c.abiertaPor || '',
        enviada_en: en, lote: en, items,
      } : null
    })
    .filter(Boolean)
    .sort((a, b) => (a.enviada_en || 0) - (b.enviada_en || 0))
}

// Contador rojo de la pestaña «Venta directa»: lo que falta entregar de ahí. Son dos orígenes que
// se solapan (un ítem de mostrador abierto también lo cuenta su área por estar routed al grupo),
// así que se juntan por id para no contar dos veces el mismo plato.
export function badgeDirecta(cuentas = [], productos = [], config = {}) {
  const ids = new Set()
  mostradorPendientes(cuentas).forEach(f => (f.items || []).forEach(i => ids.add(i.id)))
  cuentas.filter(c => c.estado !== 'cerrada').forEach(c => {
    const vivos = (c.items || []).filter(i => i.estado === POR_SACAR).flatMap(i => porSacarPorArea(i, productos))
    if (!vivos.length) return
    repartirPorGrupo(vivos, productos, config).forEach(({ grupo, items }) => {
      if (grupo.id === GRUPO_DIRECTA) items.forEach(i => ids.add(i.id))
    })
  })
  return ids.size
}

// Suma de los contadores de todas las ventanas de Despacho (cocina, barra, entrega...) para el botón del menú.
// «Entrega» se cuenta una sola vez: sus ítems también aparecen en el reparto por grupo.
export function totalDespacho(cuentas = [], productos = [], config = {}) {
  const por = pendientesPorGrupo(cuentas, productos, config)
  const sinDirecta = Object.entries(por).filter(([id]) => id !== GRUPO_DIRECTA).reduce((a, [, n]) => a + n, 0)
  return sinDirecta + badgeDirecta(cuentas, productos, config)
}
