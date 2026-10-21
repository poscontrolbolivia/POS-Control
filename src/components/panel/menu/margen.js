// Funciones puras de costo/margen para la carta. El margen es sobre el precio de venta
// (margen = (precio - costo) / precio * 100), NO markup. Sin dependencias de React.
import { round2 } from '../../../services/format.js'

// Margen % sobre el precio. null si no hay datos suficientes (precio <= 0 o costo ausente/negativo).
// costo === 0 es válido y da 100 %; «sin costo» se representa con null/undefined en el store.
export const margenDe = (precio, costo) => {
  const p = Number(precio)
  const c = Number(costo)
  if (!Number.isFinite(p) || p <= 0) return null
  if (costo == null || costo === '' || !Number.isFinite(c) || c < 0) return null
  return ((p - c) / p) * 100
}

// Utilidad Bs = precio - costo. null si falta alguna de las dos.
export const utilidadDe = (precio, costo) => {
  const p = Number(precio)
  const c = Number(costo)
  if (costo == null || costo === '' || !Number.isFinite(p) || p < 0 || !Number.isFinite(c) || c < 0) return null
  return round2(p - c)
}

// Precio nuevo para lograr `margenPct` sobre el precio partiendo de `costo`:
// precio = costo / (1 - margen/100). null si costo <= 0 o el margen no está en (0, 100).
export const precioConMargen = (costo, margenPct) => {
  const c = Number(costo)
  const m = Number(margenPct)
  if (!Number.isFinite(c) || c <= 0) return null
  if (!Number.isFinite(m) || m <= 0 || m >= 100) return null
  return round2(c / (1 - m / 100))
}

// Vista previa local (modo demo) de la acción masiva «Margen %».
// productos: [{ id, nombre, precio }], costos: [{ productoId, costo, proveedorId }].
// Devuelve el mismo idioma que la RPC costos_margen_aplicar: sin_costo, total (afectados)
// y muestra con máximo 30 filas { producto_id, nombre, costo, antes, despues }.
export const simularMargen = (productos, costos, margenPct) => {
  const mapa = new Map((costos || []).map(x => [x.productoId, Number(x.costo)]))
  const m = Number(margenPct)
  let sin_costo = 0
  const muestra = []
  if (Number.isFinite(m) && m > 0 && m < 100) {
    (productos || []).forEach(p => {
      const costo = mapa.get(p.id)
      if (!Number.isFinite(costo) || costo <= 0) { sin_costo += 1; return }
      const despues = precioConMargen(costo, m)
      if (despues == null) { sin_costo += 1; return }
      muestra.push({ producto_id: p.id, nombre: p.nombre, costo, antes: Number(p.precio), despues })
    })
  }
  return { margen_pct: Number.isFinite(m) ? m : 0, sin_costo, total: muestra.length, muestra: muestra.slice(0, 30) }
}

// Banda de color según el margen (clases CSS de MenuPage.css). null → sin dato.
export const bandaMargen = margen => {
  if (margen == null || !Number.isFinite(margen)) return 'sin'
  if (margen < 25) return 'bjo'
  if (margen <= 50) return 'med'
  return 'alto'
}
