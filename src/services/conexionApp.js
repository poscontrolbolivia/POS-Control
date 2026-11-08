// La conexión de ESTA app: comprueba el servidor de Supabase y la comparte con toda la pantalla.
import { SUPABASE_URL, USAR_SUPABASE } from './config.js'
import { crearConexion, esErrorDeRed } from './conexion.js'

// Llegar al servidor, con la respuesta que sea (aunque sea un 404), basta. `no-cors` evita que un bloqueo de CORS se
// confunda con «sin internet»: solo falla de verdad cuando no hay red.
async function pingServidor() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const ctl = new AbortController()
  const corte = setTimeout(() => ctl.abort(), 5000)
  try {
    // HEAD: sin cuerpo de respuesta (unos cientos de bytes en total).
    await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    return true
  } catch { return false } finally { clearTimeout(corte) }
}

export const conexion = crearConexion({ ping: pingServidor, visible: () => typeof document === 'undefined' || !document.hidden })
export { esErrorDeRed }

let iniciada = false
// Se llama una vez al abrir el panel. En modo demo (sin servidor) no hace nada: siempre «con conexión».
export function iniciarConexion() {
  if (iniciada || !USAR_SUPABASE || typeof window === 'undefined') return
  iniciada = true
  window.addEventListener('offline', () => conexion.navegador(false))
  window.addEventListener('online', () => conexion.navegador(true))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conexion.revisar() })  // al volver a la app: una comprobación
  // Al volver la conexión se vuelve a leer todo del servidor (lo que otros dispositivos hicieron mientras tanto).
  let antes = conexion.get().enLinea
  conexion.subscribe(() => {
    const ahora = conexion.get().enLinea
    if (ahora && !antes) { try { window.dispatchEvent(new Event('pos-reanudar')) } catch { /* sin ventana */ } }
    antes = ahora
  })
  conexion.arrancar()
}
