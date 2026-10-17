// Tema visual (claro / nocturno / bosque), igual que Catering Control. Es POR DISPOSITIVO:
// una sola llave en localStorage que lee todo (login, panel, legales). Se aplica como
// data-theme en <html>; styles.css redefine las variables de color para cada tema.
import { useEffect, useState } from 'react'

const KEY = 'pos-ui-theme-v1'
export const TEMAS = ['light', 'night', 'forest']

export function leerTema() {
  try { const v = localStorage.getItem(KEY); return TEMAS.includes(v) ? v : 'light' } catch { return 'light' }
}
export function aplicarTema(t) {
  const d = document.documentElement
  d.dataset.theme = t
  d.style.colorScheme = t === 'night' ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', { light: '#3867f4', night: '#121824', forest: '#1f7a4d' }[t])
}
export function guardarTema(t) {
  try { localStorage.setItem(KEY, t) } catch { /* sin almacenamiento: solo esta sesión */ }
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
