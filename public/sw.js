/* Service worker de POS Control.
 *
 * Reglas:
 *  - Sólo se cachea la "shell" (HTML, manifest, iconos y assets compilados /assets/*).
 *  - En desarrollo (Vite) NUNCA se cachea: se detectan las rutas que sirve Vite
 *    (/src/, /node_modules/, /@vite, /@id/, .jsx…) y se dejan pasar a la red.
 *  - Las FOTOS del menú, el logo y el QR (Supabase Storage) se guardan en una caché propia que NO se
 *    borra al actualizar la app: se descargan una sola vez por dispositivo y después salen del teléfono
 *    (se revisan en segundo plano como máximo cada hora con una consulta que casi no gasta datos).
 *  - Las notificaciones se muestran en español (lang/dir/tag) y al pulsarlas abren
 *    la vista indicada en data.url (#salon, #cocina, #caja).
 */

const VERSION = 'v5'
const CACHE_SHELL = 'pos-control-shell-' + VERSION
const CACHE_RECURSOS = 'pos-control-recursos-' + VERSION
// Sin versión a propósito: las fotos sobreviven a las actualizaciones de la app (si no, cada versión
// nueva obligaría a bajarlas todas otra vez y se gastarían megas).
const CACHE_IMAGENES = 'pos-control-imagenes-v1'
const IMG_MAX_ENTRADAS = 600
const IMG_REVISAR_MS = 60 * 60 * 1000
const esImagenStorage = (url) => url.pathname.startsWith('/storage/v1/object/public/pos-imagenes/')

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

// Mantiene la caché de fotos acotada: si se pasa del tope borra las más antiguas.
async function podarImagenes(cache) {
  try {
    const claves = await cache.keys()
    for (const k of claves.slice(0, Math.max(0, claves.length - IMG_MAX_ENTRADAS))) await cache.delete(k)
  } catch { /* no es crítico */ }
}

// Foto: sale de la caché al instante; si tiene más de una hora se revisa en segundo plano con una
// petición condicional (si no cambió, el servidor contesta 304 y casi no se gastan datos).
async function imagenConCache(e) {
  const clave = e.request.url.split('#')[0]
  const cache = await caches.open(CACHE_IMAGENES)
  const guardada = await cache.match(clave)
  const edad = guardada ? Date.now() - Number(guardada.headers.get('x-sw-guardada') || 0) : Infinity

  const traer = async () => {
    const res = await fetch(clave, { mode: 'cors', credentials: 'omit', cache: 'no-cache' })
    if (res.status === 404) { await cache.delete(clave); return res }
    if (res.status !== 200) return res
    const cuerpo = await res.blob()
    const h = new Headers(res.headers)
    h.set('x-sw-guardada', String(Date.now()))
    await cache.put(clave, new Response(cuerpo, { status: 200, headers: h }))
    podarImagenes(cache)
    return new Response(cuerpo, { status: 200, headers: res.headers })
  }

  if (guardada) {
    if (edad > IMG_REVISAR_MS) e.waitUntil(traer().catch(() => {}))
    return guardada
  }
  try {
    return await traer()
  } catch {
    return fetch(e.request) // sin CORS o sin red: la petición original (no se guarda)
  }
}

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
      await Promise.all(claves.filter((k) => k.startsWith('pos-control-') && k !== CACHE_SHELL && k !== CACHE_RECURSOS && k !== CACHE_IMAGENES).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (esImagenStorage(url)) { e.respondWith(imagenConCache(e)); return }
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
