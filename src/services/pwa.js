// ¿La app corre instalada (standalone), sin barra de direcciones?
export const isStandalonePwa = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)

export function esIos() {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 // iPadOS se anuncia como Mac
}
