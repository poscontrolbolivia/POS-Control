// Auditoría del estado: abrir mesa con un toque, descartar si se tocó por error, para llevar → mesa.
// Compila StoreContext con vite (modo SSR) en una carpeta temporal y prueba el reducer real.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUD = path.join(RAIZ, 'src/context/_audit.jsx')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-audit-'))
fs.writeFileSync(AUD, fs.readFileSync(path.join(RAIZ, 'src/context/StoreContext.jsx'), 'utf8') + '\nexport { reducer }\n')
try {
  await build({ root: RAIZ, logLevel: 'silent', configFile: false, plugins: [react()], ssr: { noExternal: true },
    build: { ssr: AUD, outDir: OUT, emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'b.mjs', format: 'es' } } } })
} finally { fs.rmSync(AUD, { force: true }) }
const { reducer } = await import(pathToFileURL(path.join(OUT, 'b.mjs')).href)
fs.rmSync(OUT, { recursive: true, force: true })

let ok = 0, mal = 0
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n) } }
const base = { mesas: [{ id: 'm1', nombre: 'Mesa 1', cap: 4, zona: 'z' }, { id: 'm2', nombre: 'Mesa 2', cap: 4, zona: 'z' }], zonas: [{ id: 'z', nombre: 'Sala' }], cuentas: [], config: {}, caja: {}, secciones: [], productos: [], alertas: [] }

const s = reducer(base, { t: 'abrir', mesaId: 'm1', comensales: 1, usuario: 'ana' })
const id = s.cuentas[0].id
t('abrir crea una cuenta con 1 comensal', s.cuentas.length === 1 && s.cuentas[0].comensales === 1)
t('comensales se cambian dentro', reducer(s, { t: 'comensales~', cuentaId: id, comensales: 5 }).cuentas[0].comensales === 5)
t('abrir la misma mesa dos veces no duplica', reducer(s, { t: 'abrir', mesaId: 'm1', comensales: 1, usuario: 'x' }).cuentas.length === 1)
t('cuenta vacía se descarta', reducer(s, { t: 'abrir-descartar', cuentaId: id }).cuentas.length === 0)
t('con ítems NO se descarta', reducer({ ...s, cuentas: [{ ...s.cuentas[0], items: [{ id: 'i', estado: 'pendiente', qty: 1, precio: 1, nombre: 'x' }] }] }, { t: 'abrir-descartar', cuentaId: id }).cuentas.length === 1)
t('con pagos NO se descarta', reducer({ ...s, cuentas: [{ ...s.cuentas[0], pagos: [{ monto: 1 }] }] }, { t: 'abrir-descartar', cuentaId: id }).cuentas.length === 1)
t('cerrada NO se descarta', reducer({ ...s, cuentas: [{ ...s.cuentas[0], estado: 'cerrada' }] }, { t: 'abrir-descartar', cuentaId: id }).cuentas.length === 1)
const s2 = reducer({ ...s, cuentas: [{ ...s.cuentas[0], estado: 'cerrada' }] }, { t: 'abrir', mesaId: 'm1', comensales: 1, usuario: 'x' })
t('mesa con cuenta cerrada se puede volver a abrir', s2.cuentas.filter(c => c.estado !== 'cerrada').length === 1)

const l = reducer(base, { t: 'abrir-llevar', id: 'L1', nombre: 'Ernesto', tel: '7', usuario: 'ana' })
t('para llevar: cliente 1', l.cuentas[0]?.canal === 'llevar' && l.cuentas[0].numero === 1)
t('para llevar: cliente 2', reducer(l, { t: 'abrir-llevar', id: 'L2', nombre: 'Rosa', tel: '', usuario: 'ana' }).cuentas.filter(c => c.canal === 'llevar').map(c => c.numero).sort().join() === '1,2')
const lm = reducer(l, { t: 'llevar-mesa', cuentaId: l.cuentas[0].id, mesaId: 'm2', comensales: 3 })
t('para llevar → mesa', lm.cuentas[0].tipo === 'mesa' && lm.cuentas[0].mesaIds[0] === 'm2' && lm.cuentas[0].comensales === 3)
console.log(`estadoMesas: ${ok} ✓ ${mal} ✗`)
if (mal) process.exit(1)
