// Revisa a mano las reglas de GUIA-ESTILO.md que se pueden comprobar con texto.
// Uso: npm run estilo   (también corre dentro de npm test)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const raiz = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const archivos = []
;(function rec(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) rec(p)
    else if (p.endsWith('.jsx')) archivos.push(p)
  }
})(raiz)

const esComentario = l => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)
const problemas = []

for (const p of archivos) {
  const lineas = readFileSync(p, 'utf8').split(/\r?\n/)
  lineas.forEach((l, i) => {
    if (esComentario(l)) return
    // R-MAPA: las mesas de un mapa NUNCA son <button> (Safari no las usa como contenedor de medidas y los números salen enormes y cortados).
    if (/<button[^>]*className=\{?[`"']mesa[ `"']/.test(l) || /<button[^>]*\brp-mesa(?![-\w])/.test(l)) {
      problemas.push(`${p}:${i + 1}  una mesa de mapa es <button>; usa <div role="button" tabIndex={0}> con onKeyDown (regla R-MAPA)`)
    }
    // R-DIALOGO: nada de ventanas nativas del navegador.
    if (/(^|[^.\w])(alert|confirm|prompt)\(/.test(l)) {
      problemas.push(`${p}:${i + 1}  ventana nativa del navegador; usa un aviso en línea o un recuadro de confirmación (regla R-DIALOGO)`)
    }
  })
}

if (problemas.length) {
  console.error('✗ Reglas de estilo incumplidas:\n' + problemas.map(x => '  - ' + x).join('\n'))
  process.exit(1)
}
console.log(`✓ estilo: ${archivos.length} archivos revisados, sin problemas`)
