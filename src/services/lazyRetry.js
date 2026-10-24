import { lazy } from 'react'

const CLAVE = 'pos-chunk-reload'

// lazy() que sobrevive a una publicación nueva: si el archivo con hash ya no existe, limpia las cachés
// de la app y recarga UNA vez para traer el index nuevo. Si vuelve a fallar, deja pasar el error
// (lo atrapa ChunkBoundary) en vez de recargar en bucle.
export function lazyRetry(carga) {
  return lazy(async () => {
    try {
      const m = await carga()
      try { sessionStorage.removeItem(CLAVE) } catch { /* noop */ }
      return m
    } catch (e) {
      let ya = false
      try { ya = sessionStorage.getItem(CLAVE) === '1' } catch { /* noop */ }
      if (ya) throw e
      try { sessionStorage.setItem(CLAVE, '1') } catch { /* noop */ }
      await limpiarCachesApp()
      window.location.reload()
      return new Promise(() => { })
    }
  })
}

export async function limpiarCachesApp() {
  try {
    const claves = await caches.keys()
    await Promise.all(claves.filter(k => k.startsWith('pos-control-')).map(k => caches.delete(k)))
  } catch { /* noop */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((regs || []).map(r => r.update().catch(() => { })))
  } catch { /* noop */ }
}
