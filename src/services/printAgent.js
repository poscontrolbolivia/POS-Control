const LLAVE_URL = 'pos-agente-url'
const URL_AGENTE_DEFECTO = 'http://127.0.0.1:9101'

export const urlAgente = () => { try { return localStorage.getItem(LLAVE_URL) || URL_AGENTE_DEFECTO } catch { return URL_AGENTE_DEFECTO } }
export const fijarUrlAgente = url => { try { localStorage.setItem(LLAVE_URL, String(url || '').trim().replace(/\/$/, '') || URL_AGENTE_DEFECTO) } catch {  } }

// Chrome restringe las peticiones de una web pública a la red local (Local Network Access): hay que
// declarar a qué espacio de direcciones se dirige la petición (loopback = esta PC, local = red del local).
// Además no se molesta a la red si no hace falta: en celulares sin agente configurado no se pide nada y,
// si una consulta de fondo falla, no se repite durante un minuto.
const esLoopback = u => /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:|\/|$)/i.test(u)
const esRedLocal = u => /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(u)
const esMovil = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
const ESPERA_TRAS_FALLO_MS = 60 * 1000
let fallaHasta = 0

async function pedir(ruta, opciones = {}, ms = 6000, { fondo = false } = {}) {
  const base = urlAgente()
  if (esMovil() && base === URL_AGENTE_DEFECTO) throw new Error('El agente de impresión es solo para PC con Windows')
  if (fondo && Date.now() < fallaHasta) throw new Error('El agente de impresión no responde')
  const espacio = esLoopback(base) ? 'loopback' : esRedLocal(base) ? 'local' : null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(base + ruta, { ...opciones, signal: ctl.signal, ...(espacio ? { targetAddressSpace: espacio } : {}) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) throw new Error(j.error || `El agente respondió ${r.status}`)
    fallaHasta = 0
    return j
  } catch (e) {
    if (fondo || e?.name === 'AbortError' || e instanceof TypeError) fallaHasta = Date.now() + ESPERA_TRAS_FALLO_MS
    if (e?.name === 'AbortError') throw new Error('El agente de impresión no responde')
    if (e instanceof TypeError) throw new Error('No se encontró el agente de impresión en esta PC. Ábrelo (iniciar-agente.bat) o revisa su dirección.')
    throw e
  } finally { clearTimeout(timer) }
}

// «fondo»: consulta automática (no pedida por el usuario); se salta si el agente falló hace menos de un minuto.
export const estadoAgente = ({ fondo = false } = {}) => pedir('/estado', {}, 2500, { fondo })

export const listarImpresorasAgente = ({ fondo = false } = {}) => pedir('/impresoras', {}, 6000, { fondo })

export async function imprimirPorAgente(nombre, bytes, modo = 'raw') {
  if (!nombre) throw new Error('Elige una impresora de Windows para este grupo')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  await pedir('/imprimir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ impresora: nombre, datos: btoa(bin), modo: modo === 'texto' ? 'texto' : 'raw' }),
  }, 20000)
  return 'agente'
}

const ORIGEN_VALIDO = o => /^https?:\/\/[A-Za-z0-9.:_~+\-%@]{3,140}$/.test(String(o || '').replace(/\/+$/, ''))

async function textoInstalador() {
  const r = await fetch('/instalar-agente.bat', { cache: 'no-store' })
  if (!r.ok) throw new Error('El sitio no tiene instalar-agente.bat (falta public/instalar-agente.bat)')
  const txt = await r.text()
  if (!/^set "ORIGEN="/m.test(txt)) throw new Error('El instalador cambió de formato; actualiza la app')
  const origen = String(location.origin || '').replace(/\/+$/, '')
  return ORIGEN_VALIDO(origen)
    ? txt.replace(/^set "ORIGEN=".*\r?/m, `set "ORIGEN=${origen}"\r\n`)
    : txt
}

export async function descargarInstalador() {
  const txt = await textoInstalador()
  const m = /set "ORIGEN=([^"]*)"/.exec(txt)
  const url = URL.createObjectURL(new Blob([txt], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'instalar-agente-POS.bat'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return m ? m[1] : ''
}
