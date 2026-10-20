export const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

// Un input type=number controlado devuelve "" en cuanto el texto es intermedio («19.», «,5»),
// React lo vacía y el teclado salta. Se escribe como texto y se limpia aquí.
// El último punto o coma es el decimal; los separadores de miles de antes se descartan.
export const limpiarMonto = txt => {
  const s = String(txt ?? '').replace(/[^0-9.,]/g, '')
  const dec = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  if (dec === -1) return s.replace(/[.,]/g, '')
  const ent = s.slice(0, dec).replace(/[.,]/g, '')
  return `${ent}.${s.slice(dec + 1).replace(/[.,]/g, '').slice(0, 2)}`
}

export const numMonto = txt => {
  const n = Number(String(txt ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const hora = (ts, { segundos = false } = {}) => {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(segundos ? { second: '2-digit' } : {}) })
  } catch { return '' }
}
