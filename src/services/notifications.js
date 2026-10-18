import { tGlobal, idiomaActivo } from '../i18n/index.jsx'

const SW_URL = '/sw.js'
const CLAVE_NEGADO = 'pos-notif-no-molestar'
const CLAVE_PIDIO = 'pos-notif-pidio'

const ICONO = '/icons/icon-192.png'

export const TEXTO_PERMISO =
  'POS Control quiere enviarte avisos del sistema en español: ' +
  '«Nuevos platos enviados a cocina» para la tablet de cocina y ' +
  '«Mesa por cobrar» cuando una cuenta pasa a pre-cuenta. ' +
  'Así no necesitas mantener la app abierta. Puedes cambiarlo cuando quieras en ' +
  'Ajustes del navegador › Permisos › Notificaciones.'

export const textoPermiso = () => tGlobal('pwa.permisoTexto')

let registration = null
let initPromise = null
const oyentesVista = new Set()

const notificacionesSoportadas = () => typeof window !== 'undefined' && 'Notification' in window

const leerClave = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
const escribirClave = (k, v) => { try { sessionStorage.setItem(k, v) } catch {  } }

export function estadoPermiso() {
  return notificacionesSoportadas() ? Notification.permission : 'unsupported'
}

export function permisoConcedido() {
  return estadoPermiso() === 'granted'
}

function debeRegistrarSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false

  if (import.meta.env && import.meta.env.PROD) return true
  try { return new URLSearchParams(window.location.search).has('sw') } catch { return false }
}

function abrirVista(destino) {
  try {
    const hash = destino && destino.includes('#') ? '#' + destino.split('#')[1] : ''
    if (hash && window.location.hash !== hash) window.location.hash = hash
    window.dispatchEvent(new CustomEvent('pos:vista', { detail: { url: destino, hash } }))
    oyentesVista.forEach((fn) => { try { fn(destino, hash) } catch {  } })
  } catch {  }
}

export function suscribirVista(cb) {
  oyentesVista.add(cb)
  return () => oyentesVista.delete(cb)
}

export async function pedirPermiso() {
  if (!notificacionesSoportadas()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  if (leerClave(CLAVE_NEGADO) === '1') return Notification.permission
  escribirClave(CLAVE_PIDIO, '1')
  try {
    const p = await Notification.requestPermission()
    if (p === 'denied') escribirClave(CLAVE_NEGADO, '1')
    return p
  } catch {
    return Notification.permission
  }
}

export function initNotificaciones() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (typeof window === 'undefined') return { sw: false, permiso: estadoPermiso() }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (ev) => {
        const d = ev.data || {}
        if (d.type === 'pos:abrir-vista') abrirVista(d.url || d.hash || '/')
      })
    }

    if (debeRegistrarSW()) {
      try {
        registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' })

        await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise((r) => setTimeout(r, 4000)),
        ])
      } catch (err) {
        console.warn('[POS] No se pudo registrar el service worker:', err && err.message)
        registration = null
      }
    }

    if (estadoPermiso() === 'default') {
      const alGesticar = () => {
        quitar()
        pedirPermiso()
      }
      const quitar = () => {
        window.removeEventListener('pointerdown', alGesticar)
        window.removeEventListener('keydown', alGesticar)
      }
      window.addEventListener('pointerdown', alGesticar, { once: true, passive: true })
      window.addEventListener('keydown', alGesticar, { once: true })
    }

    return { sw: Boolean(registration), permiso: estadoPermiso() }
  })()
  return initPromise
}

export async function notificarLocal(titulo, cuerpo, url = '/', opciones = {}) {
  if (!notificacionesSoportadas() || Notification.permission !== 'granted') return false
  const opt = {
    lang: idiomaActivo(),
    dir: 'ltr',
    tag: opciones.tag || 'pos-' + String(titulo || '').toLowerCase().replace(/\s+/g, '-'),
    body: cuerpo || '',
    icon: opciones.icono || ICONO,
    badge: ICONO,
    data: { url, titulo, cuerpo },
    timestamp: Date.now(),
    vibrate: opciones.vibrar === false ? undefined : [120, 60, 120],
    requireInteraction: Boolean(opciones.fijar),
    renotify: Boolean(opciones.renotify),
    silent: Boolean(opciones.silencio),
  }
  try {
    if (registration && 'showNotification' in registration) {
      await registration.showNotification(titulo, opt)
      return true
    }

    new Notification(titulo, { ...opt, data: undefined })
    return true
  } catch (err) {
    console.warn('[POS] No se pudo mostrar la notificación:', err && err.message)
    return false
  }
}

export async function cancelarNotificacion(tag) {
  if (!tag) return false
  try {
    if (registration && 'getNotifications' in registration) {
      const lista = await registration.getNotifications({ tag })
      await Promise.all(lista.map((n) => { try { n.close() } catch {  } return null }))
      return true
    }
  } catch {  }
  return false
}

export function notificarPorSW(titulo, cuerpo, url = '/', opciones = {}) {
  if (!registration || !registration.active) return false
  registration.active.postMessage({
    type: 'pos:notificar',
    titulo, cuerpo, url,
    tag: opciones.tag, fijar: opciones.fijar, icono: opciones.icono, vibrar: opciones.vibrar,
  })
  return true
}

export async function suscribirPush(clavePublicaVapid) {
  if (!registration || !clavePublicaVapid || !('PushManager' in window)) return null
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: clavePublicaVapid,
    })
  } catch (err) {
    console.warn('[POS] Suscripción de push no disponible:', err && err.message)
    return null
  }
}
