// El ticket se mide, no se lo imagina: ningún renglón puede pasarse del ancho del papel
// (el generador lo cortaría en silencio) y los montos tienen que terminar siempre en el
// borde derecho, aunque el producto sea larguísimo o el precio tenga seis cifras.
import { createServer } from 'vite'

// Node 22 trae navigator.language = 'en-US' y la app elige idioma por ahí: el ticket salía en inglés
// y la prueba (que mide el ticket en español) fallaba. Se fija el idioma de la app como lo haría el usuario.
globalThis.localStorage = { getItem: k => (k === 'pos-idioma-app' ? 'es' : null), setItem() {}, removeItem() {} }

let fallos = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallos++ }

const cuentaDe = items => ({
  id: 'c1', tipo: 'mesa', numero: 12, mesaTexto: 'Mesa 5', mesaIds: ['m5'], comensales: 4,
  estado: 'cerrada', abiertaPor: 'Ana Torres', abiertaEn: Date.UTC(2026, 9, 20, 19, 4, 0),
  cerradaEn: Date.UTC(2026, 9, 20, 21, 30, 0), cerradaPor: 'Luis Peña', descuento: 15, propina: 20,
  detalle: 'Sin cebolla en las hamburguesas, la pizza sale aparte y la cuenta la paga la empresa',
  items, pagos: [{ metodo: 'efectivo', monto: 300, cambio: 60 }],
})
const items = [
  { qty: 2, nombre: 'Hamburguesa clásica', precio: 35, estado: 'confirmada', nota: 'término medio, sin pepinillos' },
  { qty: 1, nombre: 'Pizza pepperoni grande familiar', precio: 90, estado: 'confirmada' },
  { qty: 3, nombre: 'Cerveza nacional', precio: 15, estado: 'confirmada' },
  { qty: 1, nombre: 'Salchipapa para compartir', precio: 45, estado: 'anulado', motivo: 'el cliente cambió de plato' },
]
const caros = items.map(i => ({ ...i, precio: i.precio * 137 }))
const config = {
  nombre: 'Restaurante La Cascada', sucursal: 'Sucursal Achacán',
  direccion: 'Av. Arce esq. calle 21, piso 3, zona San Miguel', telefono: '700 12 345', nit: '1234567',
  moneda: 'Bs', propinaPct: 10,
}
const datos = { salon: 'Salón principal', mesa: 'Mesa 5', orden: 7 }

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } })
let Ticket, Printer
try {
  Ticket = await server.ssrLoadModule('/src/components/printing/Ticket.jsx')
  Printer = await server.ssrLoadModule('/src/services/printer.js')
} finally {
  await server.close()
}
const { generarTexto, lineaATexto } = Printer

const render = (cuenta, ancho) => {
  const lineas = Ticket.lineasPlanas({ cuenta, config, ancho, datos })
  return { lineas, texto: generarTexto({ lineas, ancho, corte: false }) }
}

for (const ancho of [32, 42, 48, 80]) {
  for (const [nombre, cuenta] of [['montos normales', cuentaDe(items)], ['montos de seis cifras', cuentaDe(caros)]]) {
    const { lineas, texto } = render(cuenta, ancho)
    const cortadas = lineas.filter(l => !l.guion
      && lineaATexto(l, ancho).trimEnd() !== String(l.texto ?? '').trimEnd())
      .map(l => `tam${l.tam || 1} «${String(l.texto).slice(0, 40)}» → «${lineaATexto(l, ancho)}»`)
    ok(!cortadas.length, `ancho ${ancho} · ${nombre}: ${lineas.length} renglones, ninguno recortado${cortadas.length ? `\n    ${cortadas.join('\n    ')}` : ''}`)

    const filas = texto.split('\n')
    const deTabla = filas.filter(f => /^(CANT|\d{1,4} |— )/.test(f) && /[\d.—]{2,}\s*$/.test(f))
    const encabezado = filas.find(f => f.startsWith('CANT'))
    const torcidas = deTabla.filter(f => f.length !== ancho)
    if (!encabezado || encabezado.length !== ancho) torcidas.push(encabezado || 'no aparece el encabezado CANT/DESCRIPCION/P.UNIT/IMPORTE')
    ok(deTabla.length >= 4 && encabezado && !torcidas.length, `ancho ${ancho}: el encabezado y ${deTabla.length} renglones de ítems cierran justo en el borde del papel${torcidas.length ? `\n    ${torcidas.map(t => `${t.length} col → «${t}»`).join('\n    ')}` : ''}`)
  }
}

const { lineas, texto } = render(cuentaDe(items), 32)
const filas = texto.split('\n')
const fila = x => filas.findIndex(f => f.includes(x))
const estructura = [
  ['nombre de la empresa', 'CASCADA'], ['sucursal', 'Sucursal Achacán'], ['dirección', 'Av. Arce esq. calle 21'],
  ['teléfono y NIT', 'NIT 1234567'], ['salón', 'SALÓN PRINCIPAL'], ['mesa', 'MESA 5'], ['mesero', 'Mesero: Ana Torres'],
  ['orden', 'Orden: 7'], ['personas', 'Personas: 4'], ['abrió', 'Abrió:'], ['cobró', 'Cobró:'],
  ['cajero que cobra', 'Cajero: Luis Peña'], ['tabla', 'IMPORTE'], ['primer ítem', 'Hamburguesa'],
  ['total', 'TOTAL'], ['punteado', '. . . .'], ['no es fiscal', 'NO ES UN COMPROBANTE FISCAL'], ['marca', 'POS CONTROL v'],
]
const posiciones = estructura.map(([, x]) => fila(x))
const enOrden = posiciones.every((p, i) => p >= 0 && (i === 0 || p >= posiciones[i - 1]))
ok(enOrden, `estructura de Soft Restaurant en orden${posiciones.map((p, i) => p < 0 ? `\n    falta «${estructura[i][1]}»` : '').join('')}${enOrden ? `\n    renglones: ${posiciones.map((p, i) => `${estructura[i][0]}=${p}`).join(' ')}` : `\n    renglones: ${posiciones.join(', ')}`}`)
ok(posiciones[7] === posiciones[8], 'orden y cantidad de personas comparten el renglón')

const punteados = filas.filter(f => /^(\. )+\.?$/.test(f.trim()))
ok(punteados.length >= 3, `3 renglones punteados para anotar a mano (${punteados.length} hallados)`)
const doble = lineas.filter(l => l.tam === 2).map(l => l.texto)
ok(doble.some(x => /CASCADA/.test(x)) && doble.some(x => /SALÓN PRINCIPAL/.test(x)) && doble.some(x => /MESA/.test(x)) && doble.some(x => /TOTAL/.test(x)),
  `cuerpo doble en empresa, salón, mesa y total (papel de 32): ${doble.join(' / ')}`)
const doble42 = Ticket.lineasPlanas({ cuenta: cuentaDe(items), config, ancho: 42, datos }).filter(l => l.tam === 2).map(l => l.texto)
ok(doble42.some(x => /Mesero: Ana Torres/.test(x)), `en papel ancho el mesero también sale en cuerpo doble`)
ok(filas.filter(f => f.trim() === 'Torres').length === 0, 'en papel de 32 el nombre del mesero no se parte en dos renglones')
ok(/POS CONTROL v\d+\.\d+\.\d+/.test(texto), `marca con la versión: ${(texto.match(/\*\*\* POS CONTROL v[.\d]+ \*\*\*/) || ['no aparece'])[0]}`)
const anulado = filas[fila('Salchipapa')] || ''
ok(/^— /.test(anulado) && /—\s+0\.00$/.test(anulado) && fila('ANULADO') > fila('Salchipapa') && fila('el cliente cambió') > fila('ANULADO'),
  `anulado con raya, sin monto y con su motivo: ${anulado.trim()}`)
ok(fila('término medio') > fila('Hamburguesa'), 'la nota del ítem se imprime debajo, no cortada')
const abrio = (filas[fila('Abrió')] || '').trim()
ok(/Abrió: \d+\/\d+\/\d+ \d+:\d+\s*$/.test(abrio) || abrio.length <= 32, `fecha y hora sin segundos: «${abrio}»`)

const vacia = generarTexto({ lineas: Ticket.lineasPlanas({ cuenta: { id: 'v', tipo: 'directa', numero: 3, abiertaPor: 'Luis', abiertaEn: Date.UTC(2026, 9, 20, 9, 0, 0), items: [], pagos: [] }, config, ancho: 32, datos: { salon: 'Mostrador' } }), ancho: 32, corte: false })
const filasVacia = vacia.split('\n')
ok(filasVacia.findIndex(f => f.includes('MOSTRADOR')) < filasVacia.findIndex(f => f.includes('Cajero: Luis')) && filasVacia.every(f => f.length <= 32), 'venta de mostrador: salón, turno y cajero, sin renglones fuera de ancho')

// La salida ESC/POS (la que come la impresora por el puerto serie) se genera con las mismas
// renglones: si alguna se perdiera o quedara vacía, el ticket impreso no es el probado arriba.
const { generarBytes } = Printer
const bytes = generarBytes({ lineas, ancho: 32, corte: true, beep: false })
const saltos = bytes.reduce((t, x) => t + (x === 0x0a ? 1 : 0), 0)
const ceros = bytes.reduce((t, x) => t + (x === 0x3f ? 1 : 0), 0)
ok(saltos === lineas.length, `ESC/POS: ${saltos} renglones impresos para ${lineas.length} generadas`)
ok(bytes.length > lineas.length * 6, `ESC/POS: ${bytes.length} bytes, cortina incluida (${bytes[bytes.length - 3] === 0x56 ? 'ok' : 'no'})`)
ok(!ceros, `ESC/POS: ningún carácter del ticket sale como «?» en PC437 (${ceros} hallados)`)

console.log('\n' + '─'.repeat(34) + '\n' + texto + '\n' + '─'.repeat(34))
if (fallos) { console.log(`${fallos} fallas`); process.exit(1) }
console.log('ticket: todas las pruebas pasaron')
