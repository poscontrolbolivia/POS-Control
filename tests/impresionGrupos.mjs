// Una sección puede mandar su comanda a varios grupos de impresión a la vez.
// El valor guardado admite la forma vieja (un id) y la nueva (array), sin migración.
import { gruposDeSeccion, grupoDeSeccion, repartirPorGrupo, areasDelItem } from '../src/services/printing.js'

let mal = 0
const ok = (n, c) => { if (!c) { mal++; console.log('✗', n) } else console.log('✓', n) }

const config = {
  gruposImpresion: [
    { id: 'cocina', nombre: 'Cocina' },
    { id: 'barra', nombre: 'Barra' },
    { id: 'parrilla', nombre: 'Parrilla' },
    { id: 'caja', nombre: 'Caja', tickets: true },
  ],
  impresoraPorSeccion: { s1: 'cocina', s2: ['cocina', 'barra'], s3: 'parrilla', s4: 'no-existe', s5: [] },
}
const item = (productoId, areas) => ({ id: 'i' + productoId, productoId, ...(areas ? { areas } : {}) })

ok('valor viejo de una impresora sigue funcionando', gruposDeSeccion(config, 's1').map(g => g.id).join() === 'cocina')
ok('varias impresoras a la vez', gruposDeSeccion(config, 's2').map(g => g.id).join() === 'cocina,barra')
ok('grupoDeSeccion devuelve la primera (compat)', grupoDeSeccion(config, 's2')?.id === 'cocina')
ok('id inexistente cae en el primer grupo', gruposDeSeccion(config, 's4').map(g => g.id).join() === 'cocina')
ok('array vacío cae en el primer grupo', gruposDeSeccion(config, 's5').map(g => g.id).join() === 'cocina')
ok('los grupos de tickets no son comanda', !gruposDeSeccion(config, 's1').some(g => g.tickets))

const productos = [{ id: 'p1', seccionId: 's2' }, { id: 'p2', seccionId: 's3' }]
const repartidos = repartirPorGrupo([item('p1'), item('p2')], productos, config)
const gruposDe = id => repartidos.filter(g => g.items.some(i => i.id === id)).map(g => g.grupo.id).join()
ok('el plato de una sola sección sale en un grupo', gruposDe('ip2') === 'parrilla')
ok('el plato de la sección con 2 grupos sale en los dos', gruposDe('ip1') === 'cocina,barra')

// El ítem que ya trae áreas elegidas a mano manda sobre lo de la sección.
const conAreas = item('p3', ['barra', 'parrilla'])
const mixto = repartirPorGrupo([conAreas], [{ id: 'p3', seccionId: 's1' }], config)
ok('las áreas del ítem mandan sobre la sección', mixto.map(g => g.grupo.id).join() === 'barra,parrilla')
ok('áreas del ítem para la pantalla', (areasDelItem(conAreas, []) || []).join() === 'barra,parrilla')

process.exit(mal ? 1 : 0)
