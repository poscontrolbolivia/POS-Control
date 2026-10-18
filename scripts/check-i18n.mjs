import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales')
const dics = Object.fromEntries(['es', 'en', 'pt'].map(l => [l, JSON.parse(readFileSync(path.join(dir, l + '.json'), 'utf8'))]))
const holders = v => [...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
const errores = []
for (const l of ['en', 'pt']) {
  for (const k of Object.keys(dics.es)) if (!(k in dics[l])) errores.push(`${l}: falta ${k}`)
  for (const k of Object.keys(dics[l])) if (!(k in dics.es)) errores.push(`${l}: sobra ${k}`)
}
for (const l of Object.keys(dics)) {
  for (const [k, v] of Object.entries(dics[l])) {
    if (!String(v).trim()) errores.push(`${l}: vacía ${k}`)
    else if (dics.es[k] !== undefined && holders(v) !== holders(dics.es[k])) errores.push(`${l}: marcadores {x} distintos en ${k}`)
  }
}
if (errores.length) { console.error('✗ i18n\n' + errores.slice(0, 40).join('\n')); process.exit(1) }
console.log(`✓ i18n: ${Object.keys(dics.es).length} claves en es/en/pt`)
