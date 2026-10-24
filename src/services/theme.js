import { useEffect, useState } from 'react'

const KEY = 'pos-ui-theme-v1'
const TEMAS = ['light', 'night', 'forest']

export function leerTema() {
  try { const v = localStorage.getItem(KEY); return TEMAS.includes(v) ? v : 'light' } catch { return 'light' }
}
export function aplicarTema(t) {
  const d = document.documentElement
  d.dataset.theme = t
  d.style.colorScheme = t === 'night' ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', { light: '#0B5DA8', night: '#0b1120', forest: '#248F3C' }[t])
}
function guardarTema(t) {
  try { localStorage.setItem(KEY, t) } catch {  }
  aplicarTema(t)
  window.dispatchEvent(new Event('pos-tema'))
}
export function useTema() {
  const [t, setT] = useState(leerTema)
  useEffect(() => {
    const f = () => setT(leerTema())
    window.addEventListener('pos-tema', f)
    window.addEventListener('storage', f)
    return () => { window.removeEventListener('pos-tema', f); window.removeEventListener('storage', f) }
  }, [])
  return [t, guardarTema]
}
