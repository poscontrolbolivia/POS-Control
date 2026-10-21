// Cocina / Barra / Alertas: ciclo de un plato (enviar → salida por área → deshacer → anular) y alertas automáticas.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { alertasAutomaticas, claveSugerencia } from '../src/components/panel/alerts/alertasAutomaticas.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUD = path.join(RAIZ, 'src/context/_audit2.jsx')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-audit-'))
fs.writeFileSync(AUD, fs.readFileSync(path.join(RAIZ, 'src/context/StoreContext.jsx'), 'utf8') + '\nexport { reducer }\n')
try {
  await build({ root: RAIZ, logLevel: 'silent', configFile: false, plugins: [react()], ssr: { noExternal: true },
    build: { ssr: AUD, outDir: OUT, emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'b.mjs', format: 'es' } } } })
} finally { fs.rmSync(AUD, { force: true }) }
const { reducer } = await import(pathToFileURL(path.join(OUT, 'b.mjs')).href)
fs.rmSync(OUT, { recursive: true, force: true })

let ok = 0, mal = 0
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n) } }
const MIN = 60000

// ---- Cocina / Barra
const base = { mesas: [{ id: 'm1', nombre: 'Mesa 1', cap: 4, zona: 'z' }], zonas: [{ id: 'z', nombre: 'Sala' }], cuentas: [], config: {}, caja: {}, secciones: [], productos: [{ id: 'p1', nombre: 'Lomo + trago', precio: 50, areas: ['cocina', 'barra'], activo: true }], alertas: [] }
let s = reducer(base, { t: 'abrir', mesaId: 'm1', comensales: 2, usuario: 'ana' })
const cid = s.cuentas[0].id
s = reducer(s, { t: 'item+', cuentaId: cid, p: { id: 'p1', nombre: 'Lomo + trago', precio: 50, areas: ['cocina', 'barra'] } })
const it = () => s.cuentas[0].items[0]
t('plato agregado queda pendiente', it()?.estado === 'pendiente')
s = reducer(s, { t: 'enviar', cuentaId: cid })
t('enviar lo pasa a «enviado» con hora', it().estado === 'enviado' && it().enviadoEn > 0)
t('un plato de 2 áreas se manda a las 2', (it().areas || []).length === 2)
s = reducer(s, { t: 'cocina-salida', cuentaId: cid, itemId: it().id, area: 'cocina' })
t('sale cocina: sigue «enviado» (falta barra)', it().estado === 'enviado' && it().areasListas.length === 1)
s = reducer(s, { t: 'cocina-salida', cuentaId: cid, itemId: it().id, area: 'barra' })
t('salen las 2 áreas: pasa a «listo»', it().estado === 'listo' && it().listoEn > 0)
s = reducer(s, { t: 'cocina-deshacer', cuentaId: cid, itemId: it().id, area: 'barra' })
t('deshacer barra: vuelve a «enviado»', it().estado === 'enviado' && !it().areasListas.includes('barra'))
s = reducer(s, { t: 'cocina-anular', cuentaId: cid, itemId: it().id, motivo: 'cliente se fue', usuario: 'cocina1' })
t('cocina pide anular: queda «anulacion» con motivo', it().estado === 'anulacion' && it().motivo === 'cliente se fue')
t('mientras espera, «ya salió» no hace nada', reducer(s, { t: 'cocina-salida', cuentaId: cid, itemId: it().id, area: 'barra' }).cuentas[0].items[0].estado === 'anulacion')
const rech = reducer(s, { t: 'cocina-resolver', cuentaId: cid, itemId: it().id, aprobar: false, usuario: 'caja' })
t('caja rechaza: vuelve a «enviado» sin motivo', rech.cuentas[0].items[0].estado === 'enviado' && !rech.cuentas[0].items[0].motivo)
const apr = reducer(s, { t: 'cocina-resolver', cuentaId: cid, itemId: it().id, aprobar: true, usuario: 'caja' })
t('caja aprueba: queda «anulado»', apr.cuentas[0].items[0].estado === 'anulado')
t('cocina no puede anular un plato pendiente', reducer(reducer(base, { t: 'abrir', mesaId: 'm1', comensales: 1, usuario: 'a' }), { t: 'cocina-anular', cuentaId: 'x', itemId: 'y', motivo: 'z' }).cuentas.length === 1)

// ---- Alertas automáticas
const ahora = 1_000_000_000_000
const mesas = [{ id: 'm1', nombre: 'Mesa 1' }, { id: 'm2', nombre: 'Mesa 2' }]
const cuenta = (o = {}) => ({ id: 'c1', estado: 'abierta', mesaIds: ['m1'], abiertaEn: ahora - 10 * MIN, items: [], pagos: [], propina: 0, descuento: 0, ...o })
const plato = (min, o = {}) => ({ id: 'i' + min, nombre: 'Lomo', qty: 1, precio: 40, estado: 'enviado', enviadoEn: ahora - min * MIN, ...o })
const A = c => alertasAutomaticas({ cuentas: c, mesas, insumos: [], ahora })
t('plato de 10 min: sin alerta', A([cuenta({ items: [plato(10)] })]).length === 0)
const d16 = A([cuenta({ items: [plato(16)] })])
t('plato de 16 min: «Comanda demorada» normal', d16.length === 1 && d16[0].titulo === 'Comanda demorada' && d16[0].prioridad === 4)
t('plato de 31 min: sube a urgente', A([cuenta({ items: [plato(31)] })])[0].prioridad === 2)
t('plato ya «listo» no genera demora', A([cuenta({ items: [plato(40, { estado: 'listo' })] })]).length === 0)
t('plato anulado no genera demora', A([cuenta({ items: [plato(40, { estado: 'anulado' })] })]).length === 0)
const pre = A([cuenta({ estado: 'precuenta', items: [plato(5, { estado: 'listo' })] })])
t('pre-cuenta: «Cuenta por cobrar» con el saldo', pre.length === 1 && pre[0].tipo === 'cobro' && /40\.00/.test(pre[0].mensaje))
t('cuenta con saldo y más de 2 h: alerta de atraso', A([cuenta({ abiertaEn: ahora - 130 * MIN, items: [plato(5, { estado: 'listo' })] })]).some(a => a.titulo.includes('2 horas')))
t('cuenta de 2 h sin saldo: sin alerta', A([cuenta({ abiertaEn: ahora - 130 * MIN })]).length === 0)
t('cuenta cerrada: sin alertas', A([cuenta({ estado: 'cerrada', items: [plato(60)] })]).length === 0)
t('para llevar se nombra con el cliente', A([cuenta({ mesaIds: [], canal: 'llevar', clienteNombre: 'Ernesto', items: [plato(20)] })])[0].mensaje.includes('Ernesto'))
const ins = alertasAutomaticas({ cuentas: [], mesas, ahora, insumos: [
  { id: 'a', nombre: 'Pollo', unidad: 'kg', stock: 0, stock_min: 5 }, { id: 'b', nombre: 'Arroz', unidad: 'kg', stock: 3, stock_min: 5 },
  { id: 'c', nombre: 'Sal', unidad: 'kg', stock: 9, stock_min: 5 }, { id: 'd', nombre: 'Viejo', stock: 0, stock_min: 5, activo: false }, { id: 'e', nombre: 'Sin mínimo', stock: 0, stock_min: 0 }] })
t('stock bajo: solo Pollo y Arroz (no Sal, ni inactivo, ni sin mínimo)', ins.length === 2)
t('sin stock es más urgente que stock bajo', ins[0].prioridad < ins[1].prioridad)
t('cada insumo tiene su propia clave (convertir uno no oculta al otro)', claveSugerencia(ins[0]) !== claveSugerencia(ins[1]))
t('misma sugerencia = misma clave aunque pasen los minutos',
  claveSugerencia(A([cuenta({ items: [plato(16)] })])[0]) === claveSugerencia(alertasAutomaticas({ cuentas: [cuenta({ items: [plato(16)] })], mesas, insumos: [], ahora: ahora + 5 * MIN })[0]))
let sa = reducer(base, { t: 'alerta+', alerta: { tipo: 'general', titulo: 'Falta hielo', prioridad: 3 }, usuario: 'ana' })
t('alerta manual se crea pendiente', sa.alertas.length === 1 && sa.alertas[0].resueltaEn === null)
sa = reducer(sa, { t: 'alerta-resolver', id: sa.alertas[0].id, resuelta: true, usuario: 'luis' })
t('resolver la marca con quién y cuándo', sa.alertas[0].resueltaEn > 0 && sa.alertas[0].resueltaPor === 'luis')
sa = reducer(sa, { t: 'alerta-resolver', id: sa.alertas[0].id, resuelta: false })
t('reabrir la alerta', sa.alertas[0].resueltaEn === null)

console.log(`cocinaAlertas: ${ok} ✓ ${mal} ✗`)
if (mal) process.exit(1)
