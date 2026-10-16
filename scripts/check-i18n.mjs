#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Coherencia de los diccionarios de POS Control (carril IDIOMAS).
// Compara las claves de src/i18n/es.js (fuente de verdad) contra en.js y pt.js
// y FALLA (exit 1) si falta alguna, sobra alguna, hay duplicados, un valor está
// vacío o los parámetros {nombre} de una misma clave no coinciden entre idiomas.
// Uso: `node scripts/check-i18n.mjs`
//
// También avisa (sin fallar) de claves que el código pide con `t('…')` y que NO
// existen en es.js: esas se verían en pantalla como el propio nombre de la clave.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVOS = ['es', 'en', 'pt']

// Los diccionarios se IMPORTAN (son JS puro sin JSX): es la única forma fiable de leer
// los valores reales. El escaneo de TEXTO solo se usa para detectar claves duplicadas,
// que JS resuelve en silencio (gana la última) y el import no las mostraría.
async function leerDiccionario(idioma) {
  const ruta = path.join(raiz, 'src', 'i18n', `${idioma}.js`)
  const modulo = await import(pathToFileURL(ruta).href)
  const datos = modulo.default
  const codigo = readFileSync(ruta, 'utf8')
  const clavesTexto = [...codigo.matchAll(/^\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)':/gm)].map(m => m[1])
  const vistas = new Set()
  const duplicadas = clavesTexto.filter(c => (vistas.has(c) ? true : (vistas.add(c), false)))
  const vacias = Object.keys(datos).filter(c => !String(datos[c] ?? '').trim())
  return { ruta, datos, claves: Object.keys(datos), set: new Set(Object.keys(datos)), vacias, duplicadas }
}

const dics = {}
for (const i of ARCHIVOS) dics[i] = await leerDiccionario(i)
const base = dics.es
const errores = []

// 1) Claves duplicadas dentro del mismo diccionario y valores vacíos.
for (const i of ARCHIVOS) {
  if (dics[i].duplicadas.length) {
    errores.push(`${i}.js tiene claves DUPLICADAS: ${[...new Set(dics[i].duplicadas)].join(', ')}`)
  }
  if (dics[i].vacias.length) {
    errores.push(`${i}.js tiene claves con valor VACÍO: ${dics[i].vacias.join(', ')}`)
  }
}

// 2) es/en/pt deben tener exactamente las mismas claves (ni una más, ni una menos).
for (const i of ARCHIVOS.filter(x => x !== 'es')) {
  const faltan = base.claves.filter(c => !dics[i].set.has(c))
  const sobran = dics[i].claves.filter(c => !base.set.has(c))
  if (faltan.length) errores.push(`${i}.js LE FALTAN ${faltan.length} claves de es.js: ${faltan.join(', ')}`)
  if (sobran.length) errores.push(`${i}.js TIENE ${sobran.length} claves QUE NO EXISTEN en es.js: ${sobran.join(', ')}`)
}

// 3) Los parámetros de interpolación {nombre} deben coincidir entre idiomas; si no,
//    la llamada a t() deja el marcador sin sustituir en la pantalla.
const plantilla = v => (String(v).match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || []).sort().join(',')
for (const i of ARCHIVOS.filter(x => x !== 'es')) {
  const rotos = []
  for (const c of base.claves) {
    if (!(c in dics[i].datos)) continue
    if (plantilla(base.datos[c]) !== plantilla(dics[i].datos[c])) {
      rotos.push(`${c} → es:[${plantilla(base.datos[c])}] ${i}:[${plantilla(dics[i].datos[c])}]`)
    }
  }
  if (rotos.length) errores.push(`${i}.js tiene PARÁMETROS {…} que no coinciden con es.js:\n     ${rotos.join('\n     ')}`)
}

// 4) AVISO (no falla): claves usadas literalmente en el código que no están en es.js.
function archivosSrc(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join2(dir, n)
    if (statSync(p).isDirectory()) archivosSrc(p, out)
    else if (n.endsWith('.js') || n.endsWith('.jsx')) out.push(p)
  }
  return out
}
const join2 = (...p) => path.join(...p)
const RE_USO = /(?:^|[^\w$.])(?:t|tOr|tGlobal|existeClave)\(\s*['"`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"`]/gi
const huerfanas = new Set()
for (const f of archivosSrc(path.join(raiz, 'src'))) {
  const txt = readFileSync(f, 'utf8')
  for (const m of txt.matchAll(RE_USO)) {
    if (!base.set.has(m[1])) huerfanas.add(`${m[1]} (${path.relative(raiz, f)})`)
  }
}

// ── Resultado ──
if (errores.length) {
  console.error('✗ check-i18n: INCOHERENCIAS detectadas\n')
  errores.forEach(e => console.error('  · ' + e))
  console.error(`\n  Claves en es.js: ${base.claves.length}`)
  process.exit(1)
}
const namespaces = [...new Set(base.claves.map(c => c.split('.')[0]))].sort()
console.log('✓ check-i18n: diccionarios coherentes')
console.log(`  es → ${base.claves.length} claves (fuente de verdad)`)
console.log(`  en → ${dics.en.claves.length} claves`)
console.log(`  pt → ${dics.pt.claves.length} claves`)
console.log(`  namespaces: ${namespaces.join(', ')}`)
console.log(`  claves por namespace: ${namespaces.map(n => `${n}:${base.claves.filter(c => c.startsWith(n + '.')).length}`).join(' ')}`)
if (huerfanas.size) {
  console.log(`\n⚠ ${huerfanas.size} claves usadas en código y ausentes en es.js (se vería el nombre de la clave en pantalla):`)
  ;[...huerfanas].sort().forEach(c => console.log('   · ' + c))
}
