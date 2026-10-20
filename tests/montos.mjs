import { limpiarMonto, numMonto, round2 } from '../src/services/format.js'

let fallos = 0
const ok = (nombre, bien, detalle = '') => { if (!bien) fallos++; console.log(`${bien ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`) }

console.log('escritura fluida de montos:')

ok(limpiarMonto('19.') === '19.', 'deja «19.» mientras se escribe el decimal', limpiarMonto('19.'))
ok(limpiarMonto(',') === '.', 'deja la coma suelta sin vaciar el campo', limpiarMonto(','))
ok(limpiarMonto(',5') === '.5', 'coma inicial sigue siendo decimal', limpiarMonto(',5'))
ok(limpiarMonto('1,234.56') === '1234.56', 'coma de miles + punto decimal', limpiarMonto('1,234.56'))
ok(limpiarMonto('1.234,56') === '1234.56', 'punto de miles + coma decimal', limpiarMonto('1.234,56'))
ok(limpiarMonto('12.3.4') === '123.4', 'el último separador manda', limpiarMonto('12.3.4'))
ok(limpiarMonto('12.345') === '12.34', 'máximo dos decimales', limpiarMonto('12.345'))
ok(limpiarMonto('abc-8$/') === '8', 'descarta letras y signos', limpiarMonto('abc-8$/'))
ok(limpiarMonto(null) === '' && limpiarMonto(undefined) === '', 'vacío no rompe')
ok(limpiarMonto('') === '', 'borrar todo deja el campo editable en limpio')

ok(numMonto('19.') === 19 && numMonto(',5') === 0.5 && numMonto('1234.56') === 1234.56, 'numMonto lee lo que se escribió')
ok(numMonto('') === 0 && numMonto('abc') === 0 && numMonto('-20') === 0, 'numMonto nunca devuelve negativo ni NaN')
ok(round2(0.1 + 0.2) === 0.3, 'round2 evita el 0.30000000000000004')
ok(round2(numMonto('33.33') * 3) === 99.99, 'abono de 3 líneas de 33.33 cuadra en 99.99')

process.exit(fallos ? 1 : 0)
