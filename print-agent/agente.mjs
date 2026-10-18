import http from 'node:http'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir, homedir, platform, hostname } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '1.1.1'
const args = process.argv.slice(2)
const arg = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def }
const WIN = platform() === 'win32'
const AQUI = dirname(fileURLToPath(import.meta.url))
const MAX_BYTES = 1024 * 1024

let conf = {}
try {
  const txt = await fs.readFile(join(AQUI, 'agente.conf'), 'utf8')
  for (const l of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.*)$/.exec(l)
    if (m) conf[m[1].toLowerCase()] = m[2].trim()
  }
} catch {  }

const PUERTO = Number(arg('--puerto', process.env.POS_AGENTE_PUERTO || conf.puerto || 9101))
const ORIGENES = args.flatMap((a, i) => (a === '--origen' ? [String(args[i + 1] || '').replace(/\/$/, '')] : []))
if (!ORIGENES.length && conf.origen) ORIGENES.push(...conf.origen.split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean))
if (process.env.POS_AGENTE_ORIGENES) ORIGENES.push(...process.env.POS_AGENTE_ORIGENES.split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean))
const SIMULAR = process.env.POS_AGENTE_SIMULAR === '1' || String(conf.simular || '') === '1'

const CARPETA_LOG = process.env.POS_AGENTE_LOG || (WIN
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'POSControl', 'agente')
  : join(homedir(), '.poscontrol', 'agente'))
const ARCHIVO_LOG = join(CARPETA_LOG, 'agente.log')
const CON_LOG = process.env.POS_AGENTE_SIN_LOG !== '1'
const ARRANCO = new Date().toISOString()
let ultimo = ''
let carpetaLista = null

function bitacora(txt) {
  const s = String(txt)
  console.log(s)
  if (!CON_LOG) return

  carpetaLista = carpetaLista || fs.mkdir(CARPETA_LOG, { recursive: true }).catch(() => {})
  carpetaLista.then(() => fs.appendFile(ARCHIVO_LOG, `${new Date().toISOString()} ${s}\n`)).catch(() => {  })
}

async function recortarLog() {
  try {
    const st = await fs.stat(ARCHIVO_LOG)
    if (st.size <= 400 * 1024) return
    const todo = await fs.readFile(ARCHIVO_LOG, 'utf8')
    await fs.writeFile(ARCHIVO_LOG, todo.slice(-200 * 1024))
  } catch {  }
}

const correr = (cmd, a, opciones = {}) => new Promise((ok, mal) => {
  execFile(cmd, a, { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024, ...opciones }, (e, out, err) => (e ? mal(new Error((err || e.message).toString().trim())) : ok(String(out))))
})

const PS_RAW = `
param([string]$Impresora,[string]$Archivo)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices;
public class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] static extern bool StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA d);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h; if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw new Exception("No se pudo abrir la impresora '" + impresora + "' (error " + Marshal.GetLastWin32Error() + ")");
    try {
      var di = new DOCINFOA(); di.pDocName = "POS Control"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter fallo (error " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter fallo");
        IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
        try { Marshal.Copy(datos, 0, p, datos.Length); int w; if (!WritePrinter(h, p, datos.Length, out w) || w != datos.Length) throw new Exception("WritePrinter fallo (error " + Marshal.GetLastWin32Error() + ")"); }
        finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[RawPrn]::Enviar($Impresora, [System.IO.File]::ReadAllBytes($Archivo))
`

const PS_TEXTO = `
param([string]$Impresora,[string]$Archivo)
$ErrorActionPreference='Stop'
[System.IO.File]::ReadAllText($Archivo, [System.Text.Encoding]::UTF8) | Out-Printer -Name $Impresora
`

let scriptRaw = null, scriptTexto = null
async function psRaw() {
  if (!scriptRaw) { scriptRaw = join(tmpdir(), 'pos-agente-raw.ps1'); await fs.writeFile(scriptRaw, PS_RAW, 'utf8') }
  return scriptRaw
}
async function psTexto() {
  if (!scriptTexto) { scriptTexto = join(tmpdir(), 'pos-agente-texto.ps1'); await fs.writeFile(scriptTexto, PS_TEXTO, 'utf8') }
  return scriptTexto
}

let cacheLista = null, cacheEn = 0
async function listar(sinMemoria = false) {
  if (!sinMemoria && cacheLista && Date.now() - cacheEn < 30000) return cacheLista
  let r
  if (SIMULAR) r = { predeterminada: 'Impresora Prueba 1', impresoras: ['Impresora Prueba 1', 'Impresora Prueba 2'] }
  else if (WIN) {
    const out = await correr('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress'])
    const j = out.trim() ? JSON.parse(out) : []
    const lista = Array.isArray(j) ? j : [j]
    r = { predeterminada: (lista.find(p => p.Default) || {}).Name || '', impresoras: lista.map(p => p.Name).filter(Boolean) }
  } else {
    const nombres = (await correr('lpstat', ['-e']).catch(() => '')).split('\n').map(x => x.trim()).filter(Boolean)
    const def = (await correr('lpstat', ['-d']).catch(() => '')).split(':')[1]?.trim() || ''
    r = { predeterminada: def, impresoras: nombres }
  }
  cacheLista = r; cacheEn = Date.now()
  return r
}

async function imprimir(impresora, bytes, modo) {
  const { impresoras } = await listar()
  if (!impresoras.includes(impresora)) throw new Error(`La impresora «${impresora}» no existe en esta PC`)
  const txt = modo === 'texto' ? new TextDecoder('utf-8').decode(bytes) : null
  if (SIMULAR) {
    const dir = join(AQUI, 'simulado'); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, `${Date.now()}-${impresora.replace(/[^\w-]+/g, '_')}.${modo === 'texto' ? 'txt' : 'bin'}`), modo === 'texto' ? txt : bytes)
    return
  }
  const tmp = join(tmpdir(), `pos-trabajo-${process.pid}-${Date.now()}.${modo === 'texto' ? 'txt' : 'bin'}`)
  await fs.writeFile(tmp, modo === 'texto' ? txt.replace(/\n/g, '\r\n') : bytes)
  try {
    if (WIN) {
      if (modo === 'texto') await correr('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', await psTexto(), '-Impresora', impresora, '-Archivo', tmp])
      else await correr('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', await psRaw(), '-Impresora', impresora, '-Archivo', tmp])
    } else if (modo === 'texto') await correr('lp', ['-d', impresora, tmp])
    else await correr('lp', ['-d', impresora, '-o', 'raw', tmp])
  } finally { fs.unlink(tmp).catch(() => {}) }
}

const permitido = origen => !origen || !ORIGENES.length || ORIGENES.includes(origen.replace(/\/$/, ''))

function cabeceras(req, res) {
  const origen = req.headers.origin
  if (origen && permitido(origen)) res.setHeader('Access-Control-Allow-Origin', origen)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '600')
}
const responder = (res, codigo, cuerpo) => { res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(cuerpo)) }
const leerCuerpo = req => new Promise((ok, mal) => {
  let n = 0; const trozos = []
  req.on('data', c => { n += c.length; if (n > MAX_BYTES * 2) { mal(new Error('Trabajo demasiado grande')); req.destroy() } else trozos.push(c) })
  req.on('end', () => ok(Buffer.concat(trozos).toString('utf8')))
  req.on('error', mal)
})

const servidor = http.createServer(async (req, res) => {
  cabeceras(req, res)
  if (!permitido(req.headers.origin)) return responder(res, 403, { ok: false, error: 'Origen no permitido. Inícialo con --origen https://tu-app' })

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  try {
    const ruta = new URL(req.url, 'http://x').pathname
    if (req.method === 'GET' && ruta === '/estado') {
      const n = cacheLista ? cacheLista.impresoras.length : 0
      return responder(res, 200, {
        ok: true, version: VERSION, sistema: platform(), simulado: SIMULAR, pc: hostname(),
        impresoras: n, puerto: PUERTO, origen: ORIGENES, log: CON_LOG ? ARCHIVO_LOG : '', arranque: ARRANCO, ultimo,
      })
    }
    if (req.method === 'GET' && ruta === '/impresoras') return responder(res, 200, { ok: true, ...(await listar(true)) })
    if (req.method === 'POST' && ruta === '/imprimir') {
      const { impresora, datos, modo } = JSON.parse((await leerCuerpo(req)) || '{}')
      if (!impresora || typeof impresora !== 'string') return responder(res, 400, { ok: false, error: 'Falta la impresora' })
      const bytes = Buffer.from(String(datos || ''), 'base64')
      if (!bytes.length) return responder(res, 400, { ok: false, error: 'Trabajo vacío' })
      if (bytes.length > MAX_BYTES) return responder(res, 413, { ok: false, error: 'Trabajo demasiado grande' })
      const m = modo === 'texto' ? 'texto' : 'raw'
      try {
        await imprimir(impresora, bytes, m)
        ultimo = `${new Date().toLocaleString()} · ${impresora} · ${m} · ${bytes.length} B`
        bitacora(`OK  ${ultimo}`)
        return responder(res, 200, { ok: true })
      } catch (e) {
        ultimo = `${new Date().toLocaleString()} · ${impresora} · ERROR · ${String(e?.message || e)}`
        bitacora(ultimo)
        throw e
      }
    }
    if (req.method === 'POST' && ruta === '/apagar') {

      responder(res, 200, { ok: true })
      bitacora('Apagado por solicitud (desinstalar-agente.bat)')
      setTimeout(() => process.exit(0), 60)
      return
    }
    responder(res, 404, { ok: false, error: 'No existe' })
  } catch (e) { responder(res, 500, { ok: false, error: String(e?.message || e) }) }
})

servidor.on('error', e => {

  if (e.code === 'EADDRINUSE') { console.log(`Ya hay un agente de impresión en el puerto ${PUERTO}; este se cierra.`); process.exit(0) }
  bitacora('Error al abrir el puerto: ' + (e.message || e)); process.exit(1)
})
servidor.listen(PUERTO, '127.0.0.1', async () => {
  await recortarLog().catch(() => {})
  bitacora(`── Agente v${VERSION} · puerto ${PUERTO} · ${hostname()} · Node ${process.version} ──`)
  console.log(`Agente de impresión POS Control v${VERSION} · http://127.0.0.1:${PUERTO}${SIMULAR ? ' · MODO PRUEBA (no imprime)' : ''}`)
  console.log(ORIGENES.length ? `Solo acepta la app desde: ${ORIGENES.join(', ')}` : '⚠ Acepta cualquier página web de ESTA PC. Recomendado: --origen https://tu-app.vercel.app')
  if (CON_LOG) console.log(`Bitácora: ${ARCHIVO_LOG}`)
  listar().catch(() => {})
})
