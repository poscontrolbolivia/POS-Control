// Impresión en silencio por Web Serial API + comandos ESC/POS para impresoras térmicas USB
// de 58 mm (32 col) / 80 mm (48 col): Goojprt POS-580, Xprinter, etc.
// Solo funciona en Chrome/Edge (escritorio o Android) con HTTPS o localhost.
//
// VARIAS IMPRESORAS: cada "grupo de impresión" (Cocina, Barra…) tiene su propio puerto. Un mismo
// puerto puede servir a varios grupos (una sola impresora para todo). Los trabajos se serializan en
// UNA cola global (abrir → escribir → cerrar), así dos grupos que comparten puerto no se pisan.
// Web Serial NO persiste permisos entre sesiones: al arrancar se reutilizan los puertos ya
// emparejados con navigator.serial.getPorts(), reasignándolos a cada grupo por vendorId/productId
// (la correspondencia grupo→puerto se guarda en localStorage).

const ESC = 0x1b
const GS = 0x1d

// Tabla PC437 (code page por defecto de las térmicas ESC/POS) para caracteres frecuentes en español.
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

// grupo → { puerto, baud, error, ultimoError }
const grupos = new Map()
let cola = []              // trabajos en espera {grupo, lineas, ancho, corte, beep, resolver, rechazo}
let ejecutando = false
const escuchas = new Set() // suscriptores de estado (React)

const grupoDe = id => {
  const k = id || GRUPO_DEFECTO
  if (!grupos.has(k)) grupos.set(k, { puerto: null, baud: 9600, error: '', ultimoError: '' })
  return grupos.get(k)
}

const notificar = () => escuchas.forEach(f => { try { f() } catch { /* ignore */ } })

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

// Para que la UI reaccione a cambios de estado sin consultar a cada rato.
export function suscribirImpresora(fn) {
  escuchas.add(fn)
  return () => escuchas.delete(fn)
}

const leerMapa = () => { try { return JSON.parse(localStorage.getItem(LLAVE_MAPA)) || {} } catch { return {} } }
const guardarMapa = m => { try { localStorage.setItem(LLAVE_MAPA, JSON.stringify(m)) } catch { /* sin almacenamiento */ } }
const llavePuerto = p => { const i = p.getInfo?.() || {}; return `${i.usbVendorId ?? 'x'}:${i.usbProductId ?? 'x'}` }

// Detecta desconexión en caliente (cable fuera): todos los grupos que usaban ese puerto.
if (soporteSerial()) {
  try {
    navigator.serial.addEventListener('disconnect', e => {
      let alguno = false
      grupos.forEach(g => {
        if (g.puerto === e.target) { g.puerto = null; g.error = 'La impresora se desconectó. Vuelve a conectarla.'; alguno = true }
      })
      if (alguno) notificar()
    })
  } catch { /* ignore */ }
}

// Pide el puerto al usuario para UN grupo (el navegador muestra su selector de dispositivos).
export async function conectarImpresora({ grupo = GRUPO_DEFECTO, baud } = {}) {
  if (!soporteSerial()) throw new Error('Este navegador no soporta Web Serial (usa Chrome o Edge)')
  const g = grupoDe(grupo)
  const p = await navigator.serial.requestPort()
  g.puerto = p
  g.baud = Number(baud) || g.baud || 9600
  g.error = ''
  g.ultimoError = ''
  // Recuerda a qué grupo pertenece este puerto (n = posición entre los puertos iguales).
  try {
    const todos = await navigator.serial.getPorts()
    const k = llavePuerto(p)
    const iguales = todos.filter(x => llavePuerto(x) === k)
    const n = Math.max(0, iguales.indexOf(p))
    const m = leerMapa(); m[grupo || GRUPO_DEFECTO] = { k, n }; guardarMapa(m)
  } catch { /* sin getPorts: solo esta sesión */ }
  notificar()
  return estadoImpresora(grupo)
}

// Reasigna los puertos ya emparejados a sus grupos (getPorts no pide permiso). Llamar al arrancar
// la app o al montar la pantalla de impresoras. `lista`: [{ id, baud }].
export async function reutilizarImpresoras(lista = [{ id: GRUPO_DEFECTO }]) {
  if (!soporteSerial()) return false
  try {
    const puertos = await navigator.serial.getPorts()
    if (!puertos.length) return false
    const m = leerMapa()
    let alguno = false
    lista.forEach(({ id, baud }) => {
      const g = grupoDe(id)
      if (g.puerto && puertos.includes(g.puerto)) return // ya está conectado en esta sesión
      const quiere = m[id || GRUPO_DEFECTO]
      let p = null
      if (quiere) p = puertos.filter(x => llavePuerto(x) === quiere.k)[quiere.n] || null
      else if (lista.length === 1 && puertos.length === 1) p = puertos[0] // instalación de una sola impresora
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

// ---------- generación de bytes ESC/POS ----------

function byteDeCh(ch) {
  const directo = PC437[ch]
  if (directo !== undefined) return directo
  const code = ch.codePointAt(0)
  if (code <= 0x7f) return code
  // tildes no cubiertos: quitar diacríticos y reintentar; si sigue sin ser ASCII → '?'
  const des = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (des && des.length === 1 && PC437[des] !== undefined) return PC437[des]
  if (des && des.codePointAt(0) <= 0x7f) return des.codePointAt(0)
  return 0x3f // '?'
}

const textoABytes = t => { const out = []; for (const ch of String(t)) out.push(byteDeCh(ch)); return out }

// Línea con relleno de guiones: si el texto trae tabulador → "izquierda\tDerecha" justificado;
// si no hay tabulador, se trunca a las columnas del ancho.
function guion(texto, cols) {
  if (!texto) return '-'.repeat(cols)                     // separador: línea entera de guiones
  if (!texto.includes('\t')) return texto.slice(0, cols)
  const [izq, der = ''] = texto.split('\t')
  const espacio = Math.max(1, cols - izq.length - der.length)
  return (izq + '-'.repeat(espacio) + der).slice(0, cols)
}

// Texto final de una línea (mismas reglas que la térmica): útil para imprimir en impresoras de Windows.
export function lineaATexto(l, ancho = 32) {
  const tam = Math.min(4, Math.max(1, Number(l?.tam) || 1))
  const cols = Math.max(8, Math.floor(ancho / tam))
  const t = String(l?.texto ?? '')
  return l?.guion ? guion(t, cols) : t.slice(0, cols)
}

function generarBytes({ lineas = [], ancho = 32, corte = true, beep = false } = {}) {
  const b = [ESC, 0x40, ESC, 0x74, 0x00] // ESC @ inicializar + ESC t 0 (tabla PC437)
  for (const l of lineas) {
    const tam = Math.min(4, Math.max(1, Number(l.tam) || 1)) // multiplicador GS ! (ancho x alto)
    const cols = Math.max(8, Math.floor(ancho / tam))
    b.push(ESC, 0x61, l.centrado ? 1 : l.derecha ? 2 : 0) // ESC a alineación
    b.push(ESC, 0x45, l.negrita ? 1 : 0)                  // ESC E negrita
    b.push(GS, 0x21, ((tam - 1) << 4) | (tam - 1))        // GS ! tamaño
    let t = String(l.texto ?? '')
    t = l.guion ? guion(t, cols) : t.slice(0, cols)
    b.push(...textoABytes(t), 0x0a)                       // texto + salto de línea
    b.push(ESC, 0x45, 0x00, GS, 0x21, 0x00)               // resetear negrita/tamaño
  }
  if (beep) b.push(ESC, 0x70, 0x00, 0x19, 0xfa)           // ESC p: pitido (25, 250 ms)
  b.push(ESC, 0x64, 0x04)                                 // ESC d 4: alimenta 4 líneas
  if (corte) b.push(GS, 0x56, 0x42, 0x00)                 // GS V B 0: corta (parcial con avance)
  return Uint8Array.from(b)
}

// ---------- escritura por writable stream (abre → escribe → cierra writer y puerto) ----------

async function escribirBytes(puerto, baudRate, bytes) {
  if (!puerto) throw new Error('No hay impresora conectada')
  await puerto.open({ baudRate })
  let fallo = null
  try {
    const writer = puerto.writable.getWriter()
    try {
      for (let i = 0; i < bytes.length; i += 200) {
        await writer.write(bytes.slice(i, i + 200)) // trozos pequeños: no saturar el buffer de la térmica
      }
    } catch (e) { fallo = e }
    try { await writer.close() } catch { try { writer.releaseLock() } catch { /* ignore */ } } // CIERRA el writer tras cada trabajo
  } catch (e) {
    if (!fallo) fallo = e // puerto.writable indisponible
  } finally {
    try { await puerto.close() } catch { /* ignore */ }
  }
  if (fallo) throw fallo
}

// ---------- cola global (uno a la vez, 1 reintento, error visible por grupo) ----------

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
      if (intento === 0 && g.puerto) { // reintenta UNA vez (el puerto puede necesitar respirar)
        intento++
        await new Promise(r => setTimeout(r, 400))
        continue
      }
      g.error = g.ultimoError // error visible mientras la UI no reconecte
      rechazo(new Error(g.ultimoError))
      break
    }
  }
  ejecutando = false
  notificar()
  procesarCola() // sigue con el siguiente trabajo
}

// lineas: [{ texto, negrita, tam, centrado, guion }] · resuelve 'silencioso' o rechaza con el error.
export function imprimirSilencioso({ grupo = GRUPO_DEFECTO, lineas, ancho = 32, corte = true, beep = false } = {}) {
  if (!soporteSerial()) return Promise.reject(new Error('Web Serial no soportado por este navegador'))
  if (!grupoDe(grupo).puerto) return Promise.reject(new Error('No hay impresora conectada'))
  return new Promise((resolver, rechazo) => {
    cola.push({ grupo: grupo || GRUPO_DEFECTO, lineas, ancho: Number(ancho) || 32, corte, beep, resolver, rechazo })
    notificar()
    procesarCola()
  })
}
