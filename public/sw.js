/* Service worker de POS Control.
 *
 * Reglas:
 *  - Sólo se cachea la "shell" (HTML, manifest, iconos y assets compilados /assets/*).
 *  - En desarrollo (Vite) NUNCA se cachea: se detectan las rutas que sirve Vite
 *    (/src/, /node_modules/, /@vite, /@id/, .jsx…) y se dejan pasar a la red.
 *  - Las notificaciones se muestran en español (lang/dir/tag) y al pulsarlas abren
 *    la vista indicada en data.url (#salon, #cocina, #caja).
 */

const VERSION = 'v4'
const CACHE_SHELL = 'pos-control-shell-' + VERSION
const CACHE_RECURSOS = 'pos-control-recursos-' + VERSION

const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/favicon-32.png',
  '/icons/favicon-48.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
]

// Patrones que nunca deben pasar por caché (dev de Vite / módulos fuente).
const PROHIBIDO = ['/node_modules/', '/@vite', '/@id/', '/@react-refresh', '/src/', '.jsx', '.tsx', '.css.map', '.js.map']

const esDev = (url) => PROHIBIDO.some((p) => url.pathname.includes(p))
const esShellEstatica = (url) => SHELL.some((s) => url.pathname === s)
const esAssetCompilado = (url) => url.pathname.startsWith('/assets/')

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_SHELL)
      // Si un archivo falta (p. ej. aún no se construyó el dist) no debe romper el install.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const claves = await caches.keys()
      // Se borran las cachés de versiones anteriores (si no, el icono viejo sobrevive a
      // la actualización y la PWA instalada sigue mostrando la marca antigua).
      await Promise.all(claves.filter((k) => k.startsWith('pos-control-') && k !== CACHE_SHELL && k !== CACHE_RECURSOS).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // no tocar orígenes externos
  if (esDev(url)) return // en desarrollo: siempre red, sin caché

  // Documento: primero la red para tener la versión fresca; si no hay red, la shell cacheada.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const c = await caches.open(CACHE_SHELL)
          c.put('/index.html', res.clone())
          return res
        } catch {
          const c = await caches.open(CACHE_SHELL)
          return (await c.match('/index.html')) || (await c.match('/')) || Response.error()
        }
      })()
    )
    return
  }

  // Recursos estáticos y assets compilados (con hash): cache-first.
  if (esShellEstatica(url) || esAssetCompilado(url)) {
    e.respondWith(
      (async () => {
        const ab = await caches.match(req)
        if (ab && !((ab.headers.get('content-type') || '').includes('text/html') && esAssetCompilado(url))) return ab
        const res = await fetch(req)
        // Un asset que ya no existe lo contesta Cloudflare con el index.html (200): NO se guarda,
        // si no el HTML quedaba cacheado como si fuera el .js y la pantalla no volvía a cargar.
        const tipo = (res && res.headers.get('content-type')) || ''
        if (res && res.status === 200 && res.type === 'basic' && !tipo.includes('text/html')) {
          const c = await caches.open(CACHE_RECURSOS)
          c.put(req, res.clone())
        }
        return res
      })()
    )
  }
  // Todo lo demás (API, Supabase, etc.) se deja a la red por defecto.
})

/* ---------------- Notificaciones ---------------- */

const ICONO = '/icons/icon-192.png'

// Opciones por defecto, siempre en español.
function opcionesNotif(d = {}) {
  return {
    lang: 'es',
    dir: 'ltr',
    tag: d.tag || 'pos-control',
    title: d.titulo || 'POS Control',
    body: d.cuerpo || '',
    icon: d.icono || ICONO,
    badge: d.icono || ICONO,
    data: { url: d.url || '/' },
    vibrate: d.vibrar === false ? undefined : [120, 60, 120],
    timestamp: d.timestamp || Date.now(),
    requireInteraction: Boolean(d.fijar),
    renotify: Boolean(d.renotify),
  }
}

// Push desde el servidor (requiere suscripción VAPID; aún sin backend, se deja listo).
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { cuerpo: e.data ? e.data.text() : '' } }
  const opt = opcionesNotif(d)
  e.waitUntil(self.registration.showNotification(opt.title, opt))
})

// La app puede pedir que el SW publique la notificación (ventaja: sobrevive a la pestaña oculta).
self.addEventListener('message', (e) => {
  const msg = e.data || {}
  if (msg.type !== 'pos:notificar') return
  const opt = opcionesNotif(msg)
  e.waitUntil(self.registration.showNotification(opt.title, opt))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const destino = (e.notification.data && e.notification.data.url) || '/'
  const hash = destino.includes('#') ? '#' + destino.split('#')[1] : ''
  e.waitUntil(
    (async () => {
      const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Reutiliza una ventana ya abierta y avísale a qué vista debe ir.
      for (const cliente of lista) {
        try {
          await cliente.focus()
          cliente.postMessage({ type: 'pos:abrir-vista', url: destino, hash })
          return
        } catch { /* intenta con el siguiente */ }
      }
      if (self.clients.openWindow) await self.clients.openWindow(destino)
    })()
  )
})
