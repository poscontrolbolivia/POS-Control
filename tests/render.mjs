// Prueba de renderizado: dibuja cada pantalla con el almacén de demo y el idioma real, en el servidor (sin navegador).
// Atrapa lo que el compilador no ve: variables usadas antes de crearse, hooks fuera de orden, props que faltan,
// claves de idioma sin traducir y llaves «{...}» crudas en pantalla.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-render-'))

// ── un «navegador» mínimo ──
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get length() { return m.size }, key: i => [...m.keys()][i] ?? null } }
const noop = () => {}
const clase = class { observe() {} unobserve() {} disconnect() {} }
const el = () => ({ style: { setProperty: noop, removeProperty: noop }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, getAttribute: () => null, appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 }), focus: noop, blur: noop, scrollIntoView: noop })
globalThis.localStorage = mem(); globalThis.sessionStorage = mem()
globalThis.window = globalThis
Object.assign(globalThis, {
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, scrollTo: noop, innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  requestAnimationFrame: f => setTimeout(f, 0), cancelAnimationFrame: noop, ResizeObserver: clase, IntersectionObserver: clase, MutationObserver: clase,
  getComputedStyle: () => ({ getPropertyValue: () => '' }), location: { hash: '', search: '', pathname: '/', href: 'http://x/', origin: 'http://x', protocol: 'http:', host: 'x' },
  document: { ...el(), documentElement: el(), body: el(), head: el(), title: '', cookie: '', createElement: el, getElementById: () => null, hidden: false, visibilityState: 'visible', fonts: { ready: Promise.resolve() } },
})

await build({ root: RAIZ, logLevel: 'silent', configFile: false, plugins: [react()], ssr: { noExternal: true },
  define: { __BUILD_ID__: '"t"', __APP_VERSION__: '"t"' },
  build: { ssr: path.join(RAIZ, 'src/_render.jsx'), outDir: OUT, emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'b.mjs', format: 'es' } } } })
const { CASOS } = await import(pathToFileURL(path.join(OUT, 'b.mjs')).href)

let mal = 0, ok = 0
const ES = JSON.parse(fs.readFileSync(path.join(RAIZ, 'src/i18n/locales/es.json'), 'utf8'))
const origErr = console.error
for (const [nombre, f] of Object.entries(CASOS)) {
  const avisos = []
  console.error = (...a) => avisos.push(a.map(String).join(' ').slice(0, 220))
  let html = ''
  try { html = f() } catch (e) { mal++; console.log('✗', nombre, '→', String(e.message).slice(0, 200)); continue } finally { console.error = origErr }
  const texto = html.replace(/<[^>]+>/g, ' ')
  const crudas = [...new Set((texto.match(/\{[a-zA-Z]+\}/g) || []))]
  const claves = [...new Set((texto.match(/\b(?:[a-z]+\.){1,2}[a-zA-Z]+\b/g) || []).filter(k => k in ES === false && /^(app|pedido|caja|cocina|salon|menu|items|cfg|config|ticket|comun|estado|areas|despacho|hall|zona|mesa|venta|alertas|agotado|metodo|paso|estadoItem)\./.test(k)))]
  const graves = avisos.filter(a => /Warning: (Invalid hook|Cannot update|React has detected|Each child|Encountered two children)/i.test(a))
  if (!html || html.length < 80) { mal++; console.log('✗', nombre, '→ salió vacío'); continue }
  if (crudas.length) { mal++; console.log('✗', nombre, '→ llaves sin rellenar:', crudas.join(' ')); continue }
  if (claves.length) { mal++; console.log('✗', nombre, '→ claves sin traducir:', claves.slice(0, 6).join(' ')); continue }
  if (graves.length) { mal++; console.log('✗', nombre, '→ aviso de React:', graves[0]); continue }
  ok++; console.log('✓', nombre, `(${Math.round(html.length / 1024)} KB)`)
}
fs.rmSync(OUT, { recursive: true, force: true })
console.log(`render: ${ok} ✓ ${mal} ✗`)
if (mal) process.exit(1)
