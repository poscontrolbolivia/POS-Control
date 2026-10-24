// Geometría ÚNICA del mapa de mesas. Salón, Caja y Venta directa dibujan el mismo mapa con estas
// mismas reglas (proporción, tamaño de mesa y zoom), así que un cambio hecho en Salón se ve igual
// en los tres sitios. Las posiciones (x, y, w, h, forma) salen de la misma lista de mesas.
export const W = 1000
export const H = 600
export const ASP_BASE = W / H
export const ASP_MAX = 2.6
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 2.5
export const ZOOM_PASO = 0.25
export const CLAVE_ZOOM = 'pos-salon-zoom'

// Zoom que el usuario dejó en el Salón para este negocio (en la demo no hay empresa real: clave «demo»).
export function leerZoom(claveEmpresa) {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_ZOOM) || 'null')
    const z = guardado?.[claveEmpresa]
    return typeof z === 'number' && z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1
  } catch { return 1 }
}

// El mapa se ensancha para aprovechar la pantalla: más proporción horizontal, mesas del mismo tamaño.
// `bloque` es el contenedor `.lienzo-bloque`; devuelve la proporción o null si aún no se puede medir.
export function calcularAsp(bloque) {
  const area = bloque?.firstElementChild
  if (!bloque || !area || !bloque.clientWidth) return null
  const desc = parseFloat(getComputedStyle(area).getPropertyValue('--lienzo-descuento')) || 330
  const alto = Math.max(200, window.innerHeight - desc)
  const a = Math.max(ASP_BASE, Math.min(ASP_MAX, bloque.clientWidth / alto))
  return Math.round(a * 100) / 100
}

// Posición y tamaño de una mesa dentro del lienzo, en %. El ancho se compensa con la proporción
// para que las mesas no se estiren cuando el mapa se ensancha.
export const estiloMesa = (p, asp) => ({
  left: `${(p.x / W) * 100}%`,
  top: `${(p.y / H) * 100}%`,
  width: `${(p.w / W) * 100 * (ASP_BASE / asp)}%`,
  height: `${(p.h / H) * 100}%`,
})
