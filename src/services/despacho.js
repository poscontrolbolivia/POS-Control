// Despacho de impresión: UN solo camino para comandas, tickets, pre-cuentas y arqueos. NUNCA abre el
// cuadro de impresión del navegador. Para cada trabajo:
//   1. si ESTE equipo tiene salida lista para el grupo (térmica USB conectada, impresora de Windows
//      asignada por el agente, o el diálogo elegido a propósito) → imprime aquí, en silencio;
//   2. si no (típico: un teléfono) y el negocio usa la estación de impresión → lo deja en la cola y
//      la PC del local lo imprime;
//   3. si no hay ninguna de las dos → 'sin-impresora' (la pantalla avisa; no se abre nada).
import { modoImpresion, encolarImpresion } from './colaImpresion.js'
import { grupoListo, imprimirTrabajo } from './estacion.js'

/** trabajos: [{ grupo, titulo, payload }] → resultados en el mismo orden: 'silencioso' | 'encolado' | 'sin-impresora' | 'error' */
export async function despachar(trabajos, config) {
  const resultados = new Array(trabajos.length)
  const aCola = []
  for (let i = 0; i < trabajos.length; i++) {
    const t = trabajos[i]
    if (grupoListo(t.grupo)) {
      try { await imprimirTrabajo(t.grupo, t.payload); resultados[i] = 'silencioso' } catch { resultados[i] = 'error' }
    } else if (modoImpresion(config) === 'estacion') aCola.push(i)
    else resultados[i] = 'sin-impresora'
  }
  if (aCola.length) {
    // Un solo envío con todas las partes (Cocina, Barra…): o llegan todas a la cola o ninguna.
    try { await encolarImpresion(aCola.map(i => trabajos[i])); aCola.forEach(i => { resultados[i] = 'encolado' }) } catch { aCola.forEach(i => { resultados[i] = 'error' }) }
  }
  return resultados
}
