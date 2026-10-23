// Qué pasa con las mesas de un salón cuando el salón se elimina. Está separado de la pantalla
// porque es la parte que puede dejar mesas huérfanas o cuentas colgando, y hay que poder probarla.

export const SIN_SALON = 'sin'
export const BORRAR_MESAS = 'borrar'

export function planZonaBorrar({ zona, mesas = [], cuentas = [], zonas = [] }) {
  const propias = mesas.filter(m => m.zona === zona.id)
  const abiertas = cuentas.filter(c => c.estado !== 'cerrada')
  const ocupadas = propias.filter(m => abiertas.some(c => (c.mesaIds || []).includes(m.id)))
  const otras = zonas.filter(z => z.id !== zona.id)
  return {
    zonaId: zona.id,
    nombre: zona.nombre,
    mesas: propias,
    ocupadas,
    otras,
    // 'vacio' se borra directo; 'bloqueado' tiene mesas con cuenta abierta; 'mover' pide destino.
    modo: !propias.length ? 'vacio' : ocupadas.length ? 'bloqueado' : 'mover',
  }
}

// La secuencia de acciones que vacía el salón y después lo elimina. Primero las mesas, siempre:
// si no, la base deja las mesas sin zona (on delete set null) y quedan sueltas en «Todas».
export function accionesBorrarZona(plan, destino = SIN_SALON) {
  const out = []
  if (plan.modo === 'bloqueado') return out
  if (destino === BORRAR_MESAS) plan.mesas.forEach(m => out.push({ t: 'mesa-', id: m.id }))
  else plan.mesas.forEach(m => out.push({ t: 'mesa~', id: m.id, cambios: { zona: destino === SIN_SALON ? null : destino } }))
  out.push({ t: 'zona-', id: plan.zonaId })
  return out
}

export const destinoValido = (plan, destino) =>
  destino === BORRAR_MESAS || destino === SIN_SALON || plan.otras.some(z => z.id === destino)
