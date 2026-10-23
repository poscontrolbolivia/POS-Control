import { hora } from './format.js'

// La comanda es texto plano: qué salón, qué mesa, quién la envió, a qué hora y el pedido. Nada
// más. En cocina se lee con el ticket en la mano, entre ruidos, y cada adorno es una distracción.
// `tr` entra desde fuera (la pantalla usa tGlobal) para poder probar estas líneas sin React.

export const CLAVES_COMANDA = {
  titulo: 'comanda.titulo',
  salon: 'comanda.salon',
  mesa: 'comanda.mesa',
  enviado: 'comanda.enviado',
  hora: 'comanda.hora',
  items: 'comanda.pedido',
  none: 'ticket.sinPedidos',
}

// Los cuatro encabezados, en el orden fijo que aprendió la cocina. Se omiten los que no tengan dato.
export function camposComanda({ salon, mesa, enviadoPor, en } = {}) {
  const out = []
  if (salon) out.push({ clave: CLAVES_COMANDA.salon, params: { v: salon } })
  out.push({ clave: CLAVES_COMANDA.mesa, params: { v: mesa || '—' } })
  if (enviadoPor) out.push({ clave: CLAVES_COMANDA.enviado, params: { v: enviadoPor } })
  out.push({ clave: CLAVES_COMANDA.hora, params: { v: hora(en || Date.now()) } })
  return out
}

export const tituloComanda = (areaNombre, tr) =>
  `${String(tr(CLAVES_COMANDA.titulo) || 'COMANDA').toUpperCase()}${areaNombre ? ` · ${String(areaNombre).toUpperCase()}` : ''}`

// Líneas en el formato que consume la impresora y el agente ({ texto, negrita, guion }).
export function lineasComanda({ items = [], areaNombre = '', salon = '', mesa = '', enviadoPor = '', en = Date.now(), tr, ancho = 32 } = {}) {
  const t = (k, p) => (tr ? tr(k, p) : `{${k}}`)
  const L = []
  L.push({ texto: tituloComanda(areaNombre, t), negrita: true })
  L.push({ texto: '', guion: true })
  camposComanda({ salon, mesa, enviadoPor, en }).forEach(c => L.push({ texto: t(c.clave, c.params) }))
  L.push({ texto: '', guion: true })
  if (!items.length) L.push({ texto: t(CLAVES_COMANDA.none), centrado: true })
  items.forEach(i => {
    L.push({ texto: recortar(`${i.qty} x ${i.nombre}`, ancho), negrita: true })
    if (i.nota) L.push({ texto: recortar(`    ** ${i.nota} **`, ancho), negrita: true })
  })
  return L
}

const recortar = (texto, n) => String(texto).slice(0, Math.max(8, n))
