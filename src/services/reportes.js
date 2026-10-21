// Fuente de datos de los reportes por periodo.
// En demo (o sin Supabase) calcula en memoria; si no, pide la RPC y, si todavía
// no está desplegada, cae al cálculo en memoria sin romper la pantalla.
import { resumenDeCuentas } from '../components/panel/reports/calculos.js'

export async function reportesResumen({ modo, estado, desde, hasta }) {
  const memoria = error => ({ ...resumenDeCuentas(estado, desde, hasta), origen: 'memoria', error: error || null })
  if (modo === 'demo') return memoria()
  try {
    const { rpc } = await import('./supabaseClient.js')
    const data = await rpc('reportes_resumen', {
      p_desde: new Date(desde).toISOString(),
      p_hasta: new Date(hasta).toISOString(),
    })
    if (!data || !data.totales) throw new Error('La RPC no devolvió un resumen válido')
    return { ...data, origen: 'rpc', error: null }
  } catch (e) {
    return memoria(e?.message || String(e))
  }
}
