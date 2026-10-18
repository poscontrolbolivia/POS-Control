import { MONEDA } from './config.js'
import { useStore } from '../context/StoreContext.jsx'

export const MONEDAS_COMUNES = ['Bs', '$', 'USD', '€', 'S/', 'Q', 'L', 'C$', '₡', 'R$', 'COP', 'MXN', 'ARS', 'CLP', 'UYU', 'PYG']
export const MONEDA_MAX = 8

export const limpiarMoneda = v => String(v ?? '').trim().slice(0, MONEDA_MAX) || MONEDA

export const formatearMonto = (n, moneda = MONEDA) => `${moneda} ${(Number(n) || 0).toFixed(2)}`

export function useMoneda() {
  const { s } = useStore()
  const moneda = s.config?.moneda || MONEDA
  return { moneda, money: n => formatearMonto(n, moneda) }
}
