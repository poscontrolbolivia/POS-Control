import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, nuevoId } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { MONEDA } from '../../../services/config'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { agotadosHoy, conMarca } from '../../../services/soldOut.js'
import { imprimirCuenta, imprimirComandas } from '../../printing/Ticket.jsx'
import { listasDe, notaDeUnidad, indicacionesDeUnidad, extraDeUnidad, selDeUnidad } from '../../../services/indicaciones.js'
import IndicacionesPrevio from '../order/IndicacionesPrevio.jsx'
import CobroForm, { imputarPagos, cobroNuevo, cobroInvalido } from '../pago/CobroForm.jsx'
import { fiscalVacio, fiscalACuenta, correoValido } from '../../../services/fiscal.js'
import MesasResumen from '../hall/MesasResumen.jsx'
import '../pago/ComprobanteQr.css'
import { ruedaHorizontal } from '../../../services/ruedaHorizontal.js'
import './QuickSalePage.css'
import { round2, limpiarMonto, numMonto } from '../../../services/format.js'
import { formatearMonto } from '../../../services/money.js'

function MiniaturaProducto({ producto }) {
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

const NOTAS_RAPIDAS = ['Para llevar', 'Sin cebolla', 'Poco sal', 'Bien cocido', 'Extra queso']

// Píldora «Todos» de la fila de grupos: no es una sección del negocio, así que su id no puede
// chocar con ninguno real.
const TODOS = '__todos'

export default function QuickSalePage({ rol, sesion, onAbrirMesa }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol || '—'
  const moneda = s.config?.moneda || MONEDA
  const m = n => formatearMonto(n, moneda)

  // En el mostrador también se cobra una mesa (el cliente llega con la cuenta bajo el brazo): el salón
  // tiene que verse acá, sin cambiar de pantalla. No se recuerda la elección: el mostrador es lo primero.
  const [pantalla, setPantalla] = useState('mostrador')
  const mesasAbiertas = s.cuentas.filter(c => c.tipo === 'mesa' && c.estado !== 'cerrada').length
  const irSalon = mesa => { if (mesa?.id && onAbrirMesa) onAbrirMesa({ mesaId: mesa.id, desde: 'caja' }); else window.location.hash = '#salon' }

  const secciones = useMemo(() => [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0)), [s.secciones])
  // «Todos» abre el mostrador: el cajero ve la carta completa sin adivinar en qué sección está el plato
  // que el cliente acaba de nombrar.
  const [sec, setSec] = useState(TODOS)
  const secActiva = sec === TODOS || secciones.some(x => x.id === sec) ? sec : TODOS
  const [carrito, setCarrito] = useState([])
  // La barra de la carta se queda donde el cajero la dejó; al cambiar de grupo eso deja los platos
  // nuevos fuera por la izquierda, así que cada cambio de grupo la vuelve a arrancar.
  const tira = useRef(null)
  useEffect(() => { if (tira.current) tira.current.scrollLeft = 0 }, [secActiva])
  const [previa, setPrevia] = useState(null)
  const [cobro, setCobro] = useState(null)
  const [pendiente, setPendiente] = useState(null)
  const [aviso, setAviso] = useState('')
  // Cada paso del cobro (cargar un plato, cobrar) se manda UNA sola vez aunque la pantalla se refresque
  // en medio (cambios de otros dispositivos llegan en vivo y vuelven a ejecutar el efecto).
  const faseHechaRef = useRef(-1)
  const cobroHechoRef = useRef(false)

  const productos = s.productos.filter(p => p.activo && (secActiva === TODOS || p.seccionId === secActiva))
  const agotados = agotadosHoy(s.config)
  const agotadosEnSeccion = productos.filter(p => agotados[p.id])
  const total = round2(carrito.reduce((acc, l) => acc + (l.p.precio + (l.extra || 0)) * l.qty, 0))

  const agregar = p => {
    if (!puede(rol, 'pedir')) return setAviso(t('venta.sinPermisoPedir'))
    if (agotados[p.id]) return setAviso(t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }))
    const listas = listasDe(s.config, p)
    if (listas.length) return setPrevia({ p, listas })
    setCarrito(c => {
      const ex = c.find(l => l.p.id === p.id && !l.nota)
      if (ex) return c.map(l => (l === ex ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { id: nuevoId(), p, qty: 1, nota: '' }]
    })
    setAviso('')
  }

  // En el mostrador también se arma la indicaciones: sin picker, un plato con una lista obligatoria
  // («Término de la carne») se cobraba sin ninguna y cocina no tenía de dónde saberlo.
  const confirmarPrevia = unidades => {
    const { p, listas } = previa
    setCarrito(c => {
      const out = [...c]
      unidades.forEach(u => {
        const n = {
          nota: notaDeUnidad(listas, u),
          indicaciones: indicacionesDeUnidad(listas, u),
          extra: extraDeUnidad(listas, u),
          sel: selDeUnidad(listas, u),
        }
        const i = out.findIndex(l => l.p.id === p.id && (l.nota || '') === n.nota)
        if (i >= 0) out[i] = { ...out[i], qty: out[i].qty + 1 }
        else out.push({ id: nuevoId(), p, qty: 1, ...n })
      })
      return out
    })
    setPrevia(null)
    setAviso('')
  }
  const mudarQty = (id, delta) => setCarrito(c => c
    .map(l => (l.id === id ? { ...l, qty: l.qty + delta } : l))
    .filter(l => l.qty > 0))
  const mudarNota = (id, nota) => setCarrito(c => c.map(l => (l.id === id ? { ...l, nota } : l)))
  const quitar = id => setCarrito(c => c.filter(l => l.id !== id))

  const quitarAgotado = id => { d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, id, null) } }); setAviso('') }

  const abrirCobro = () => {
    if (!puede(rol, 'cobrar')) return setAviso(t('venta.sinPermisoCobrar'))
    setCobro(cobroNuevo())
  }
  const confirmarCobro = () => {
    if (cobro.lineas.some(l => l.subiendo)) return setAviso(t('comp.subiendo'))
    if (!correoValido(cobro.fiscal?.correo)) return setAviso(t('fiscal.correoInvalido'))
    const invalido = cobroInvalido(cobro.lineas, t)
    if (invalido) return setAviso(invalido)
    const { pagos, saldo } = imputarPagos(cobro.lineas, total)
    if (saldo > 0.009) return setAviso(t('venta.faltaTotal', { faltan: m(saldo) }))
    if (!pagos.length) return setAviso(t('venta.sinPago'))
    const numero = s.caja.siguienteTurno
    faseHechaRef.current = -1
    cobroHechoRef.current = false
    d({ t: 'abrir-directa', usuario })
    setPendiente({ numero, lineas: carrito.map(l => ({ p: l.p, qty: l.qty, nota: l.nota, indicaciones: l.indicaciones, extra: l.extra, sel: l.sel })), fase: 0, pagos, imprimir: cobro.imprimir, comanda: cobro.comanda, fiscal: cobro.fiscal, usuario })
  }

  useEffect(() => {
    if (!pendiente) return
    const c = s.cuentas.find(x => x.tipo === 'directa' && x.canal !== 'llevar' && x.numero === pendiente.numero)
    if (!c || c.estado === 'cerrada') { if (c) setPendiente(null); return }

    const idx = Math.floor(pendiente.fase)

    if (idx < pendiente.lineas.length) {
      if (faseHechaRef.current >= idx) return
      faseHechaRef.current = idx
      const l = pendiente.lineas[idx]
      for (let i = 0; i < l.qty; i++) {
        d({
          t: 'item+', cuentaId: c.id, p: l.p,
          ...(l.nota ? { nota: l.nota } : {}), ...(l.indicaciones ? { indicaciones: l.indicaciones } : {}),
          ...(l.extra ? { extra: l.extra } : {}), ...(l.sel?.length ? { sel: l.sel } : {}),
        })
      }
      setPendiente({ ...pendiente, fase: idx + 1 })
      return
    }

    if (cobroHechoRef.current) return
    cobroHechoRef.current = true
    const { pagos, imprimir, comanda, fiscal, usuario: usr } = pendiente
    const porEnviar = (c.items || []).filter(i => i.estado === 'pendiente')
    // Enviar antes de cobrar: al cerrarse la cuenta el área ya no la devuelve, pero Despacho la
    // sigue mostrando como «por entregar» hasta que el producto sale. Ambos van a la misma cola,
    // así que el envío queda escrito antes del cierre.
    if (porEnviar.length) d({ t: 'enviar', cuentaId: c.id })
    if (!fiscalVacio(fiscal)) d({ t: 'fiscal~', cuentaId: c.id, nombre: fiscal.nombre.trim(), numero: fiscal.numero.trim(), correo: fiscal.correo.trim() })
    d({ t: 'cobrar', cuentaId: c.id, pagos, usuario: usr })
    const cambio = round2(pagos.reduce((acc, p) => acc + (p.cambio || 0), 0))
    const base = t('venta.cobrada', { n: c.numero }) + (cambio > 0 ? t('venta.cambioSuffix', { monto: m(cambio) }) : '')
    setAviso(base)
    setPendiente(null)
    setCarrito([])
    setCobro(null)
    const cuentaCerrada = { ...c, ...(fiscalVacio(fiscal) ? {} : fiscalACuenta(fiscal)), estado: 'cerrada', pagos, cerradaEn: Date.now() }
    // La impresión va diferida y después del cobro: el diálogo nativo de Windows congela el hilo
    // y, con la cola de Supabase todavía por escribir, se perdía la venta completa.
    setTimeout(() => {
      if (comanda && porEnviar.length) {
        imprimirComandas({
          cuenta: c, items: porEnviar, productos: s.productos, config: s.config,
          titulo: t('pedido.comandaTitulo', { titulo: t('venta.mostrador') }),
          datos: { salon: t('venta.mostrador'), mesa: `#${c.numero}` },
        }).catch(() => { })
      }
      if (imprimir) {
        imprimirCuenta({ cuenta: cuentaCerrada, config: s.config, datos: { salon: t('venta.mostrador') } })
          .then(r => { if (r === 'sin-impresora') setAviso(base + t('venta.sinImpresoraDialogo'))
            else if (r === 'error') setAviso(base + t('venta.sinImpresoraBoton')) })
          .catch(() => { })
      }
    }, 0)
  }, [pendiente, s.cuentas])

  // Si el cobro se queda esperando más de 15 s (la venta no llegó a crearse), se libera la pantalla
  // en vez de dejarla bloqueada con el carrito.
  useEffect(() => {
    if (!pendiente) return undefined
    const id = setTimeout(() => {
      setPendiente(null)
      setAviso(tOr('venta.cobroTrabado', 'No se pudo completar la venta. Revisa el carrito y vuelve a cobrar.'))
    }, 15000)
    return () => clearTimeout(id)
  }, [pendiente?.numero, pendiente?.fase])


  if (!puede(rol, 'venta_directa')) {
    return <div className="vd"><aside className="vd-panel vd-sinpermiso">{t('venta.sinPermiso', { rol })}</aside></div>
  }

  return (
    <div className="vd">
      <section className="vd-menu">
        <h2 className="vd-titulo">{t('venta.titulo', { nombre: s.config?.nombre || t('venta.mostrador') })}</h2>
        <div className="vd-vistas" role="group" aria-label={tOr('venta.vistas', 'Qué mostrar')}>
          <button type="button" className={'vd-tab' + (pantalla === 'mostrador' ? ' on' : '')} aria-pressed={pantalla === 'mostrador'} onClick={() => setPantalla('mostrador')}>
            🧾 {t('venta.mostrador')}
          </button>
          <button type="button" className={'vd-tab' + (pantalla === 'mesas' ? ' on' : '')} aria-pressed={pantalla === 'mesas'} onClick={() => setPantalla('mesas')}>
            🪑 {tOr('venta.vistaMesas', 'Mesas')}
            {mesasAbiertas > 0 && <em className="vd-vista-n">{mesasAbiertas}</em>}
          </button>
        </div>

        {pantalla === 'mesas' ? (
          <MesasResumen mesas={s.mesas} zonas={s.zonas} cuentas={s.cuentas} onOpen={irSalon} />
        ) : (
          <>
        <p className="vd-ayuda">{tOr('venta.ayuda', 'Mostrador: el cliente pide, paga y se va, sin mesa ni cuenta abierta. Las mesas se cobran en Caja.')}</p>
        <div className="vd-tabs" role="tablist" ref={ruedaHorizontal}>
          <button type="button" role="tab" aria-selected={secActiva === TODOS}
            className={secActiva === TODOS ? 'vd-tab on' : 'vd-tab'} onClick={() => setSec(TODOS)}>{tOr('venta.todos', 'Todos')}</button>
          {secciones.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === secActiva}
              className={x.id === secActiva ? 'vd-tab on' : 'vd-tab'} onClick={() => setSec(x.id)}>{x.nombre}</button>
          ))}
        </div>
        {agotadosEnSeccion.length > 0 && (
          <div className="vd-agotados">
            {agotadosEnSeccion.map(p => (
              <span key={p.id} className="vd-agotado" title={agotados[p.id].motivo || undefined}>
                🚫 {p.nombre}{agotados[p.id].motivo ? ` · ${agotados[p.id].motivo}` : ''}
                {puede(rol, 'gestionar_menu') && <button type="button" className="vd-agotado-x" onClick={() => quitarAgotado(p.id)} aria-label={t('agotado.disponible')} title={t('agotado.disponible')}>✕</button>}
              </span>
            ))}
          </div>
        )}
        {/* La carta entra por una tira que se desliza hacia la izquierda con su barra, igual que los
            grupos: con «Todos» hay decenas de platos y una rejilla solo dejaría ver los primeros. */}
        {!!productos.length && <div className="vd-grid" ref={el => { tira.current = el; ruedaHorizontal(el) }}>
          {productos.map(p => (
            <button key={p.id} className={'vd-prod' + (agotados[p.id] ? ' agotado' : '')} onClick={() => agregar(p)}
              title={agotados[p.id] ? t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }) : undefined}>
              <MiniaturaProducto producto={p} />
              <span>{p.nombre}</span><small>{m(p.precio)}</small>
              {agotados[p.id] && <small className="vd-agotado-tag">{t('agotado.badge')}</small>}
            </button>
          ))}
        </div>}
        {!productos.length && <p className="vd-vacio">{secActiva === TODOS ? tOr('venta.sinProductosTodos', 'No hay productos activos todavía.') : t('venta.sinProductos')}</p>}
          </>
        )}
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
                <b className="vd-pr">{m((l.p.precio + (l.extra || 0)) * l.qty)}</b>
                <button className="vd-x" onClick={() => quitar(l.id)} aria-label={t('venta.eliminar')}>×</button>
              </div>
              {l.indicaciones && <small className="vd-ind">{l.indicaciones}</small>}
              <input name="nota-placeholder" className="vd-nota" list="vd-notas-rapidas" placeholder={t('venta.notaPlaceholder')}
                value={l.nota} onChange={e => mudarNota(l.id, e.target.value)} />
            </li>
          ))}
        </ul>
        <datalist id="vd-notas-rapidas">{NOTAS_RAPIDAS.map(n => <option key={n} value={n} />)}</datalist>

        {!cobro
          ? <div className="vd-total"><span>{t('venta.total')}</span><b>{m(total)}</b></div>
          : <CobroForm cobro={cobro} onChange={setCobro} total={total} config={s.config} mostrarComanda />}

        <div className="vd-acciones">
          {!cobro
            ? <button className="primary big" disabled={!carrito.length} onClick={abrirCobro}>{t('venta.cobrar')}</button>
            : <>
              <button className="primary big" onClick={confirmarCobro}>{t('venta.confirmarPago')}</button>
              <button className="danger" onClick={() => setCobro(null)}>{t('venta.volver')}</button>
            </>}
        </div>
      </aside>
      {previa && (
        <IndicacionesPrevio producto={previa.p} listas={previa.listas}
          onClose={() => setPrevia(null)} onConfirm={confirmarPrevia} />
      )}
    </div>
  )
}
