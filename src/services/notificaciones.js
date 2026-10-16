// Notificaciones del sistema para POS Control (PWA).
//
// Los títulos/cuerpos que se entregan a la API ya llegan TRADUCIDOS desde el carril
// IDIOMAS (los pasa PwaBridge con t()); aquí solo se declara el `lang` real del texto,
// que sigue siendo 'ltr'. La lógica de Web Push y el service worker no cambian.
//
// Nota iOS: Safari sólo permite notificaciones cuando la app está instalada desde
// el manifest ("Añadir a pantalla de inicio") y el service worker está registrado.
import { tGlobal, idiomaActivo } from '../i18n/index.jsx'

const SW_URL = '/sw.js'
const CLAVE_NEGADO = 'pos-notif-no-molestar'
const CLAVE_PIDIO = 'pos-notif-pidio'

const ICONO = '/icons/icon-192.png'

// Explicación que se muestra en la UI antes de pedir el permiso del navegador.
// Se mantiene la constante en español por compatibilidad con lo que ya la importa;
// el texto en el idioma activo se pide con textoPermiso().
export const TEXTO_PERMISO =
  'POS Control quiere enviarte avisos del sistema en español: ' +
  '«Nuevos platos enviados a cocina» para la tablet de cocina y ' +
  '«Mesa por cobrar» cuando una cuenta pasa a pre-cuenta. ' +
  'Así no necesitas mantener la app abierta. Puedes cambiarlo cuando quieras en ' +
  'Ajustes del navegador › Permisos › Notificaciones.'

/** Versión en el idioma activo del texto explicativo del permiso. */
export const textoPermiso = () => tGlobal('pwa.permisoTexto')

let registration = null
let initPromise = null
const oyentesVista = new Set()

const notificacionesSoportadas = () => typeof window !== 'undefined' && 'Notification' in window

// sessionStorage puede fallar en modo privado / sandbox: nunca debe romper el aviso.
const leerClave = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
const escribirClave = (k, v) => { try { sessionStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

export function estadoPermiso() {
  return notificacionesSoportadas() ? Notification.permission : 'unsupported'
}

export function permisoConcedido() {
  return estadoPermiso() === 'granted'
}

function debeRegistrarSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  // En producción siempre; en dev sólo si se fuerza con ?sw (para no romper el HMR de Vite).
  if (import.meta.env && import.meta.env.PROD) return true
  try { return new URLSearchParams(window.location.search).has('sw') } catch { return false }
}

// Aplica la vista pedida por una notificación pulsada (sin router: se usa el hash).
function abrirVista(destino) {
  try {
    const hash = destino && destino.includes('#') ? '#' + destino.split('#')[1] : ''
    if (hash && window.location.hash !== hash) window.location.hash = hash
    window.dispatchEvent(new CustomEvent('pos:vista', { detail: { url: destino, hash } }))
    oyentesVista.forEach((fn) => { try { fn(destino, hash) } catch { /* oyente defectuoso */ } })
  } catch { /* nunca dejar morir el listener del SW */ }
}

/** Suscribe un callback que se dispara cuando el usuario pulsa una notificación. */
export function suscribirVista(cb) {
  oyentesVista.add(cb)
  return () => oyentesVista.delete(cb)
}

/** Pide el permiso del navegador. Devuelve el permiso resultante. */
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

/**
 * Inicializa la PWA: registra /sw.js, pide permiso de notificación (tras un gesto,
 * que es como lo aceptan los navegadores móviles) y queda a la escucha de los clics
 * que envía el service worker desde 'notificationclick'.
 */
export function initNotificaciones() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (typeof window === 'undefined') return { sw: false, permiso: estadoPermiso() }

    // Escucha los mensajes del SW (notificationclick → abrir la vista correspondiente).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (ev) => {
        const d = ev.data || {}
        if (d.type === 'pos:abrir-vista') abrirVista(d.url || d.hash || '/')
      })
    }

    if (debeRegistrarSW()) {
      try {
        registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
        // `ready` puede colgarse si el SW no llega a activarse: se limita a 4 s.
        await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise((r) => setTimeout(r, 4000)),
        ])
      } catch (err) {
        console.warn('[POS] No se pudo registrar el service worker:', err && err.message)
        registration = null
      }
    }

    // El permiso se pide con un gesto del usuario: Chrome/Safari ignoran los que
    // se solicitan solos al cargar la página.
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

/**
 * Muestra una notificación local del sistema (en el idioma activo de la app).
 * `url` es la vista a abrir al pulsarla ('#cocina', '#salon', '#caja').
 * `opciones.tag` agrupa avisos del mismo evento para no spamear.
 * Devuelve true si la notificación se entregó.
 */
export async function notificarLocal(titulo, cuerpo, url = '/', opciones = {}) {
  if (!notificacionesSoportadas() || Notification.permission !== 'granted') return false
  const opt = {
    lang: idiomaActivo(), // 'es' | 'en' | 'pt': el idioma del texto que llega ya traducido
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
    // Sin SW registrado (p. ej. en desarrollo) se usa la API directa.
    new Notification(titulo, { ...opt, data: undefined })
    return true
  } catch (err) {
    console.warn('[POS] No se pudo mostrar la notificación:', err && err.message)
    return false
  }
}

/** Cierra el aviso de un tag concreto (p. ej. cuando la mesa ya fue cobrada). */
export async function cancelarNotificacion(tag) {
  if (!tag) return false
  try {
    if (registration && 'getNotifications' in registration) {
      const lista = await registration.getNotifications({ tag })
      await Promise.all(lista.map((n) => { try { n.close() } catch { /* ya cerrada */ } return null }))
      return true
    }
  } catch { /* sin SW o sin soporte: no hay nada que cerrar */ }
  return false
}

/** Pide al service worker que publique el aviso (funciona aunque la pestaña esté oculta). */
export function notificarPorSW(titulo, cuerpo, url = '/', opciones = {}) {
  if (!registration || !registration.active) return false
  registration.active.postMessage({
    type: 'pos:notificar',
    titulo, cuerpo, url,
    tag: opciones.tag, fijar: opciones.fijar, icono: opciones.icono, vibrar: opciones.vibrar,
  })
  return true
}

/** Registra esta app para push del servidor (necesita VAPID público; opcional). */
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
