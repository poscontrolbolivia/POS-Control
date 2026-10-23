// La tanda de Despacho: contadores rojos, la cola de mostrador que el servidor no devuelve,
// la comanda en texto plano y el borrado de un salón con mesas adentro.
// Todo se prueba sobre los módulos puros (sin React ni navegador) y con el idioma real (es.json).
import { readFileSync } from 'node:fs'
import { gruposDe, grupoDeSeccion, gruposDeComanda, repartirPorGrupo, GRUPO_DIRECTA } from '../src/services/printing.js'
import { pendientesPorGrupo, mostradorPendientes, badgeDirecta } from '../src/services/despacho.js'
import { lineasComanda, camposComanda, tituloComanda } from '../src/services/comanda.js'
import { planZonaBorrar, accionesBorrarZona, destinoValido, SIN_SALON, BORRAR_MESAS } from '../src/services/salon.js'

let mal = 0
const ok = (n, c) => { if (!c) { mal++; console.log('✗', n) } else console.log('✓', n) }
const eq = (n, a, b) => ok(`${n} (${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b))

// ── El texto real del negocio, no un diccionario inventado por el test ──
const ES = JSON.parse(readFileSync(new URL('../src/i18n/locales/es.json', import.meta.url), 'utf8'))
const tr = (clave, params) => Object.entries(params || {}).reduce(
  (s, [k, v]) => s.replaceAll(`{${k}}`, v), ES[clave] ?? `{${clave}}`)

// ── 1 · El grupo «Venta directa» aparece solo, sin tocar la base ni el config guardado ──
const guardados = [
  { id: 'cocina', nombre: 'Cocina' },
  { id: 'barra', nombre: 'Barra' },
  { id: 'caja', nombre: 'Caja', tickets: true },
]
const cfg = { gruposImpresion: guardados, impresoraPorSeccion: { sc: 'cocina', sd: GRUPO_DIRECTA } }
eq('grupos: se añade Venta directa sin duplicar', gruposDe(cfg).map(g => g.id), ['cocina', 'barra', GRUPO_DIRECTA, 'caja'])
eq('grupos: idempotente si ya venía guardado', gruposDe({ gruposImpresion: gruposDe(cfg) }).map(g => g.id), ['cocina', 'barra', GRUPO_DIRECTA, 'caja'])
eq('grupos: los de tickets quedan al final', gruposDeComanda(cfg).map(g => g.id), ['cocina', 'barra', GRUPO_DIRECTA])
ok('una sección sin asignación sigue cayendo en Cocina', grupoDeSeccion(cfg, 'nada')?.id === 'cocina')

// ── 2 · Contadores: solo lo enviado, solo en cuentas vivas, repartido por grupo ──
const prod = [
  { id: 'p1', seccionId: 'sc', nombre: 'Milanesa' },
  { id: 'p2', seccionId: 'sc', nombre: 'Limonada' },
  { id: 'p3', seccionId: 'sd', nombre: 'Juguete' },
]
const it = (id, productoId, estado) => ({ id, productoId, estado, qty: 1, nombre: prod.find(p => p.id === productoId).nombre })
const abierta = { id: 'c1', estado: 'abierta', tipo: 'mesa', items: [it('i1', 'p1', 'enviado'), it('i2', 'p1', 'enviado'), it('i3', 'p2', 'pendiente'), it('i4', 'p3', 'enviado')] }
const cerrada = { id: 'c2', estado: 'cerrada', tipo: 'mesa', items: [it('i5', 'p1', 'enviado')] }
const contar = pendientesPorGrupo([abierta, cerrada], prod, cfg)
eq('badge: cuenta por ítem enviado de cada grupo', [contar.cocina, contar[GRUPO_DIRECTA]], [2, 1])
ok('badge: la cuenta cerrada no suma en su área', contar.cocina === 2)
ok('badge: toda área conocida tiene clave, aunque sea 0', gruposDeComanda(cfg).every(g => contar[g.id] !== undefined))
ok('badge: una barra vacía marca 0, no undefined', contar.barra === 0)

// ── 3 · El mostrador cobrado no está en la cola del servidor: lo arma el cliente ──
const mostradorCerrada = {
  id: 'c3', estado: 'cerrada', tipo: 'directa', numero: 12, abiertaPor: 'Ana', cerradaEn: 500, abiertaEn: 100,
  items: [it('i6', 'p1', 'enviado'), it('i7', 'p3', 'enviado'), it('i8', 'p1', 'listo')],
}
const llevar = { id: 'c4', estado: 'cerrada', tipo: 'directa', canal: 'llevar', items: [it('i9', 'p1', 'enviado')] }
const mesaCerrada = { id: 'c5', estado: 'cerrada', tipo: 'mesa', mesaIds: ['m1'], items: [it('i10', 'p1', 'enviado')] }
const vieja = { id: 'c0', estado: 'cerrada', tipo: 'directa', abiertaEn: 50, items: [it('ia', 'p2', 'enviado')] }
const cola = mostradorPendientes([mesaCerrada, mostradorCerrada, llevar, vieja])
eq('cola de mostrador: solo venta directa, una fila por cuenta', cola.map(f => f.cuenta_id), ['c0', 'c3'])
eq('fila con la forma que pinta la pantalla', [cola[1].area, cola[1].mesa, cola[1].canal, cola[1].abiertaPor], [GRUPO_DIRECTA, '#12', 'mostrador', 'Ana'])
eq('los ítems ya listos no se vuelven a pedir', cola[1].items.map(i => i.id), ['i6', 'i7'])
ok('la hora de la fila es la del cobro', cola[1].enviada_en === 500 && cola[1].lote === 500)
ok('una cuenta de mostrador sin nada por sacar no aparece', mostradorPendientes([{ ...mostradorCerrada, items: [] }]).length === 0)

// Badge de la pestaña: lo del mostrador + lo de cuentas abiertas routed al grupo, sin contar dos veces.
eq('badge directa: sin duplicar el mismo ítem', badgeDirecta([abierta, mostradorCerrada], prod, cfg), 3)
eq('badge directa: una cuenta sin nada por entregar suma 0', badgeDirecta([cerrada], prod, cfg), 0)
const repartido = repartirPorGrupo([it('i6', 'p1', 'enviado')], prod, cfg)
eq('reparto: un ítem sale en su grupo', repartido.map(x => x.grupo.id), ['cocina'])

// ── 4 · La comanda en texto plano: salón, mesa, enviado por, hora y el pedido ──
const titulos = tituloComanda('Cocina', tr)
eq('título en mayúsculas con el área', titulos, 'COMANDA · COCINA')
ok('sin área el título queda solo', tituloComanda('', tr) === 'COMANDA')
eq('los cuatro campos, en orden fijo', camposComanda({ salon: 'Patio', mesa: '3', enviadoPor: 'Beto', en: 0 }).map(c => c.clave),
  ['comanda.salon', 'comanda.mesa', 'comanda.enviado', 'comanda.hora'])
eq('sin salón ni mesero: solo mesa y hora', camposComanda({ mesa: '7', en: 0 }).map(c => c.clave), ['comanda.mesa', 'comanda.hora'])
ok('la mesa nunca queda vacía', camposComanda({ en: 0 })[0].params.v === '—')
const lineas = lineasComanda({
  items: [{ qty: 2, nombre: 'Milanesa', nota: 'Sin cebolla' }, { qty: 1, nombre: 'Limonada' }],
  areaNombre: 'Cocina', salon: 'Patio', mesa: '3', enviadoPor: 'Beto', en: 0, tr, ancho: 32,
})
const texto = lineas.map(l => l.texto)
eq('cabecera: área, salón, mesa y quién envió', texto.slice(0, 5), ['COMANDA · COCINA', '', 'SALÓN: Patio', 'MESA: 3', 'ENVIADO POR: Beto'])
ok('la hora va escrita, no un timestamp', /^HORA: \d{2}:\d{2}/.test(texto[5]))
eq('el pedido: cantidad x nombre y la nota', texto.slice(7), ['2 x Milanesa', '    ** Sin cebolla **', '1 x Limonada'])
ok('cada renglón entra en el ancho de la impresora', lineasComanda({ items: [{ qty: 9, nombre: 'X'.repeat(90) }], tr, ancho: 32 })
  .every(l => l.texto.length <= 32))
const vacia = lineasComanda({ items: [], tr })
ok('comanda sin pedido avisa en vez de imprimir nada', vacia.some(l => l.texto === 'Sin pedidos' && l.centrado))
ok('el separador va marcado como guion', lineasComanda({ items: [], tr }).filter(l => l.guion).length === 2)
ok('las líneas del pedido van en negrita', lineasComanda({ items: [{ qty: 1, nombre: 'Té' }], tr }).slice(-1)[0].negrita === true)

// ── 5 · Eliminar un salón: nunca mesas huérfanas, nunca una cuenta colgando ──
const zonas = [{ id: 'z1', nombre: 'Patio' }, { id: 'z2', nombre: 'Terraza' }]
const mesas = [{ id: 'm1', zona: 'z1', nombre: '1' }, { id: 'm2', zona: 'z1', nombre: '2' }, { id: 'm9', zona: 'z2', nombre: '9' }]
const conCuenta = [{ id: 'ca', estado: 'abierta', mesaIds: ['m2'] }]
eq('salón vacío: se borra directo', planZonaBorrar({ zona: zonas[0], mesas: [], cuentas: [], zonas }).modo, 'vacio')
eq('salón con mesas libres: pide destino', planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas }).modo, 'mover')
eq('salón con mesas ocupadas: bloqueado', planZonaBorrar({ zona: zonas[0], mesas, cuentas: conCuenta, zonas }).modo, 'bloqueado')
eq('no borra mesas de otro salón', planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas }).mesas.map(m => m.id), ['m1', 'm2'])
eq('una cuenta cerrada no bloquea', planZonaBorrar({ zona: zonas[0], mesas, cuentas: [{ id: 'x', estado: 'cerrada', mesaIds: ['m1'] }], zonas }).modo, 'mover')
eq('bloqueado no dispara acciones', accionesBorrarZona(planZonaBorrar({ zona: zonas[0], mesas, cuentas: conCuenta, zonas })), [])
eq('primero las mesas, al final el salón', accionesBorrarZona(planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas })).map(a => a.t), ['mesa~', 'mesa~', 'zona-'])
const aSinSalon = accionesBorrarZona(planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas }), SIN_SALON)
eq('sin salón: las mesas quedan sueltas y después se borra el salón', aSinSalon, [
  { t: 'mesa~', id: 'm1', cambios: { zona: null } },
  { t: 'mesa~', id: 'm2', cambios: { zona: null } },
  { t: 'zona-', id: 'z1' },
])
eq('a otro salón', accionesBorrarZona(planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas }), 'z2').filter(a => a.t === 'mesa~').every(a => a.cambios.zona === 'z2'), true)
eq('eliminando las mesas también', accionesBorrarZona(planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas }), BORRAR_MESAS).map(a => a.t), ['mesa-', 'mesa-', 'zona-'])
const plan = planZonaBorrar({ zona: zonas[0], mesas, cuentas: [], zonas })
eq('destinos aceptados', [destinoValido(plan, SIN_SALON), destinoValido(plan, BORRAR_MESAS), destinoValido(plan, 'z2'), destinoValido(plan, 'z1'), destinoValido(plan, 'no-existe')],
  [true, true, true, false, false])

console.log(mal ? `\n${mal} fallo(s)` : '\ntodo OK')
process.exit(mal ? 1 : 0)
