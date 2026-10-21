import { listasDe, cumple, notaDeUnidad, maxDe, extraDeUnidad, selDeUnidad, indicacionesDeUnidad, componerNota, comentarioDe, notaProtegida } from '../src/services/indicaciones.js'
let ok = 0, mal = 0
const ck = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n) } }
const cfg = { indicaciones: [
  { id: 'T', nombre: 'Término', obligatoria: true, max: 1, opciones: ['Azul', 'Medio'], secciones: ['parrilla'], productos: [] },
  { id: 'S', nombre: 'Salsas', obligatoria: false, max: 2, opciones: ['BBQ', 'Ajo', 'Picante'], secciones: [], productos: ['p1'] } ] }
const carne = { id: 'p1', seccionId: 'parrilla', opciones: [] }
const L = listasDe(cfg, carne)
ck('hereda del grupo y del producto', L.length === 2)
ck('otro producto del grupo solo término', listasDe(cfg, { id: 'p2', seccionId: 'parrilla' }).length === 1)
ck('sin listas', listasDe(cfg, { id: 'p3', seccionId: 'x' }).length === 0)
ck('opciones sueltas antiguas', listasDe(cfg, { id: 'p4', seccionId: 'x', opciones: ['a'] })[0].legacy === true)
ck('obligatoria exige 1', !cumple(L[0], []) && cumple(L[0], ['Azul']))
ck('max 1 rechaza 2', !cumple(L[0], ['Azul', 'Medio']))
ck('opcional acepta 0, rechaza 3', cumple(L[1], []) && !cumple(L[1], ['BBQ', 'Ajo', 'Picante']))
ck('sin límite = Infinity', maxDe({ max: 0 }) === Infinity)
ck('nota', notaDeUnidad(L, { sel: { T: ['Azul'], S: ['BBQ'] }, texto: 'sin sal' }) === 'Azul, BBQ, sin sal')
const C = { id: 'C', nombre: 'Gaseosa', obligatoria: true, min: 2, max: 2, opciones: ['Cola', 'Lima'], detalle: { Cola: { extra: 2, producto_id: 'x' } } }
ck('min 2 exacto', !cumple(C, ['Cola']) && cumple(C, ['Cola', 'Lima']) && !cumple(C, ['Cola', 'Lima', 'Cola']))
ck('extra por unidad', extraDeUnidad([C], { sel: { C: ['Cola', 'Lima'] } }) === 2)
ck('sel al servidor sin precios', JSON.stringify(selDeUnidad([C], { sel: { C: ['Cola'] } })) === '[{"l":"C","o":"Cola"}]')
// Indicaciones ≠ comentario: el comentario se edita, las indicaciones no se pueden borrar.
const u = { sel: { T: ['Azul'], S: ['BBQ'] }, texto: 'sin sal' }
const ind = indicacionesDeUnidad(L, u)
ck('indicaciones sin el comentario', ind === 'Azul, BBQ')
ck('la nota empieza con las indicaciones', notaDeUnidad(L, u).startsWith(ind))
ck('comentario = nota sin indicaciones', comentarioDe('Azul, BBQ, sin sal', ind) === 'sin sal')
ck('sin comentario queda vacío', comentarioDe('Azul, BBQ', ind) === '')
ck('compone indicaciones + comentario', componerNota(ind, 'poco hecha') === 'Azul, BBQ, poco hecha')
ck('comentario vacío conserva indicaciones', componerNota(ind, '  ') === 'Azul, BBQ')
ck('borrar todo el texto NO borra las indicaciones', notaProtegida(ind, '') === 'Azul, BBQ')
ck('texto sin las indicaciones se vuelve a anteponer', notaProtegida(ind, 'sin sal') === 'Azul, BBQ, sin sal')
ck('texto completo no duplica indicaciones', notaProtegida(ind, 'Azul, BBQ, sin sal') === 'Azul, BBQ, sin sal')
ck('ítem sin indicaciones: nota libre', notaProtegida('', 'sin cebolla') === 'sin cebolla' && notaProtegida('', '') === '')
console.log(`indicaciones: ${ok} ✓ ${mal} ✗`); process.exit(mal ? 1 : 0)
