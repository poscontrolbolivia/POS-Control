// Genera el SQL para BORRAR LOS DATOS de UNA empresa (y dejarla como nueva), ya con su código dentro.
// Uso: doble clic en install\borrar-empresa.bat. Crea install\reset-<codigo>-<fecha>.sql, lo copia al portapapeles
// y tú solo lo pegas en Supabase → SQL Editor → Run. El archivo generado NO se sube a git (bórralo al terminar).
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const instalar = path.resolve(aqui, '..', 'install')
const plantilla = path.join(instalar, 'supabase-reset-empresa.sql')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
const lineas = rl[Symbol.asyncIterator]()
const preguntar = async q => { process.stdout.write(q); const { value } = await lineas.next(); return String(value ?? '').trim() }
const salir = (msg, code = 1) => { console.log('\n' + msg); rl.close(); process.exit(code) }

if (!fs.existsSync(plantilla)) salir('ERROR: no se encuentra install\\supabase-reset-empresa.sql junto a este programa.')

console.log('============================================================')
console.log(' POS Control · BORRAR LOS DATOS DE UNA EMPRESA')
console.log('============================================================')
console.log(' Esto prepara el SQL; todavía NO borra nada. Lo borra Supabase')
console.log(' cuando tú pegas el SQL generado y pulsas Run. No se deshace.\n')

const codigo = await preguntar('Código de la empresa a borrar (el que se usa para entrar): ')
if (!/^[A-Za-z0-9._-]+$/.test(codigo)) salir('Código no válido: solo letras, números, punto, guion y guion bajo.')
const otra = await preguntar('Escribe el código OTRA VEZ para confirmar: ')
if (otra !== codigo) salir('Los códigos no coinciden. No se generó nada.')
const equipo = /^[sSyY]/.test(await preguntar('¿Quitar también de la empresa al equipo que no es admin? (S/N) [N]: '))
const conf = await preguntar('Escribe BORRAR TODO (en mayúsculas) para generar el SQL: ')
if (conf !== 'BORRAR TODO') salir('No escribiste BORRAR TODO. No se generó nada.')

let sql = fs.readFileSync(plantilla, 'utf8')
const cambios = [
  [/'CAMBIA-ESTE-CODIGO'::text(\s+)as codigo/, `'${codigo}'::text$1as codigo`],
  [/'NO'::text(\s+)as confirmar/, `'BORRAR TODO'::text$1as confirmar`],
  [/false(\s+)as borrar_equipo/, `${equipo}$1as borrar_equipo`],
]
for (const [re, nuevo] of cambios) {
  if (!re.test(sql)) salir('ERROR: la plantilla supabase-reset-empresa.sql cambió y no se pudo rellenar. Avisa para actualizar este programa.')
  sql = sql.replace(re, nuevo)
}
const ahora = new Date()
const p2 = n => String(n).padStart(2, '0')
const sello = `${ahora.getFullYear()}${p2(ahora.getMonth() + 1)}${p2(ahora.getDate())}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}`
const aviso = `-- ⚠️ GENERADO el ${ahora.toLocaleString('es')} para la empresa «${codigo}»${equipo ? ' (también quita al equipo no admin)' : ''}.\n`
  + '-- Ya trae la confirmación puesta: al pulsar Run se BORRAN los datos de esa empresa. Bórralo de tu computadora al terminar.\n\n'
const archivo = path.join(instalar, `reset-${codigo}-${sello}.sql`)
fs.writeFileSync(archivo, aviso + sql, 'utf8')

let copiado = false
if (process.platform === 'win32') {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 -LiteralPath '${archivo.replace(/'/g, "''")}' | Set-Clipboard`], { stdio: 'ignore' })
  copiado = r.status === 0
}
console.log('\n✅ Listo. Se creó:\n   ' + archivo)
console.log(copiado ? '\n📋 Ya está copiado al portapapeles: ve a Supabase → SQL Editor → pega (Ctrl+V) → Run.'
  : '\nAbre ese archivo, copia TODO, y pégalo en Supabase → SQL Editor → Run.')
console.log('   Al terminar, la tabla del resultado debe decir «✅ OK». Después borra el archivo generado.')
rl.close()
