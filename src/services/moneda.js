// Moneda del negocio: UN solo sitio. Se guarda en empresas.moneda (Configuración → Moneda)
// y llega en s.config.moneda; MONEDA de config.js es solo el valor por defecto.
import { MONEDA } from '../config.js'
import { useStore } from './store.jsx'

// Sugerencias del selector de Configuración (el campo admite cualquier texto corto).
export const MONEDAS_COMUNES = ['Bs', '$', 'USD', '€', 'S/', 'Q', 'L', 'C$', '₡', 'R$', 'COP', 'MXN', 'ARS', 'CLP', 'UYU', 'PYG']
export const MONEDA_MAX = 8

export const limpiarMoneda = v => String(v ?? '').trim().slice(0, MONEDA_MAX) || MONEDA

/** Importe con la moneda indicada: «Bs 12.50». */
export const formatearMonto = (n, moneda = MONEDA) => `${moneda} ${(Number(n) || 0).toFixed(2)}`

/** Hook: { moneda, money } con la moneda configurada del negocio actual. */
export function useMoneda() {
  const { s } = useStore()
  const moneda = s.config?.moneda || MONEDA
  return { moneda, money: n => formatearMonto(n, moneda) }
}
