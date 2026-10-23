import { costoPorPeso, tieneReceta } from '../src/services/costoPeso.js'

let fallos = 0
const ok = (cond, msg) => { if (!cond) { fallos++; console.error('  ✗', msg) } else console.log('  ✓', msg) }

console.log('costo por peso (sin receta):')

ok(costoPorPeso(80, 350) === 28, 'Bs 80/kg × 350 g = Bs 28.00')
ok(costoPorPeso('80', '350') === 28, 'también lee los campos como texto')
ok(costoPorPeso('19.', '100') === 1.9, 'acepta la escritura intermedia «19.»')
ok(costoPorPeso('12,50', '400') === 5, 'coma decimal como en el resto de montos')
ok(costoPorPeso(33.33, 3) === 0.1, 'redondea el resultado a 2 decimales')
ok(costoPorPeso(0.001, 500) === 0, 'no devuelve decimales fantasma (round2)')

ok(costoPorPeso('', 350) === null, 'precio por kilo vacío = sin cálculo')
ok(costoPorPeso(80, '') === null, 'gramos vacíos = sin cálculo')
ok(costoPorPeso('', '') === null, 'ambos vacíos = sin cálculo')
ok(costoPorPeso(0, 350) === null, 'precio por kilo 0 no cuenta')
ok(costoPorPeso(80, 0) === null, '0 gramos no cuenta')
ok(costoPorPeso(null, undefined) === null, 'null/undefined no rompen')
ok(costoPorPeso(-80, 350) === null, 'precio negativo se ignora (numMonto no deja pasar signos)')
ok(costoPorPeso('abc', 350) === null, 'texto suelto en el kilo = sin cálculo')

console.log('tieneReceta:')

const recetas = [{ productoId: 'p1', insumo_id: 'ins1', cantidad: 0.35 }, { productoId: 'p2', insumo_id: '', cantidad: 1 }]
ok(tieneReceta(recetas, 'p1') === true, 'línea con insumo y cantidad > 0 cuenta como receta')
ok(tieneReceta(recetas, 'p2') === false, 'línea sin insumo no cuenta')
ok(tieneReceta(recetas, 'p3') === false, 'producto sin recetas no tiene')
ok(tieneReceta(recetas, null) === false, 'sin id de producto no tiene')
ok(tieneReceta(null, 'p1') === false, 'store sin recetas no rompe')
ok(tieneReceta([{ productoId: 'p1', insumo_id: 'ins1', cantidad: 0 }], 'p1') === false, 'cantidad 0 no cuenta')

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\ntodas las pruebas pasaron')
process.exit(fallos ? 1 : 0)
