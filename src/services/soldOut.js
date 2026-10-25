const claveDia = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function agotadosHoy(config) {
  const raw = config?.agotados
  if (!raw || typeof raw !== 'object') return {}
  const dia = claveDia()
  const out = {}
  Object.entries(raw).forEach(([id, v]) => {
    if (v && v.en === dia) out[id] = { motivo: String(v.motivo || '').slice(0, 60), en: dia }
  })
  return out
}

export function conMarca(config, productoId, marca) {
  return conMarcas(config, [productoId], marca)
}

export function conMarcas(config, productoIds, marca) {
  const hoy = agotadosHoy(config)
  const dia = claveDia()
  productoIds.forEach(id => {
    if (marca) hoy[id] = { motivo: String(marca.motivo || '').slice(0, 60), en: dia }
    else delete hoy[id]
  })
  return hoy
}
