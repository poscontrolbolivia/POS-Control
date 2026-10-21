// La fila de cada área de la pantalla de cocina NO puede usar el id del área como clase suelta:
// «barra» chocaba con la clase global .barra (barra de botones) y encogía las tarjetas de Barra.
import { readFileSync } from 'node:fs'
let fallos = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fallos++ }
const jsx = readFileSync('src/components/panel/kitchen/KitchenPage.jsx', 'utf8')
const css = readFileSync('src/components/panel/kitchen/KitchenPage.css', 'utf8')
ok(/'ck-fila area-' \+ a/.test(jsx), 'la fila del área usa la clase con prefijo (ck-fila area-<id>)')
ok(!/'ck-fila ' \+ a\b/.test(jsx), 'ya no se usa el id del área como clase suelta')
ok(!/\.ck-fila\.(cocina|barra)\b/.test(css), 'el CSS no depende de .barra / .cocina sueltas')
console.log(fallos ? `${fallos} ✗` : 'kitchenClases: todo ✓'); process.exit(fallos ? 1 : 0)
