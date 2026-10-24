// Quién debe recibir cada aviso (notificación del teléfono). Reglas, por rol:
//  · Súper admin y admin (supervisores): ningún aviso de operación; ellos ven las Alertas dentro de la app.
//  · Mesero y cajero: solo lo de SUS cuentas (las que ellos abrieron): «pedido listo» en despacho y «cuenta cobrada».
//  · Cajero: además «por cobrar» (cuando una mesa pide la cuenta), porque es quien cobra.
//  · Cocina y barra: solo los platos nuevos de SUS áreas; nada de cuentas ni cobros.
// Función pura, sin pantalla ni red, para poder probarla.

export const esDeCocina = rol => rol === 'cocina' || rol === 'barra'
export const esDeSalon = rol => rol === 'mesero' || rol === 'cajero'

// Un ítem sin áreas guardadas sale por «cocina», igual que en la carta.
export const areasDeItem = i => (Array.isArray(i?.areas) && i.areas.length ? i.areas : ['cocina'])

const norm = x => String(x || '').trim().toLowerCase()

// ¿La cuenta la abrió esta persona? Por id cuando se conoce; si no, por nombre.
export function esMia(cuenta, quien) {
  if (!cuenta) return false
  if (quien.miId && cuenta.abiertaPorId) return cuenta.abiertaPorId === quien.miId
  const nombres = [quien.miNombre, quien.miUsuario].map(norm).filter(Boolean)
  return Boolean(cuenta.abiertaPor) && nombres.includes(norm(cuenta.abiertaPor))
}

export function recibeAvisos(quien) {
  if (!quien || quien.esSuper || !quien.rol) return false
  return esDeCocina(quien.rol) || esDeSalon(quien.rol)
}

// evento: { tipo: 'comanda', areas } | { tipo: 'porCobrar' } | { tipo: 'listo', cuenta } | { tipo: 'cobrada', cuenta }
export function debeAvisar(quien, evento) {
  if (!recibeAvisos(quien)) return false
  const { rol } = quien
  switch (evento?.tipo) {
    case 'comanda': {
      if (!esDeCocina(rol)) return false
      const mias = quien.misAreas || []
      if (!mias.length) return true // sin áreas asignadas ve todas, igual que su pantalla de Cocina
      return (evento.areas || []).some(a => mias.includes(a))
    }
    case 'porCobrar':
      return rol === 'cajero'
    case 'listo':
      return esDeSalon(rol) && esMia(evento.cuenta, quien)
    case 'cobrada': {
      if (!esDeSalon(rol) || !esMia(evento.cuenta, quien)) return false
      // Quien cobró ya lo sabe: no se avisa a sí mismo.
      const c = evento.cuenta
      if (quien.miId && c.cerradaPorId && c.cerradaPorId === quien.miId) return false
      return true
    }
    default:
      return false
  }
}
