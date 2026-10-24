import assert from 'node:assert/strict'
import { aplicarOptimistas } from '../src/services/despacho.js'

const cola = estado => [{ cuenta_id: 'c1', items: [{ id: 'a', estado }, { id: 'b', estado: 'enviado' }] }]
const hasta = Date.now() + 8000

// Un refresco viejo (el servidor aún dice «enviado») no desmarca lo que el usuario ya marcó.
{
  const pend = new Map([['cocina:a', { listo: true, en: 123, hasta }]])
  const r = aplicarOptimistas(cola('enviado'), 'cocina', pend)
  assert.equal(r[0].items[0].estado, 'listo')
  assert.equal(r[0].items[0].listo_en, 123)
  assert.equal(r[0].items[1].estado, 'enviado', 'el otro plato no se toca')
  assert.equal(pend.size, 1, 'sigue pendiente hasta que el servidor confirme')
}
// Cuando el servidor ya coincide, se suelta lo local y manda el servidor.
{
  const pend = new Map([['cocina:a', { listo: true, en: 123, hasta }]])
  const r = aplicarOptimistas(cola('listo'), 'cocina', pend)
  assert.equal(r[0].items[0].estado, 'listo')
  assert.equal(pend.size, 0)
}
// Deshacer: vuelve a «enviado» y sin hora de salida.
{
  const pend = new Map([['cocina:a', { listo: false, en: 1, hasta }]])
  const r = aplicarOptimistas([{ items: [{ id: 'a', estado: 'listo', listo_en: 99 }] }], 'cocina', pend)
  assert.equal(r[0].items[0].estado, 'enviado')
  assert.equal(r[0].items[0].listo_en, null)
}
// Plazo vencido (el servidor no respondió): se descarta y se muestra la verdad.
{
  const pend = new Map([['cocina:a', { listo: true, en: 1, hasta: 1000 }]])
  const r = aplicarOptimistas(cola('enviado'), 'cocina', pend, 5000)
  assert.equal(r[0].items[0].estado, 'enviado')
  assert.equal(pend.size, 0)
}
// Una anulación pedida manda sobre lo local.
{
  const pend = new Map([['cocina:a', { listo: true, en: 1, hasta }]])
  const r = aplicarOptimistas(cola('anulacion'), 'cocina', pend)
  assert.equal(r[0].items[0].estado, 'anulacion')
}
// La misma id en otra área no se ve afectada.
{
  const pend = new Map([['barra:a', { listo: true, en: 1, hasta }]])
  const r = aplicarOptimistas(cola('enviado'), 'cocina', pend)
  assert.equal(r[0].items[0].estado, 'enviado')
}
console.log('✓ optimista: marcar/deshacer se pinta al instante y no parpadea con refrescos viejos')
