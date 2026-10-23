// Las subcuentas de una mesa (2a, 2b, 2c) y su unión.
// La letra solo significa algo mientras hay más de una cuenta abierta en la mesa: al unir 2a con 2b
// la absorbida desaparece y la que queda vuelve a llamarse como la mesa, sin letra.

// Une cuentas: la que queda recibe los ítems, los abonos, las mesas y los comensales de las demás.
// Las absorbidas se van de la lista: no quedan «cerradas con nota», porque en la mesa sobraba su letra.
export function unirCuentas(cuentas = [], cuentaId, absorbidas = [], extraMesas = []) {
  const base = cuentas.find(c => c.id === cuentaId)
  const ids = absorbidas.map(x => x.id).filter(id => id !== cuentaId)
  if (!base || (!ids.length && !extraMesas.length)) return cuentas
  const mesaIds = [...new Set([...(base.mesaIds || []), ...extraMesas, ...absorbidas.flatMap(y => y.mesaIds || [])])]
  const fuera = cuentas.filter(c => !ids.includes(c.id))
  const sola = !fuera.some(x => x.id !== cuentaId && x.estado !== 'cerrada'
    && (x.mesaIds || []).some(m => mesaIds.includes(m)))
  const comensales = Math.min(99, (base.comensales || 1) + absorbidas.reduce((t, x) => t + (x.comensales || 1), 0))
  const fusionada = {
    ...base,
    mesaIds,
    comensales,
    etiqueta: sola ? '' : (base.etiqueta || ''),
    items: [...(base.items || []), ...absorbidas.flatMap(y => y.items || [])],
    pagos: [...(base.pagos || []), ...absorbidas.flatMap(y => y.pagos || [])],
  }
  return fuera.map(c => (c.id === cuentaId ? fusionada : c))
}
