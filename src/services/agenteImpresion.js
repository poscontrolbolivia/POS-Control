// Cliente del AGENTE DE IMPRESIÓN (agente-impresion/agente.mjs): programa que corre en la PC y manda
// los bytes ESC/POS DIRECTO a una impresora de Windows elegida por nombre, sin el cuadro de
// confirmación del navegador. Solo se usa en la PC que tiene las impresoras; los teléfonos no lo
// necesitan (mandan sus trabajos a la estación por la cola de Supabase).
const LLAVE_URL = 'pos-agente-url'
export const URL_AGENTE_DEFECTO = 'http://127.0.0.1:9101'

export const urlAgente = () => { try { return localStorage.getItem(LLAVE_URL) || URL_AGENTE_DEFECTO } catch { return URL_AGENTE_DEFECTO } }
export const fijarUrlAgente = url => { try { localStorage.setItem(LLAVE_URL, String(url || '').trim().replace(/\/$/, '') || URL_AGENTE_DEFECTO) } catch { /* sin almacenamiento */ } }

async function pedir(ruta, opciones = {}, ms = 6000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(urlAgente() + ruta, { ...opciones, signal: ctl.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) throw new Error(j.error || `El agente respondió ${r.status}`)
    return j
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('El agente de impresión no responde')
    if (e instanceof TypeError) throw new Error('No se encontró el agente de impresión en esta PC. Ábrelo (iniciar-agente.bat) o revisa su dirección.')
    throw e
  } finally { clearTimeout(timer) }
}

/** { version, sistema } o lanza error si el agente no está abierto. */
export const estadoAgente = () => pedir('/estado', {}, 2500)

/** { predeterminada, impresoras: [nombre…] } instaladas en Windows. */
export const listarImpresorasAgente = () => pedir('/impresoras')

/** Envía bytes ESC/POS (Uint8Array) a la impresora `nombre`. Resuelve 'agente'. */
export async function imprimirPorAgente(nombre, bytes) {
  if (!nombre) throw new Error('Elige una impresora de Windows para este grupo')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  await pedir('/imprimir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ impresora: nombre, datos: btoa(bin) }),
  }, 20000)
  return 'agente'
}
