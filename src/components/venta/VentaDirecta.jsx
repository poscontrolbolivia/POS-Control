// Venta directa (mostrador, sin mesa) — IA-2b.
// Flujo: carrito local → Cobrar → d({t:'abrir-directa'}) → el efecto encadena item+ (y notas) y cobrar.
import { useEffect, useMemo, useState } from 'react'
import { useStore, nuevoId } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { MONEDA } from '../../config'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../services/imagenProducto.js'
import { useIdioma } from '../../i18n/index.jsx'
import { imprimirCuenta, precalcularCambio } from '../ticket/Ticket.jsx'
import './VentaDirecta.css'

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

// Miniato 45×45 para los tiles de venta. El hueco siempre mide lo mismo (si no hay foto se
// muestra la inicial), así que la cuadrícula no se desplaza cuando falta la imagen.
// Sin CSS nuevo: VentaDirecta.css/styles.css están fuera del alcance de este carril → estilos en línea.
export function MiniaturaProducto({ producto }) {
  const url = urlImagenProducto(producto)
  const ini = ((producto.nombre || '').trim().charAt(0) || '?').toUpperCase()
  return (
    <span className="mini-prod" style={{
      width: LADO_VISUAL_PX, height: LADO_VISUAL_PX, flex: '0 0 auto', borderRadius: 8, overflow: 'hidden',
      background: 'var(--libre)', border: '1px solid var(--line)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontWeight: 700, fontSize: '.95rem',
    }}>
      {url
        ? <img src={url} alt={`Foto de ${producto.nombre}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : ini}
    </span>
  )
}

// Imputa los pagos al total: monto almacenado = aplicado; en efectivo el excediente se devuelve como cambio.
function imputarPagos(lineas, total) {
  let saldo = round2(total)
  const pagos = []
  let cambio = 0
  ;(lineas || []).forEach(l => {
    const n = round2(Number(l.monto) || 0)
    if (n <= 0) return
    const aplica = round2(Math.min(n, saldo))
    const devuelto = l.metodo === 'efectivo' ? round2(n - aplica) : 0
    if (aplica > 0) pagos.push({ metodo: l.metodo, monto: aplica, recibido: n, cambio: devuelto })
    cambio = round2(cambio + devuelto)
    saldo = round2(saldo - aplica)
  })
  return { pagos, cambio, saldo }
}

// REGLA DEL CARRIL IDIOMAS: los datos NO se traducen. Estas sugerencias se escriben tal
// cuales en `nota` del ítem (quedan en la base y salen en el ticket de cocina), así que se
// mantienen en el idioma del local aunque la app esté en inglés o portugués. Lo traducible
// es el cartel del campo (venta.notaPlaceholder), no el valor que se guarda.
const NOTAS_RAPIDAS = ['Para llevar', 'Sin cebolla', 'Poco sal', 'Bien cocido', 'Extra queso']

export default function VentaDirecta({ rol, sesion }) {
  const { s, d } = useStore()
  const { t } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol || '—'
  const moneda = s.config?.moneda || MONEDA
  const m = n => `${moneda} ${round2(n).toFixed(2)}`

  const secciones = useMemo(() => [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0)), [s.secciones])
  const [sec, setSec] = useState(secciones[0]?.id)
  const secActiva = secciones.some(x => x.id === sec) ? sec : secciones[0]?.id
  const [carrito, setCarrito] = useState([])   // [{id, p, qty, nota}]
  const [cobro, setCobro] = useState(null)      // {lineas:[{metodo,monto}], imprimir}
  const [pendiente, setPendiente] = useState(null) // {numero, lineas, fase, pagos, imprimir, usuario}
  const [aviso, setAviso] = useState('')

  const productos = s.productos.filter(p => p.activo && p.seccionId === secActiva)
  const total = round2(carrito.reduce((acc, l) => acc + l.p.precio * l.qty, 0))

  const agregar = p => {
    if (!puede(rol, 'pedir')) return alert(t('venta.sinPermisoPedir'))
    setCarrito(c => {
      const ex = c.find(l => l.p.id === p.id && !l.nota)
      if (ex) return c.map(l => (l === ex ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { id: nuevoId(), p, qty: 1, nota: '' }]
    })
    setAviso('')
  }
  const mudarQty = (id, delta) => setCarrito(c => c
    .map(l => (l.id === id ? { ...l, qty: l.qty + delta } : l))
    .filter(l => l.qty > 0))
  const mudarNota = (id, nota) => setCarrito(c => c.map(l => (l.id === id ? { ...l, nota } : l)))
  const quitar = id => setCarrito(c => c.filter(l => l.id !== id))

  const abrirCobro = () => {
    if (!puede(rol, 'cobrar')) return alert(t('venta.sinPermisoCobrar'))
    setCobro({ lineas: [{ metodo: 'efectivo', monto: '' }], imprimir: true })
  }
  const setLinea = (i, cambios) => setCobro(c => ({ ...c, lineas: c.lineas.map((l, j) => (j === i ? { ...l, ...cambios } : l)) }))
  const agregarLinea = () => setCobro(c => {
    if (c.lineas.length >= 2) return c // pago en una o dos líneas
    const aplicado = c.lineas.reduce((acc, l) => acc + (Number(l.monto) || 0), 0)
    return { ...c, lineas: [...c.lineas, { metodo: 'qr', monto: String(Math.max(0, round2(total - aplicado))) }] }
  })

  const confirmarCobro = () => {
    const { pagos, saldo } = imputarPagos(cobro.lineas, total)
    if (saldo > 0.009) return alert(t('venta.faltaTotal', { faltan: m(saldo) }))
    if (!pagos.length) return alert(t('venta.sinPago'))
    const numero = s.caja.siguienteTurno // # que asignará el reducer a la cuenta nueva
    d({ t: 'abrir-directa', usuario })
    setPendiente({ numero, lineas: carrito.map(l => ({ p: l.p, qty: l.qty, nota: l.nota })), fase: 0, pagos, imprimir: cobro.imprimir, usuario })
  }

  // Encadenado: el reducer no devuelve la cuenta creada, así que se localiza por su número.
  // Cada línea pasa por fases: ítems (fase entera) → nota (media fase, porque el id lo genera el reducer).
  useEffect(() => {
    if (!pendiente) return
    const c = s.cuentas.find(x => x.tipo === 'directa' && x.numero === pendiente.numero)
    if (!c || c.estado === 'cerrada') { if (c) setPendiente(null); return }

    const idx = Math.floor(pendiente.fase)
    const mediaFase = pendiente.fase % 1 !== 0

    if (mediaFase) {
      // Aplicar la nota al ítem recién creado (último del producto, pendiente y sin nota).
      const l = pendiente.lineas[idx]
      const item = [...c.items].reverse().find(i => i.productoId === l.p.id && i.estado === 'pendiente' && !i.nota)
      if (item) d({ t: 'nota', cuentaId: c.id, itemId: item.id, nota: l.nota })
      setPendiente({ ...pendiente, fase: idx + 1 })
      return
    }

    if (idx < pendiente.lineas.length) {
      const l = pendiente.lineas[idx]
      for (let i = 0; i < l.qty; i++) d({ t: 'item+', cuentaId: c.id, p: l.p })
      setPendiente({ ...pendiente, fase: l.nota ? idx + 0.5 : idx + 1 })
      return
    }

    // Todo aplicado → cobrar e imprimir (silencioso si hay impresora térmica; si no, el aviso lo guía al botón manual)
    const { pagos, imprimir, usuario: usr } = pendiente
    d({ t: 'cobrar', cuentaId: c.id, pagos, usuario: usr })
    const cambio = round2(pagos.reduce((acc, p) => acc + (p.cambio || 0), 0))
    const base = t('venta.cobrada', { n: c.numero }) + (cambio > 0 ? t('venta.cambioSuffix', { monto: m(cambio) }) : '')
    setAviso(base)
    if (imprimir) {
      imprimirCuenta({ cuenta: { ...c, estado: 'cerrada', pagos, cerradaEn: Date.now() }, config: s.config })
        .then(r => { if (r === 'sin-impresora') setAviso(base + t('venta.sinImpresoraDialogo'))
          else if (r === 'error') setAviso(base + t('venta.sinImpresoraBoton')) })
    }
    setPendiente(null)
    setCarrito([])
    setCobro(null)
  }, [pendiente, s.cuentas]) // eslint-disable-line

  const cambioPreview = cobro ? precalcularCambio(cobro.lineas, total) : 0
  const pagadoPreview = cobro ? round2(cobro.lineas.reduce((acc, l) => acc + (Number(l.monto) || 0), 0)) : 0

  if (!puede(rol, 'venta_directa')) {
    return <div className="vd"><aside className="vd-panel vd-sinpermiso">{t('venta.sinPermiso', { rol })}</aside></div>
  }

  return (
    <div className="vd">
      <section className="vd-menu">
        <h2 className="vd-titulo">{t('venta.titulo', { nombre: s.config?.nombre || t('venta.mostrador') })}</h2>
        <div className="vd-tabs" role="tablist">
          {secciones.map(x => (
            <button key={x.id} role="tab" aria-selected={x.id === secActiva}
              className={x.id === secActiva ? 'vd-tab on' : 'vd-tab'} onClick={() => setSec(x.id)}>{x.nombre}</button>
          ))}
        </div>
        <div className="vd-grid">
          {productos.map(p => (
            <button key={p.id} className="vd-prod" onClick={() => agregar(p)}>
              <MiniaturaProducto producto={p} />
              <span>{p.nombre}</span><small>{m(p.precio)}</small>
            </button>
          ))}
          {!productos.length && <p className="vd-vacio">{t('venta.sinProductos')}</p>}
        </div>
      </section>

      <aside className="vd-panel">
        <h3>{t('venta.carrito')} <small>({carrito.reduce((acc, l) => acc + l.qty, 0)})</small></h3>
        {aviso && <p className="vd-aviso">{aviso}</p>}
        {!carrito.length && <p className="vd-vacio">{t('venta.vacioCarrito')}</p>}
        <ul className="vd-lineas">
          {carrito.map(l => (
            <li className="vd-linea" key={l.id}>
              <div className="vd-linea-top">
                <span className="vd-nom">{l.p.nombre}</span>
                <span className="vd-qty">
                  <button onClick={() => mudarQty(l.id, -1)} aria-label={t('venta.quitarUno')}>−</button>
                  <b>{l.qty}</b>
                  <button onClick={() => mudarQty(l.id, 1)} aria-label={t('venta.agregarUno')}>+</button>
                </span>
                <b className="vd-pr">{m(l.p.precio * l.qty)}</b>
                <button className="vd-x" onClick={() => quitar(l.id)} aria-label={t('venta.eliminar')}>×</button>
              </div>
              <input className="vd-nota" list="vd-notas-rapidas" placeholder={t('venta.notaPlaceholder')}
                value={l.nota} onChange={e => mudarNota(l.id, e.target.value)} />
            </li>
          ))}
        </ul>
        <datalist id="vd-notas-rapidas">{NOTAS_RAPIDAS.map(n => <option key={n} value={n} />)}</datalist>

        {!cobro ? (
          <div className="vd-total"><span>{t('venta.total')}</span><b>{m(total)}</b></div>
        ) : (
          <div className="vd-pagos">
            <div className="vd-total"><span>{t('venta.total')}</span><b>{m(total)}</b></div>
            {cobro.lineas.map((l, i) => (
              <div className="vd-pago" key={i}>
                <div className="vd-metodos">
                  {[['efectivo', t('venta.metodoEfectivo')], ['qr', t('venta.metodoQr')], ['tarjeta', t('venta.metodoTarjeta')]].map(([met, label]) => (
                    <button key={met} type="button" className={l.metodo === met ? 'vd-metodo on' : 'vd-metodo'}
                      onClick={() => setLinea(i, { metodo: met })}>{label}</button>
                  ))}
                </div>
                <label className="vd-monto">{t('venta.recibido')}
                  <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus={i === 0}
                    value={l.monto} onChange={e => setLinea(i, { monto: e.target.value })} placeholder={m(total)} />
                </label>
              </div>
            ))}
            {cobro.lineas.length < 2 && <button className="ghost" type="button" onClick={agregarLinea}>{t('venta.segundoPago')}</button>}
            {cobro.lineas.length >= 2 && <small className="vd-nota-ayuda">{t('venta.maxDosLineas')}</small>}
            <div className="vd-resumen-pago">
              <span>{t('venta.pagadoLabel')} <b>{m(pagadoPreview)}</b></span>
              {cambioPreview > 0 && <span className="vd-cambio">{t('venta.cambioLabel')} {m(cambioPreview)}</span>}
              {round2(total - Math.min(pagadoPreview, total)) > 0.009 && <span className="vd-falta">{t('venta.faltaLabel')} {m(round2(total - pagadoPreview))}</span>}
            </div>
            <label className="vd-check">
              <input type="checkbox" checked={cobro.imprimir} onChange={e => setCobro({ ...cobro, imprimir: e.target.checked })} />
              {t('venta.imprimirTicket')}
            </label>
          </div>
        )}

        <div className="vd-acciones">
          {!cobro
            ? <button className="primary big" disabled={!carrito.length} onClick={abrirCobro}>{t('venta.cobrar')}</button>
            : <>
              <button className="primary big" onClick={confirmarCobro}>{t('venta.confirmarPago')}</button>
              <button className="ghost" onClick={() => setCobro(null)}>{t('venta.volver')}</button>
            </>}
        </div>
      </aside>
    </div>
  )
}
