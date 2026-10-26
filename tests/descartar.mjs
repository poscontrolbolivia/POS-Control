import assert from 'node:assert/strict'
import { accionesDescartar } from '../src/components/panel/hall/descartarEdicion.js'

const mesa = (id, extra = {}) => ({ id, nombre: id, zona: 'z1', x: 10, y: 10, w: 110, h: 110, forma: 'cuadrada', cap: 4, ...extra })
const antes = { zonas: [{ id: 'z1', nombre: 'Salón', orden: 1 }, { id: 'z2', nombre: 'Terraza', orden: 2 }], mesas: [mesa('m1'), mesa('m2', { zona: 'z2' })] }

// Sin cambios: nada que deshacer
assert.deepEqual(accionesDescartar(antes, antes), [])

// Mesa movida y renombrada: se restauran solo los campos tocados
let a = accionesDescartar(antes, { ...antes, mesas: [mesa('m1', { x: 80, nombre: 'X' }), antes.mesas[1]] })
assert.deepEqual(a, [{ t: 'mesa~', id: 'm1', cambios: { nombre: 'm1', x: 10 } }])

// Mesa creada: se borra. Mesa borrada: se vuelve a crear con su id
a = accionesDescartar(antes, { ...antes, mesas: [antes.mesas[0], mesa('nueva')] })
assert.deepEqual(a, [{ t: 'mesa+', mesa: antes.mesas[1] }, { t: 'mesa-', id: 'nueva' }])

// Salón nuevo con mesa nueva: primero la mesa, después el salón (orden de la base de datos)
a = accionesDescartar(antes, { zonas: [...antes.zonas, { id: 'z3', nombre: 'Patio', orden: 3 }], mesas: [...antes.mesas, mesa('m9', { zona: 'z3' })] })
assert.deepEqual(a.map(x => x.t + ':' + x.id), ['mesa-:m9', 'zona-:z3'])

// Salón borrado junto con sus mesas: primero el salón, luego las mesas, y se restaura su orden
a = accionesDescartar(antes, { zonas: [antes.zonas[0]], mesas: [antes.mesas[0]] })
assert.deepEqual(a.map(x => x.t + ':' + (x.id || x.zona?.id || x.mesa?.id)), ['zona+:z2', 'mesa+:m2', 'zona~:z2'])

// Salón renombrado y reordenado
a = accionesDescartar(antes, { ...antes, zonas: [{ id: 'z1', nombre: 'Otro', orden: 2 }, antes.zonas[1]] })
assert.deepEqual(a, [{ t: 'zona~', id: 'z1', cambios: { nombre: 'Salón', orden: 1 } }])

console.log('✓ descartar: cancelar edición del mapa deja el salón como estaba')
