import assert from 'node:assert/strict'
import { crearConexion, esErrorDeRed } from '../src/services/conexion.js'

// Reloj falso: los temporizadores solo corren cuando el test lo pide.
function reloj() {
  let t = 0, id = 0
  const pend = new Map()
  return {
    ahora: () => t,
    setT: (f, ms) => { const k = ++id; pend.set(k, { f, en: t + ms }); return k },
    clearT: k => pend.delete(k),
    async avanzar(ms) {
      t += ms
      for (const [k, x] of [...pend]) if (x.en <= t) { pend.delete(k); await x.f() }
      await new Promise(r => setImmediate(r))
    },
    pendientes: () => pend.size,
  }
}
const nuevo = (resultados, extra = {}) => {
  const r = reloj()
  let i = 0
  const c = crearConexion({ ping: async () => (typeof resultados === 'function' ? resultados() : resultados[Math.min(i++, resultados.length - 1)]), ahora: r.ahora, setT: r.setT, clearT: r.clearT, ...extra })
  return { c, r }
}
const quieto = () => new Promise(r => setImmediate(r))

// 1) Un solo tropiezo NO bloquea: hacen falta dos comprobaciones seguidas fallidas.
{
  const { c } = nuevo([true, false, true])
  c.arrancar(); await quieto()
  assert.equal(c.get().enLinea, true)
  await c.revisar(); assert.equal(c.get().enLinea, true, 'un fallo aislado no corta')
  await c.revisar(); assert.equal(c.get().enLinea, true)
}

// 2) Dos fallos seguidos = sin conexión; una comprobación buena = con conexión y queda registrada la hora de vuelta.
{
  const { c, r } = nuevo([false, false, false, true])
  const avisos = []
  c.subscribe(() => avisos.push(c.get().enLinea))
  c.arrancar(); await quieto()
  await c.revisar()
  assert.equal(c.get().enLinea, false)
  assert.equal(c.get().volvioEn, 0)
  await r.avanzar(4000)
  await c.revisar()
  assert.equal(c.get().enLinea, true)
  assert.ok(c.get().volvioEn > 0, 'anota cuándo volvió (para el aviso «recuperada»)')
  assert.deepEqual(avisos, [false, true], 'solo avisa a la pantalla cuando cambia el estado')
}

// 3) El navegador dice offline: se corta al instante; online hay que confirmarlo con el servidor.
{
  let hay = false
  const { c } = nuevo(() => hay)
  c.navegador(false)
  assert.equal(c.get().enLinea, false)
  c.navegador(true); await quieto()
  assert.equal(c.get().enLinea, false, 'el evento «online» solo no basta: el servidor no responde')
  hay = true
  c.navegador(true); await quieto()
  assert.equal(c.get().enLinea, true)
}

// 4) Una acción que falló por la red adelanta la comprobación: con el servidor sin responder, corta con UN fallo más.
{
  const { c } = nuevo([false])
  c.fallo(); await quieto()
  assert.equal(c.get().enLinea, false)
}
{
  const { c } = nuevo([true])
  c.fallo(); await quieto()
  assert.equal(c.get().enLinea, true, 'si el servidor sí responde, un error suelto no bloquea')
}

// 5) Pestaña oculta y todo bien: no gasta red. Sin conexión sí sigue comprobando para volver pronto.
{
  let llamadas = 0
  const r = reloj()
  const c = crearConexion({ ping: async () => { llamadas++; return true }, visible: () => false, ahora: r.ahora, setT: r.setT, clearT: r.clearT })
  c.arrancar(); await quieto()
  await r.avanzar(30000); await r.avanzar(30000); await r.avanzar(30000)
  assert.equal(llamadas, 1, 'solo la comprobación inicial; con la pestaña oculta no gasta más')
}
{
  let llamadas = 0
  const r = reloj()
  const c = crearConexion({ ping: async () => { llamadas++; return false }, visible: () => false, ahora: r.ahora, setT: r.setT, clearT: r.clearT })
  c.navegador(false)
  c.arrancar(); await quieto()
  assert.ok(llamadas >= 1, 'caída: comprueba aunque la pestaña esté oculta')
}

// 6) Qué errores cuentan como «no llegó al servidor».
assert.equal(esErrorDeRed(new TypeError('Failed to fetch')), true)
assert.equal(esErrorDeRed({ message: 'TypeError: Failed to fetch' }), true)
assert.equal(esErrorDeRed({ message: 'NetworkError when attempting to fetch resource.' }), true)
assert.equal(esErrorDeRed({ name: 'AbortError', message: 'aborted' }), true)
assert.equal(esErrorDeRed({ message: 'requiere super' }), false, 'un error de la base NO es un corte de red')
assert.equal(esErrorDeRed({ message: 'no hay turno abierto' }), false)
assert.equal(esErrorDeRed(null), false)


// 7) Gasto de datos: con tráfico real (vivo) NO se hacen comprobaciones; sin tráfico, una cada `cadaMs` (30 s).
{
  let llamadas = 0
  const r = reloj()
  const c = crearConexion({ ping: async () => { llamadas++; return true }, ahora: r.ahora, setT: r.setT, clearT: r.clearT })
  c.arrancar(); await quieto()
  assert.equal(llamadas, 1, 'una comprobación al abrir')
  for (let i = 0; i < 20; i++) { await r.avanzar(20000); c.vivo() }   // ~7 min con consultas cada 20 s
  assert.equal(llamadas, 1, 'con tráfico real no gasta ni una comprobación extra')
  await r.avanzar(30000); await r.avanzar(30000); await r.avanzar(30000)
  assert.ok(llamadas >= 2 && llamadas <= 4, 'sin tráfico, solo una cada ~30 s (fueron ' + llamadas + ')')
}

// 8) Una respuesta real del servidor mientras se creía caído = vuelve la conexión (sin gastar comprobación).
{
  let llamadas = 0
  const { c, r } = nuevo(() => { llamadas++; return false })
  c.navegador(false)
  assert.equal(c.get().enLinea, false)
  await r.avanzar(1000)   // el reloj falso arranca en 0: se avanza para que «volvioEn» sea una hora real
  const antes = llamadas
  c.vivo()
  assert.equal(c.get().enLinea, true)
  assert.ok(c.get().volvioEn > 0)
  assert.equal(llamadas, antes)
}
// 9) «Reintentar» siempre consulta, aunque haya habido tráfico hace un segundo.
{
  let llamadas = 0
  const r = reloj()
  const c = crearConexion({ ping: async () => { llamadas++; return true }, ahora: r.ahora, setT: r.setT, clearT: r.clearT })
  c.arrancar(); await quieto(); c.vivo()
  const n0 = llamadas
  await c.revisar()
  assert.equal(llamadas, n0 + 1)
}

console.log('✓ conexión: aviso sin internet y bloqueo hasta que vuelva')
