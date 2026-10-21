// Etapas Prep · Parcial · Listo · Cuenta · Pagada (v0.31) y su contrato: SOLO muestran, no bloquean.
// A propósito: cobrar nunca depende de estar listo, ni en la pantalla ni en la base.
import { createServer } from 'vite'
import fs from 'node:fs'

let fallos = 0
const ok = (nombre, bien, detalle = '') => { if (!bien) fallos++; console.log(`${bien ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`) }

const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } })
let S
try { S = await server.ssrLoadModule('/src/context/StoreContext.jsx') } finally { await server.close() }
const { pasoPedido } = S

const cuenta = (estado, ...estados) => ({ id: 'c1', estado, items: estados.map((e, i) => ({ id: 'i' + i, estado: e, precio: 10, qty: 1 })) })

console.log('etapas del pedido:')
ok('sin items = prep', pasoPedido(cuenta('abierta')) === 'prep')
ok('todo pendiente = prep', pasoPedido(cuenta('abierta', 'pendiente', 'pendiente')) === 'prep')
ok('enviado = prep', pasoPedido(cuenta('abierta', 'enviado')) === 'prep')
ok('listo a medias = parcial', pasoPedido(cuenta('abierta', 'listo', 'enviado')) === 'parcial')
ok('todo listo = listo', pasoPedido(cuenta('abierta', 'listo', 'listo')) === 'listo')
ok('el anulado no cuenta', pasoPedido(cuenta('abierta', 'listo', 'anulado')) === 'listo')
ok('pre-cuenta = cuenta', pasoPedido(cuenta('precuenta', 'listo')) === 'cuenta')
ok('cerrada = pagada', pasoPedido(cuenta('cerrada', 'listo')) === 'pagada')
ok('cuenta sin items no da etapa', pasoPedido(null) === '')

console.log('nada traba el cobro:')
const panel = fs.readFileSync(new URL('../src/components/panel/order/OrderPanel.jsx', import.meta.url), 'utf8')
ok('el panel no importa puedeCobrar', !/puedeCobrar/.test(panel))
const iniciar = panel.slice(panel.indexOf('const iniciarCobro'), panel.indexOf('const abrirTurnoYCobrar'))
ok('cobrar solo pide el turno de caja', /caja\?\.turno/.test(iniciar) && !/listo/.test(iniciar))
ok('no queda el aviso de pedido no listo', !/noListo|avisarPorListar/.test(panel))

const sql = fs.readFileSync(new URL('../install/supabase-setup-final.sql', import.meta.url), 'utf8')
const cobrar = sql.slice(sql.lastIndexOf('create or replace function public.cobrar_cuenta'))
ok('cobrar_cuenta no rechaza por etapas', !/pedido_no_listo/.test(cobrar) && !/estado in \('enviado','anulacion'\)/.test(cobrar))
ok('marcar sigue siendo un estado aparte', /create or replace function public\.marcar_pedido_listo/.test(sql) && /create or replace function public\.deshacer_pedido_listo/.test(sql))
ok('el respaldo viaja en versión 4', /'version', 4/.test(sql) && /'cuentas_por_pagar'/.test(sql) && /'alertas'/.test(sql))

process.exit(fallos ? 1 : 0)
