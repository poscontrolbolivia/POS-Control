// Tanda v0.40: unir subcuentas (la 2A desaparece), partir la cantidad de un plato,
// mesa en blanco y los chips de submesa en Caja. La lógica vive en services/subcuentas.js
// y lo que no se puede probar sin navegador se mide en el fuente y en el SQL.
import { readFileSync, readdirSync } from 'node:fs'
import { unirCuentas } from '../src/services/subcuentas.js'

let mal = 0
const ok = (n, c) => { if (!c) { mal++; console.log('✗', n) } else console.log('✓', n) }
const R = p => readFileSync(new URL(p, import.meta.url), 'utf8')

const cuenta = (id, etiqueta, x = { comensales: 2, items: [{ id: id + '1', qty: 1 }], pagos: [{ monto: 10 }], mesa: 'm2' }) => ({
  id, etiqueta, estado: 'abierta', tipo: 'mesa', mesaIds: [x.mesa], comensales: x.comensales, items: x.items, pagos: x.pagos,
})

// ── Lógica pura: la absorbida se va y la letra cae cuando la mesa queda sola ──
const dos = [cuenta('c1', 'a'), cuenta('c2', 'b')]
const unidas = unirCuentas(dos, 'c1', [dos[1]])
ok('la cuenta absorbida desaparece de la lista', unidas.length === 1 && !unidas.some(c => c.id === 'c2'))
ok('la que queda vuelve a no tener letra', unidas[0].etiqueta === '')
ok('los ítems de las dos se conservan', unidas[0].items.length === 2)
ok('los abonos no se pierden (el arqueo los necesita)', unidas[0].pagos.length === 2)
ok('los comensales se suman', unidas[0].comensales === 4)

const tres = [cuenta('c1', 'a'), cuenta('c2', 'b'), cuenta('c3', 'c')]
const unaDeTres = unirCuentas(tres, 'c1', [tres[1]])
ok('con tres cuentas, unir dos deja letra a la superviviente', unaDeTres.length === 2 && unaDeTres[0].etiqueta === 'a')

const conCerrada = [cuenta('c1', 'a'), cuenta('c2', 'b'), { ...cuenta('c3', 'c'), estado: 'cerrada' }]
ok('una cuenta cerrada no cuenta como hermana: la letra cae', unirCuentas(conCerrada, 'c1', [conCerrada[1]])[0].etiqueta === '')

const llenas = [cuenta('c1', 'a', { comensales: 60 }), cuenta('c2', 'b', { comensales: 60 })]
ok('los comensales tienen tope de 99', unirCuentas(llenas, 'c1', [llenas[1]])[0].comensales === 99)

const conMesaExtra = unirCuentas(dos, 'c1', [dos[1]], ['m3'])
ok('unir mesas suma la mesa nueva', conMesaExtra[0].mesaIds.includes('m2') && conMesaExtra[0].mesaIds.includes('m3'))
ok('unir sin nada que unir no toca el estado', unirCuentas(dos, 'c1', []) === dos)

const mixtas = [cuenta('c1', 'a'), { ...cuenta('c2', 'b'), mesaIds: ['m5'] }]
const cruzadas = unirCuentas(mixtas, 'c1', [mixtas[1]])
ok('unir mesas distintas las junta en una sola cuenta sin letra', cruzadas.length === 1 && cruzadas[0].etiqueta === '' && cruzadas[0].mesaIds.join() === 'm2,m5')

// ── La pantalla: − / + dentro del propio renglón, sin campo aparte ──
const panel = R('../src/components/panel/order/OrderPanel.jsx')
const panelCss = R('../src/components/panel/order/OrderPanel.css')
const resumen = R('../src/components/panel/hall/MesasResumen.jsx')
const resumenCss = R('../src/components/panel/hall/MesasResumen.css')
const caja = R('../src/components/panel/cash/CashPage.jsx')
const store = R('../src/context/StoreContext.jsx')
const sql = R('../install/supabase-setup-final.sql')

ok('desapareció el campo suelto de cantidad a mover', !panel.includes('mover-cantidad'))
ok('el − / + vive sobre la cantidad del plato marcado', /className="qty qty-partir"/.test(panel) && /setPartes\(p => \(\{ \.\.\.p, \[i\.id\]/.test(panel))
ok('el botón mueve la suma de piezas marcadas', /t\('pedido\.moverN', \{ n: nMovidas \}\)/.test(panel))
ok('primero las partidas y después los platos completos', panel.indexOf("t: 'mover-parcial'") < panel.indexOf("t: 'mover',"))
ok('el aviso del movimiento usa los marcadores reales', panel.includes("'Movido: {detalle} a {mesa}'")
  && JSON.parse(R('../src/i18n/locales/es.json'))['pedido.movidoParcialOk'].includes('{detalle}'))
ok('.qty-partir existe en la hoja de estilos', panelCss.includes('.qty-partir'))

// ── Mesa en blanco: se puede cerrar y se descarta al salir ──
ok('la mesa vacía tiene botón propio', /mesaVacia && <button[^>]*onClick=\{cerrarVacia\}/.test(panel))
ok('el botón aparece solo sin ítems y sin abonos', /const mesaVacia = [^\n]*!\(c\.items \|\| \[\]\)\.length && !\(c\.pagos \|\| \[\]\)\.length/.test(panel))
ok('al salir se descarta la cuenta en blanco', /if \(mesaVacia\) d\(\{ t: 'abrir-descartar'/.test(panel))
ok('el reducer conoce abrir-descartar', store.includes("case 'abrir-descartar'") || /'abrir-descartar'/.test(store))

// ── Caja: la mesa y sus subcuentas en la misma tarjeta ──
ok('los chips de subcuenta se pintan en lista y en mapa', (resumen.match(/chips\(m, cs/g) || []).length >= 2)
ok('cada chip cobra esa cuenta, no la mesa entera', /onOpen\(m, x\)/.test(resumen))
ok('.mr-chip y .mr-subchips existen en la hoja de estilos', resumenCss.includes('.mr-chip') && resumenCss.includes('.mr-subchips'))
ok('el lienzo no recorta los chips de la última fila', /\.mr-lienzo\{[^}]*overflow:visible/.test(resumenCss))
ok('Caja guarda la subcuenta elegida y la pasa al panel', /cuentaInicial=\{subCobro\}/.test(caja) && /irSalon = \(mesa, subcuenta\)/.test(caja))
ok('el panel arranca en la subcuenta que el cajero tocó', /useState\(cuentaInicial \?\? null\)/.test(panel) && /if \(cuentaInicial\) setCuentaSelId\(cuentaInicial\)/.test(panel))

// ── El servidor manda: si el RPC no borra, al recargar vuelve la 2A ──
const union = sql.slice(sql.indexOf('create or replace function public.unir_mesas'), sql.indexOf('create or replace function public.separar_mesa'))
const unionSub = sql.slice(sql.indexOf('create or replace function public.unir_subcuentas'), sql.indexOf('create or replace function public.mover_item_parcial'))
ok('unir_mesas borra la cuenta absorbida', /delete from public\.cuentas/.test(union))
ok('unir_subcuentas borra la cuenta absorbida', /delete from public\.cuentas/.test(unionSub))
ok('los abonos viajan antes de borrar (on delete set null los huérfana)', /update public\.pagos\s+set cuenta_id = v_cuenta\.id/.test(union) && /update public\.pagos[\s\S]{0,80}v_cuenta\.id/.test(unionSub))
ok('la letra se cae cuando la mesa queda sola', /set etiqueta = null/.test(union) && /not exists/.test(union) && /set etiqueta = null/.test(unionSub))
// Un DELETE con una FK en NO ACTION tumbaría la unión entera en el servidor.
ok('ninguna FK impide borrar una cuenta', !/references public\.cuentas\(id\)(?! on delete (cascade|set null))/.test(sql))

// ── Regla fija del dueño: en install/ solo 2 SQL, nunca un parche suelto ──
// Un parche viejo con el unir_subcuentas anterior deshace el fix si se pega después del setup.
const ARCHIVOS_INSTALL = ['panel-pos.bat', 'supabase-promote-superadmin.sql', 'supabase-setup-final.sql']
ok('install/ tiene exactamente los 2 SQL y el panel, sin parches',
  readdirSync(new URL('../install/', import.meta.url)).sort().join(',') === ARCHIVOS_INSTALL.join(','))
ok('no queda ningún parche-*.sql en el proyecto',
  !readdirSync(new URL('../install/', import.meta.url)).some(f => /^parche-/.test(f)))

// ── El panel .bat tiene que servir recién descomprimido (sin node_modules) ──
const bat = R('../scripts/panel.mjs')
ok('el panel instala las dependencias solas si faltan', /function dependencias\(\{/.test(bat) && /existsSync\(join\(RAIZ, 'node_modules'\)\)/.test(bat))
ok('probar, compilar y abrir pasan por esa comprobación', /(q === '4'|q === '5'|q === '6')[\s\S]{0,120}dependencias\(\)/.test(bat) && /else if \(q === '6'\)[^\n]*dependencias/.test(bat))
ok('hay opción directa de npm install', /linea\(8, 'Instalar dependencias/.test(bat))

console.log(mal ? `\n${mal} fallo(s)` : '\ntodo OK')
process.exit(mal ? 1 : 0)
