import { agotadosHoy, estaAgotado, conMarca, conMarcas } from '../src/services/soldOut.js'

let fallos = 0
const ok = (cond, msg) => { if (!cond) { fallos++; console.error('  ✗', msg) } else console.log('  ✓', msg) }
const hoy = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const ayer = (() => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

console.log('agotado del día:')

ok(Object.keys(agotadosHoy(undefined)).length === 0, 'config sin agotados devuelve mapa vacío')
ok(Object.keys(agotadosHoy({ agotados: null })).length === 0, 'agotados null no rompe')

const conAyer = { agotados: { p1: { motivo: 'de ayer', en: ayer }, p2: { motivo: 'de hoy', en: hoy } } }
const mapa = agotadosHoy(conAyer)
ok(!mapa.p1, 'la marca de AYER no cuenta (se libera sola al cambiar el día)')
ok(mapa.p2?.motivo === 'de hoy', 'la marca de HOY se lee con su motivo')
ok(estaAgotado(conAyer, 'p2') && !estaAgotado(conAyer, 'p1'), 'estaAgotado solo ve los de hoy')

const marcado = conMarca({}, 'p3', { motivo: 'se acabó' })
ok(marcado.p3.en === hoy && estaAgotado({ agotados: marcado }, 'p3'), 'marcar guarda motivo y fecha de hoy')
ok(!estaAgotado({ agotados: conMarca(conAyer, 'p2', null) }, 'p2'), 'desmarcar quita solo ese producto')
ok(estaAgotado({ agotados: conMarca(conAyer, 'p2', null) }, 'p1') === false && Object.keys(conMarca(conAyer, 'p2', null)).length === 0,
  'al escribir se purgan también las marcas de otros días')

const varios = conMarcas({}, ['a', 'b', 'c'], { motivo: 'x' })
ok(Object.keys(varios).length === 3 && Object.values(varios).every(v => v.en === hoy), 'conMarcas aplica a varios en un solo mapa')
ok(Object.keys(conMarcas({ agotados: varios }, ['b'], null)).join() === 'a,c', 'conMarcas(null) desmarca solo los indicados')
ok(conMarca({}, 'z', { motivo: 'y'.repeat(200) }).z.motivo.length === 60, 'el motivo se corta a 60 letras')

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\ntodas las pruebas pasaron')
process.exit(fallos ? 1 : 0)
