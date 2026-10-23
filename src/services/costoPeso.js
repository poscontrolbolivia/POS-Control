// Costo por peso para productos SIN receta (cortes que se venden por gramo: punta de asado,
// matambre, vacío). El negocio paga Bs X por kilo y cada plato lleva Y gramos:
// costo = precioKg / 1000 * gramos, redondeado a 2 decimales. Sin dependencias de React.
import { numMonto, round2 } from './format.js'

// null si falta alguno de los dos o no es > 0: así los campos vacíos no rompen el costo escrito a mano.
export const costoPorPeso = (precioKg, gramos) => {
  const pk = numMonto(precioKg)
  const g = numMonto(gramos)
  if (!pk || !g) return null
  return round2(pk / 1000 * g)
}

// ¿El producto tiene receta? Las recetas del store usan { productoId, insumo_id, cantidad },
// igual que en demo y en el servidor. Con receta manda el costo de la receta (costos_desde_receta
// lo escribe en la fila de costos; nunca se suma); sin receta manda el cálculo por peso.
export const tieneReceta = (recetas, productoId) =>
  productoId != null && (recetas || []).some(r => r.productoId === productoId && r.insumo_id && numMonto(r.cantidad) > 0)
