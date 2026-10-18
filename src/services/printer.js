const ESC = 0x1b
const GS = 0x1d

const PC437 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d, '₧': 0x9e, 'ƒ': 0x9f,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '®': 0xa9, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  '─': 0xc0, '│': 0xb3, '┌': 0xda, '┐': 0xbf, '└': 0xc0, '┘': 0xd9, '█': 0xdb, '▄': 0xdd,
  '▀': 0xdc, '▓': 0xdb, '▒': 0xb1, '░': 0xb0, '•': 0xf5, '€': 0xd5,
}

export const GRUPO_DEFECTO = 'general'
const LLAVE_MAPA = 'pos-impresoras-puertos'

const grupos = new Map()
let cola = []
let ejecutando = false
const escuchas = new Set()

const grupoDe = id => {
  const k = id || GRUPO_DEFECTO
  if (!grupos.has(k)) grupos.set(k, { puerto: null, baud: 9600, error: '', ultimoError: '' })
  return grupos.get(k)
}

const notificar = () => escuchas.forEach(f => { try { f() } catch {  } })

export const soporteSerial = () => typeof navigator !== 'undefined' && Boolean(navigator.serial)

export function estadoImpresora(grupo = GRUPO_DEFECTO) {
  const g = grupoDe(grupo)
  return {
    soportado: soporteSerial(),
    conectada: Boolean(g.puerto),
    baudRate: g.baud,
    error: g.error,
    ultimoError: g.ultimoError,
    cola: cola.filter(j => j.grupo === (grupo || GRUPO_DEFECTO)).length,
    ocupado: ejecutando,
  }
}

export function suscribirImpresora(fn) {
  escuchas.add(fn)
  return () => escuchas.delete(fn)
}

const leerMapa = () => { try { return JSON.parse(localStorage.getItem(LLAVE_MAPA)) || {} } catch { return {} } }
const guardarMapa = m => { try { localStorage.setItem(LLAVE_MAPA, JSON.stringify(m)) } catch {  } }
const llavePuerto = p => { const i = p.getInfo?.() || {}; return `${i.usbVendorId ?? 'x'}:${i.usbProductId ?? 'x'}` }

if (soporteSerial()) {
  try {
    navigator.serial.addEventListener('disconnect', e => {
      let alguno = false
      grupos.forEach(g => {
        if (g.puerto === e.target) { g.puerto = null; g.error = 'La impresora se desconectó. Vuelve a conectarla.'; alguno = true }
      })
      if (alguno) notificar()
    })
  } catch {  }
}

export async function conectarImpresora({ grupo = GRUPO_DEFECTO, baud } = {}) {
  if (!soporteSerial()) throw new Error('Este navegador no soporta Web Serial (usa Chrome o Edge)')
  const g = grupoDe(grupo)
  const p = await navigator.serial.requestPort()
  g.puerto = p
  g.baud = Number(baud) || g.baud || 9600
  g.error = ''
  g.ultimoError = ''

  try {
    const todos = await navigator.serial.getPorts()
    const k = llavePuerto(p)
    const iguales = todos.filter(x => llavePuerto(x) === k)
    const n = Math.max(0, iguales.indexOf(p))
    const m = leerMapa(); m[grupo || GRUPO_DEFECTO] = { k, n }; guardarMapa(m)
  } catch {  }
  notificar()
  return estadoImpresora(grupo)
}

export async function reutilizarImpresoras(lista = [{ id: GRUPO_DEFECTO }]) {
  if (!soporteSerial()) return false
  try {
    const puertos = await navigator.serial.getPorts()
    if (!puertos.length) return false
    const m = leerMapa()
    let alguno = false
    lista.forEach(({ id, baud }) => {
      const g = grupoDe(id)
      if (g.puerto && puertos.includes(g.puerto)) return
      const quiere = m[id || GRUPO_DEFECTO]
      let p = null
      if (quiere) p = puertos.filter(x => llavePuerto(x) === quiere.k)[quiere.n] || null
      else if (lista.length === 1 && puertos.length === 1) p = puertos[0]
      if (p) { g.puerto = p; g.baud = Number(baud) || g.baud; g.error = ''; alguno = true }
    })
    if (alguno) notificar()
    return alguno
  } catch { return false }
}

export async function desconectarImpresora(grupo = GRUPO_DEFECTO) {
  const g = grupoDe(grupo)
  g.puerto = null
  g.error = ''
  const m = leerMapa(); delete m[grupo || GRUPO_DEFECTO]; guardarMapa(m)
  notificar()
}

export const fijarBaud = (grupo, baud) => { grupoDe(grupo).baud = Number(baud) || 9600 }

function byteDeCh(ch) {
  const directo = PC437[ch]
  if (directo !== undefined) return directo
  const code = ch.codePointAt(0)
  if (code <= 0x7f) return code

  const des = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (des && des.length === 1 && PC437[des] !== undefined) return PC437[des]
  if (des && des.codePointAt(0) <= 0x7f) return des.codePointAt(0)
  return 0x3f
}

const textoABytes = t => { const out = []; for (const ch of String(t)) out.push(byteDeCh(ch)); return out }

function guion(texto, cols) {
  if (!texto) return '-'.repeat(cols)
  if (!texto.includes('\t')) return texto.slice(0, cols)
  const [izq, der = ''] = texto.split('\t')
  const espacio = Math.max(1, cols - izq.length - der.length)
  return (izq + '-'.repeat(espacio) + der).slice(0, cols)
}

export function lineaATexto(l, ancho = 32) {
  const tam = Math.min(4, Math.max(1, Number(l?.tam) || 1))
  const cols = Math.max(8, Math.floor(ancho / tam))
  const t = String(l?.texto ?? '')
  return l?.guion ? guion(t, cols) : t.slice(0, cols)
}

export function generarTexto({ lineas = [], ancho = 32, corte = true } = {}) {
  const a = Number(ancho) || 32
  const cuerpo = lineas.map(l => {

    const t = lineaATexto({ ...l, tam: 1 }, a)
    const i = t.indexOf('\t')
    if (i < 0) return t
    const izq = t.slice(0, i), der = t.slice(i + 1)
    return izq + ' '.repeat(Math.max(1, a - izq.length - der.length)) + der
  }).join('\n')
  return cuerpo + '\n' + (corte ? '\n\n\n' : '\n')
}

export function generarBytes({ lineas = [], ancho = 32, corte = true, beep = false } = {}) {
  const b = [ESC, 0x40, ESC, 0x74, 0x00]
  for (const l of lineas) {
    const tam = Math.min(4, Math.max(1, Number(l.tam) || 1))
    const cols = Math.max(8, Math.floor(ancho / tam))
    b.push(ESC, 0x61, l.centrado ? 1 : l.derecha ? 2 : 0)
    b.push(ESC, 0x45, l.negrita ? 1 : 0)
    b.push(GS, 0x21, ((tam - 1) << 4) | (tam - 1))
    let t = String(l.texto ?? '')
    t = l.guion ? guion(t, cols) : t.slice(0, cols)
    b.push(...textoABytes(t), 0x0a)
    b.push(ESC, 0x45, 0x00, GS, 0x21, 0x00)
  }
  if (beep) b.push(ESC, 0x70, 0x00, 0x19, 0xfa)
  b.push(ESC, 0x64, 0x04)
  if (corte) b.push(GS, 0x56, 0x42, 0x00)
  return Uint8Array.from(b)
}

async function escribirBytes(puerto, baudRate, bytes) {
  if (!puerto) throw new Error('No hay impresora conectada')
  await puerto.open({ baudRate })
  let fallo = null
  try {
    const writer = puerto.writable.getWriter()
    try {
      for (let i = 0; i < bytes.length; i += 200) {
        await writer.write(bytes.slice(i, i + 200))
      }
    } catch (e) { fallo = e }
    try { await writer.close() } catch { try { writer.releaseLock() } catch {  } }
  } catch (e) {
    if (!fallo) fallo = e
  } finally {
    try { await puerto.close() } catch {  }
  }
  if (fallo) throw fallo
}

async function procesarCola() {
  if (ejecutando) return
  const trabajo = cola.shift()
  if (!trabajo) return
  ejecutando = true
  notificar()
  const { resolver, rechazo, grupo, ...params } = trabajo
  const g = grupoDe(grupo)
  const bytes = generarBytes(params)
  let intento = 0
  for (;;) {
    try {
      await escribirBytes(g.puerto, g.baud, bytes)
      g.error = ''
      resolver('silencioso')
      break
    } catch (e) {
      g.ultimoError = String(e?.message || e || 'Error de impresión')
      if (intento === 0 && g.puerto) {
        intento++
        await new Promise(r => setTimeout(r, 400))
        continue
      }
      g.error = g.ultimoError
      rechazo(new Error(g.ultimoError))
      break
    }
  }
  ejecutando = false
  notificar()
  procesarCola()
}

export function imprimirSilencioso({ grupo = GRUPO_DEFECTO, lineas, ancho = 32, corte = true, beep = false } = {}) {
  if (!soporteSerial()) return Promise.reject(new Error('Web Serial no soportado por este navegador'))
  if (!grupoDe(grupo).puerto) return Promise.reject(new Error('No hay impresora conectada'))
  return new Promise((resolver, rechazo) => {
    cola.push({ grupo: grupo || GRUPO_DEFECTO, lineas, ancho: Number(ancho) || 32, corte, beep, resolver, rechazo })
    notificar()
    procesarCola()
  })
}
