// «Cancelar edición» del mapa: el mapa guarda cada cambio al instante, así que descartar es DESHACER.
// Esta función compara cómo estaba el salón al entrar a editar con cómo está ahora y devuelve las
// acciones del store que lo dejan igual que antes. El orden importa por la base de datos:
//   1) volver a crear los salones borrados   2) mesas: recrear / restaurar campos / borrar las nuevas
//   3) borrar los salones nuevos (ya sin mesas)   4) restaurar nombre y orden de los salones.
const CAMPOS_MESA = ['nombre', 'zona', 'x', 'y', 'w', 'h', 'forma', 'cap']
const distinto = (a, b) => (a ?? null) !== (b ?? null)

export function accionesDescartar(antes, ahora) {
  const acc = []
  const idsDe = lista => new Map((lista || []).map(x => [x.id, x]))
  const mesasAntes = idsDe(antes.mesas), mesasAhora = idsDe(ahora.mesas)
  const zonasAntes = idsDe(antes.zonas), zonasAhora = idsDe(ahora.zonas)

  ;(antes.zonas || []).forEach(z => { if (!zonasAhora.has(z.id)) acc.push({ t: 'zona+', zona: { ...z } }) })

  ;(antes.mesas || []).forEach(m => {
    const n = mesasAhora.get(m.id)
    if (!n) { acc.push({ t: 'mesa+', mesa: { ...m } }); return }
    const cambios = {}
    CAMPOS_MESA.forEach(k => { if (distinto(n[k], m[k])) cambios[k] = m[k] ?? null })
    if (Object.keys(cambios).length) acc.push({ t: 'mesa~', id: m.id, cambios })
  })
  ;(ahora.mesas || []).forEach(m => { if (!mesasAntes.has(m.id)) acc.push({ t: 'mesa-', id: m.id }) })

  ;(ahora.zonas || []).forEach(z => { if (!zonasAntes.has(z.id)) acc.push({ t: 'zona-', id: z.id }) })

  ;(antes.zonas || []).forEach(z => {
    const n = zonasAhora.get(z.id)
    // Un salón recreado vuelve con el orden que le asigne la base: se restaura siempre.
    if (!n || distinto(n.nombre, z.nombre) || distinto(n.orden, z.orden)) acc.push({ t: 'zona~', id: z.id, cambios: { nombre: z.nombre, orden: z.orden } })
  })
  return acc
}
