import { modoImpresion, encolarImpresion } from './printQueue.js'
import { grupoListo, imprimirTrabajo } from './station.js'

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

    try { await encolarImpresion(aCola.map(i => trabajos[i])); aCola.forEach(i => { resultados[i] = 'encolado' }) } catch { aCola.forEach(i => { resultados[i] = 'error' }) }
  }
  return resultados
}
