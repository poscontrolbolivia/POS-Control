// Panel de POS Control: menú numerado para git, pruebas y build.
// Lo abre install\panel-pos.bat (doble clic). No necesita nada instalado aparte de Node.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as rl0 from 'node:readline/promises'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MSG_COMMIT = 'Descripción de los cambios'
// Un git add . nunca debe llevarse esto: la clave del proyecto, los datos locales o el build.
const PROHIBIDO = /(^|\/)(node_modules|dist)\//

const run = (cmd, args, { recoger = false } = {}) => {
  const r = spawnSync(cmd, args, { cwd: RAIZ, encoding: 'utf8', shell: false, windowsHide: true })
  const salida = `${r.stdout || ''}${r.stderr || ''}`
  if (!recoger && salida.trim()) console.log(salida.trim())
  return { ok: r.status === 0, code: r.status, salida }
}
const git = (args, o) => run('git', args, o)
const npm = (args, o) => run('npm', args, { ...o, shell: true })

const rama = () => (hayRepo && git(['rev-parse', '--abbrev-ref', 'HEAD'], { recoger: true }).salida.trim().split('\n')[0] || 'main')
const hayRepo = git(['rev-parse', '--is-inside-work-tree'], { recoger: true }).ok
const remoto = git(['remote', 'get-url', 'origin'], { recoger: true }).salida.trim()

// Antes de commitear se revisa lo que va a entrar. Si algo parece una clave, se aborta.
function secretosDetectados() {
  const malos = []
  const archivos = git(['diff', '--cached', '--name-only'], { recoger: true }).salida.split('\n').filter(Boolean)
  for (const f of archivos) {
    if (PROHIBIDO.test(f) || /(^|\/)claves\.txt$/i.test(f) || /\.local\.json$/i.test(f) || /\.zip$/i.test(f)) malos.push(f)
  }
  const texto = git(['diff', '--cached'], { recoger: true }).salida
  const patrones = [/eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{10,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /service_role[\s\S]{0,40}eyJ/]
  if (patrones.some(p => p.test(texto))) malos.push('posible clave en el contenido de los cambios')
  return [...new Set(malos)]
}

async function unaVez(rl, { pullPrimero = true } = {}) {
  if (!hayRepo) { console.log('  Sin repo de git aquí. Para subir a GitHub: git init -b main, git remote add origin <url> y reabre el panel.'); return false }
  const r = rama()
  if (pullPrimero && remoto) {
    console.log('\n— Pull (para no pelearte con lo que subiste desde otro equipo)')
    const p = git(['pull', 'origin', r, '--no-edit'])
    if (!p.ok) { console.log('  El pull falló. Arregla el conflicto y vuelve a intentar la opción 1.'); return false }
  }
  console.log('\n— Qué cambió')
  const cambios = git(['status', '--short'], { recoger: true }).salida.trim()
  console.log(cambios || '  Nada: el repo está igual que el último commit.')
  if (!cambios) { console.log('  No hay nada que subir.'); return true }

  git(['add', '-A'])
  const staged = git(['diff', '--cached', '--name-status'], { recoger: true }).salida.trim()
  if (!staged) { console.log('  Nada staged (los cambios están ignorados por .gitignore).'); return true }
  console.log('\n— Va a subir esto:')
  console.log(staged.split('\n').map(l => '  ' + l).join('\n'))

  const malos = secretosDetectados()
  if (malos.length) {
    console.log('\n  ⛔ ABORTADO. Esto no puede subir a GitHub:')
    malos.forEach(x => console.log('   · ' + x))
    git(['reset'])
    console.log('  Se deshizo el staged (tus archivos siguen intactos). Quita eso del proyecto y reintenta.')
    return false
  }

  const resp = (await rl.question('\n  ¿Confirmas add + commit + push? (S/N) ')).trim().toLowerCase()
  if (resp !== 's' && resp !== 'si' && resp !== 'sí' && resp !== 'y') {
    console.log('  Cancelado. Los archivos siguen como estaban, nada subido.')
    return false
  }
  console.log('\n— Commit')
  const c = git(['commit', '-m', MSG_COMMIT])
  if (!c.ok) { console.log('  El commit falló.'); return false }
  if (!remoto) { console.log('  No hay remoto configurado: quedó commiteado solo en esta PC.'); return true }
  console.log('\n— Push')
  return git(['push', 'origin', r]).ok
}

function version() {
  try { return JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version } catch { return '?' }
}

// Recién descomprimido el ZIP no trae node_modules: sin eso, probar/compilar/abrir falla.
function dependencias({ haceFalta = true } = {}) {
  if (existsSync(join(RAIZ, 'node_modules'))) return true
  if (!haceFalta) { console.log('  Falta node_modules. Usa la opción 8 primero.'); return false }
  console.log('\n— Primera vez: instalando dependencias (tarda 1 o 2 minutos)')
  return npm(['install']).ok
}

// El ZIP entrega solo lo que necesita la web: sin tests/. La opción 4 lo avisa en vez de reventar.
function hayPruebas() {
  if (existsSync(join(RAIZ, 'tests'))) return true
  console.log('  Este ZIP no trae la carpeta tests/ (solo lleva lo necesario para la app).')
  console.log('  Las pruebas viven en el proyecto de trabajo; aquí usa la 5 para compilar y la 6 para abrir.')
  return false
}

const linea = (n, texto) => console.log(`  ${String(n).padEnd(2)}· ${texto}`)

async function main() {
  const rl = rl0.createInterface({ input: process.stdin, output: process.stdout })
  console.log('\n════ POS CONTROL · panel de trabajo ════')
  console.log(`  Carpeta : ${RAIZ}`)
  console.log(`  Versión : v${version()}`)
  console.log(`  Git     : ${hayRepo ? (remoto || 'sin remoto') : 'sin repo'} · rama ${rama()}`)
  if (!hayRepo) console.log('\n  Sin repo de git: sirve igual para instalar, compilar y abrir la app (8, 5, 6).')

  while (true) {
    console.log('\n  Elige un número y pulsa Enter:\n')
    linea(1, 'SUBIR TODO  (pull + add + commit + push)')
    linea(2, 'Ver qué cambió  (sin tocar nada)')
    linea(3, 'Bajar de GitHub  (pull, sin commitear)')
    linea(4, 'Probar el proyecto  (i18n + todas las pruebas)')
    linea(5, 'Compilar  (build real, carpeta dist)')
    linea(6, 'Abrir la app en el navegador  (servidor local)')
    linea(7, 'Estado de git + últimos commits')
    linea(8, 'Instalar dependencias  (npm install · hace falta la primera vez)')
    linea(0, 'Salir')
    const q = (await rl.question('\n  Opción: ')).trim()
    if (q === '0' || q.toLowerCase() === 's') break
    if (q === '1') await unaVez(rl)
    else if (q === '2') console.log(hayRepo ? (git(['status'], { recoger: true }).salida || '  Limpio.') : '  Sin repo de git: nada que ver. Usa 8, 5 o 6.')
    else if (q === '3') { if (!hayRepo) console.log('  Sin repo de git.'); else if (remoto) git(['pull', 'origin', rama(), '--no-edit']); else console.log('  Sin remoto.') }
    else if (q === '4') { if (hayPruebas() && dependencias()) npm(['test']) }
    else if (q === '5') { if (dependencias()) npm(['run', 'build']) }
    else if (q === '6') { if (dependencias()) { console.log('  Abre http://localhost:5173 · Ctrl+C para parar'); npm(['run', 'dev']) } }
    else if (q === '7') { if (!hayRepo) console.log('  Sin repo de git.'); else { console.log(git(['status', '--short'], { recoger: true }).salida || '  Limpio.'); console.log(git(['log', '--oneline', '-8'], { recoger: true }).salida) } }
    else if (q === '8') npm(['install'])
    else console.log('  Número no válido.')
  }
  rl.close()
  console.log('\n  Listo.\n')
}

main().catch(e => { console.error('\n  Error del panel:', e?.message || e); process.exitCode = 1 })
