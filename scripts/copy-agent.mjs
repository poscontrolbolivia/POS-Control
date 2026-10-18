import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DE = join(RAIZ, 'print-agent')
const A = join(RAIZ, 'public')

let cambios = 0
for (const n of ['agente.mjs', 'instalar-agente.bat']) {
  const txt = await fs.readFile(join(DE, n))
  const anterior = await fs.readFile(join(A, n)).catch(() => null)
  if (anterior && anterior.equals(txt)) { console.log(`public/${n} ya está al día`); continue }
  await fs.writeFile(join(A, n), txt)
  console.log(`public/${n} actualizado (${(txt.length / 1024).toFixed(1)} KB)`)
  cambios++
}
console.log(cambios ? `${cambios} copia(s) actualizada(s)` : 'sin cambios')
