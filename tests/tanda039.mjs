// La tanda v0.39 también se mide en el fuente: hay cosas que un test de lógica no puede ver
// (qué pantalla renderiza qué, o un useMemo que cae después de un return y revienta en runtime).
import { readFileSync } from 'node:fs'

let mal = 0
const ok = (n, c) => { if (!c) { mal++; console.log('✗', n) } else console.log('✓', n) }
const R = p => readFileSync(new URL(p, import.meta.url), 'utf8')

const cocina = R('../src/components/panel/kitchen/KitchenPage.jsx')
const cocinaCss = R('../src/components/panel/kitchen/KitchenPage.css')
const quick = R('../src/components/panel/quicksale/QuickSalePage.jsx')
const ticket = R('../src/components/printing/Ticket.jsx')
const settings = R('../src/components/panel/settings/SettingsPage.jsx')
const settingsCss = R('../src/components/panel/settings/SettingsPage.css')
const hall = R('../src/components/panel/hall/HallPage.jsx')
const es = JSON.parse(R('../src/i18n/locales/es.json'))
const en = JSON.parse(R('../src/i18n/locales/en.json'))
const pt = JSON.parse(R('../src/i18n/locales/pt.json'))

// ── Despacho: nombre, vista nueva y contadores ──
ok('el módulo se llama Despacho', es['app.mod.cocina'] === 'Despacho' && en['app.mod.cocina'] === 'Expedition' && pt['app.mod.cocina'] === 'Expedição')
ok('la pantalla importa el grupo de venta directa', cocina.includes('GRUPO_DIRECTA') && cocina.includes('mostradorPendientes'))
ok('el contador rojo sale de la lógica pura', /useMemo\(\(\) => badgeDirecta/.test(cocina))
ok('la pestaña pinta el badge con .ck-n', /badge\(v\) > 0 && <span className="ck-n"/.test(cocina))
ok('el badge se lee también con lector de pantalla', /aria-label=\{`.*badge\(v\)/.test(cocina))
ok('.ck-n es rojo de peligro, no verde', /\.ck-n\s*\{[^}]*background: var\(--danger\)/.test(cocinaCss))
ok('ya no quedan las píldoras de canal con emoji', !/ck-canal|🥡|🍽|🛒\s*<\/span>/.test(cocina.replace(/icono = a =>[^\n]*/g, '')))
ok('la comanda en pantalla usa camposComanda', /camposComanda\(\{/.test(cocina))
// Hooks después de un return temprano = crash en cuanto el rol no tiene permiso.
const iReturn = cocina.indexOf('if (!permitido) return <div')
const iHooks = [cocina.indexOf('const pendientes = useMemo'), cocina.indexOf('const porEntregar = useMemo')]
ok('los useMemo de los contadores viven antes del return de permiso', iReturn > 0 && iHooks.every(i => i > 0 && i < iReturn))

// ── Venta directa: comandar antes de cobrar ──
ok('venta directa importa la impresora de comandas', /import \{[^}]*imprimirComandas[^}]*\} from '..\/..\/printing\/Ticket.jsx'/.test(quick))
ok('envía la comanda antes de cobrar', quick.indexOf("d({ t: 'enviar'") > 0 && quick.indexOf("d({ t: 'enviar'") < quick.indexOf("d({ t: 'cobrar'"))
ok('el checkbox de comanda existe y ayuda', quick.includes("name=\"comanda\"") && quick.includes('venta.comandaCheckbox') && quick.includes('venta.comandaAyuda'))
ok('esa clave está en los tres idiomas', [es, en, pt].every(j => typeof j['venta.comandaCheckbox'] === 'string' && j['venta.comandaCheckbox'].length > 3))

// ── El papel: texto plano, sin adornos centrados ──
ok('la comanda del ticket usa lineasComanda', /lineasComanda\(\{/.test(ticket))
ok('el papel recibe el salón y el área', ticket.includes('areaNombre: datos.areaNombre') && ticket.includes('salon: datos.salon'))
ok('sin círculo: el papel no pinta tam:2 en la comanda', !/comanda[\s\S]{0,700}?tam: 2/.test(ticket.slice(ticket.indexOf('if (comanda)') - 200, ticket.indexOf('if (comanda)') + 900)))

// ── Configuración: UNA sola navegación y colores que bajan por nivel ──
ok('desapareció el segundo menú de secciones', !settings.includes('CfgNav') && !settingsCss.includes('.cfg-nav'))
ok('el único selector es el acordeón de bloques', /function Bloque\(/.test(settings) && settingsCss.includes('.cfg-bloque'))
const l1 = settingsCss.match(/\.cfg-bloque\.abierto > \.cfg-cab\s*\{([^}]*)\}/)?.[1] || ''
const l2 = settingsCss.match(/\.adm-panel \.imp-sub\.abierto > \.imp-sub-cab\s*\{([^}]*)\}/)?.[1] || ''
ok('nivel 1 abierto: verde de marca', l1.includes('--logo-green') && !l1.includes('--ac'))
ok('nivel 2 abierto: azul, distinto del nivel 1', l2.includes('--ac') && !l2.includes('--logo-green'))
ok('el título del bloque abierto queda fijo al bajar', l1.includes('position:sticky') && l1.includes('var(--topbar-h'))
ok('la ayuda de Configuración ya no habla del menú de arriba', !es['config.ayuda'].includes('el menú de arriba') && !en['config.ayuda'].includes('menu on top') && !pt['config.ayuda'].includes('menu de cima'))

// ── Eliminar salón: el botón existe y no es un callejón ──
ok('hall importa el plan de borrado', hall.includes('planZonaBorrar') && hall.includes('accionesBorrarZona'))
ok('el 🗑 de una zona con mesas ya no está bloqueado', !/disabled=\{nMesasZona\(z\.id\) > 0\}/.test(hall))
ok('se puede elegir destino de las mesas', hall.includes('zconf-sel') && hall.includes('BORRAR_MESAS') && hall.includes('SIN_SALON'))
ok('avisa si el salón tiene mesas con cuenta abierta', hall.includes('salon.zonaMesasConCuenta'))

// ── Regla de la casa: nada de diálogos nativos en lo tocado (los comentarios no cuentan) ──
const sinComentarios = src => src.replace(/\/\/[^\n]*/g, '')
;[['cocina', cocina], ['quick', quick], ['ticket', ticket], ['settings', settings], ['hall', hall]].forEach(([n, src]) =>
  ok(`${n}: sin confirm()/alert() nativos`, !/(^|[^.\w])(confirm|alert)\s*\(/.test(sinComentarios(src))))

console.log(mal ? `\n${mal} fallo(s)` : '\ntodo OK')
process.exit(mal ? 1 : 0)
