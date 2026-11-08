// Estado de la conexión con el servidor (sin React ni navegador: se puede probar con un reloj falso).
//
// Idea: NO hay modo sin internet. Cuando se cae la conexión se avisa con claridad y se bloquea todo lo que escribe
// en el servidor (cobrar, enviar a cocina, caja…) hasta que vuelva. No hay cola ni reintentos automáticos: reenviar
// acciones podría duplicar un cobro o un pedido, y dos dispositivos podrían pisarse la misma mesa.
//
// Cómo decide:
//  · «Sin conexión» solo después de DOS comprobaciones seguidas fallidas (así un tropiezo de un segundo no bloquea nada),
//    o de inmediato si el navegador dice que está desconectado.
//  · «Con conexión» en cuanto UNA comprobación llega al servidor.
//  · Una acción que falla por la red adelanta la siguiente comprobación (no espera al reloj).
//
// Gasto de datos: la comprobación es la excepción, no la regla. Cualquier respuesta real del servidor (una consulta,
// un aviso de tiempo real) ya prueba que hay conexión y se anota con vivo(); solo si pasan `cadaMs` sin NADA de tráfico
// se hace una comprobación mínima. Con la app en uso normal no se gasta ni un byte extra.

// ¿Este error es de red (no llegó al servidor) y no una respuesta de la base?
export function esErrorDeRed(err) {
  if (!err) return false
  if (err.name === 'AbortError' || err.name === 'TypeError') return true
  const m = String(err.message || err.details || err).toLowerCase()
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|network error/.test(m)
}

export function crearConexion({
  ping,
  cadaMs = 30000,         // comprobación solo si pasó este tiempo sin ningún tráfico real
  cadaCaidoMs = 4000,     // comprobación mientras no hay conexión (para volver pronto)
  fallosParaCaer = 2,
  visible = () => true,   // pestaña a la vista (oculta no gasta red mientras todo va bien)
  ahora = Date.now,
  setT = setTimeout,
  clearT = clearTimeout,
} = {}) {
  let estado = { enLinea: true, desde: ahora(), volvioEn: 0 }
  let fallos = 0
  let timer = null
  let corriendo = false
  let enVuelo = false
  let ultimoOk = 0        // última vez que el servidor respondió (a una consulta real o a una comprobación)
  const oyentes = new Set()

  const poner = cambios => { estado = { ...estado, ...cambios }; oyentes.forEach(f => f()) }
  const programar = () => {
    clearT(timer)
    timer = null
    if (!corriendo) return
    timer = setT(() => { revisar(false) }, estado.enLinea ? cadaMs : cadaCaidoMs)
  }

  async function revisar(forzar = false) {
    if (enVuelo) return
    if (estado.enLinea && !forzar) {
      if (!visible()) { programar(); return }                          // pestaña oculta: no gasta red
      if (ahora() - ultimoOk < cadaMs) { programar(); return }         // hubo tráfico real hace poco: ya se sabe
    }
    enVuelo = true
    try {
      let ok = false
      try { ok = Boolean(await ping()) } catch { ok = false }
      if (ok) {
        ultimoOk = ahora()
        fallos = 0
        if (!estado.enLinea) poner({ enLinea: true, desde: ahora(), volvioEn: ahora() })
      } else {
        fallos += 1
        if (estado.enLinea && fallos >= fallosParaCaer) poner({ enLinea: false, desde: ahora() })
      }
    } finally {
      enVuelo = false
      programar()
    }
  }

  return {
    get: () => estado,
    subscribe: f => { oyentes.add(f); return () => oyentes.delete(f) },
    arrancar() { if (corriendo) return; corriendo = true; revisar(true) },
    parar() { corriendo = false; clearT(timer); timer = null },
    // Comprobación pedida a mano (botón «Reintentar»): siempre consulta al servidor.
    revisar: () => revisar(true),
    // El servidor respondió a algo real (consulta, aviso de tiempo real): hay conexión, sin gastar una comprobación.
    vivo() {
      ultimoOk = ahora()
      fallos = 0
      if (!estado.enLinea) poner({ enLinea: true, desde: ahora(), volvioEn: ahora() })
    },
    // Lo avisa el navegador (eventos online/offline). Offline es definitivo; online hay que confirmarlo.
    navegador(enLinea) {
      if (enLinea) { revisar(true); return }
      fallos = fallosParaCaer
      if (estado.enLinea) poner({ enLinea: false, desde: ahora() })
    },
    // Una acción real falló por la red: comprobar ya (cuenta como el primer fallo si aún no había ninguno).
    fallo() { fallos = Math.max(fallos, fallosParaCaer - 1); revisar(true) },
  }
}
