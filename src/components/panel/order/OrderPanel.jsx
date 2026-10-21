import { useEffect, useRef, useState } from 'react'
import { useStore, cuentaActiva, cuentasDeMesa, totalCuenta, totalFinal, pagadoCuenta, saldoCuenta, ordenDelDia, nuevoId, pasoPedido } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { useMoneda } from '../../../services/money.js'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { imprimirCuenta, imprimirComandas } from '../../printing/Ticket.jsx'
import { nombreDeArea } from '../../../services/printing.js'
import { agotadosHoy, conMarca } from '../../../services/soldOut.js'
import ComprobanteQr, { VerComprobante } from '../pago/ComprobanteQr.jsx'
import PagoQrCard from '../pago/PagoQrCard.jsx'
import '../pago/ComprobanteQr.css'
import { listasDe, cumple, maxDe, notaDeUnidad, indicacionesDeUnidad, componerNota, comentarioDe, MAX_NOTA, extraDe, extraDeUnidad, selDeUnidad } from '../../../services/indicaciones.js'
import './OrderPanel.css'
import { round2, hora, limpiarMonto, numMonto } from '../../../services/format.js'

const cap = x => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '')

const PASOS = ['prep', 'parcial', 'listo', 'cuenta', 'pagada']
const PASOS_TXT = { prep: 'Prep', parcial: 'Parcial', listo: 'Listo', cuenta: 'Cuenta', pagada: 'Pagada' }

const nombreArea = (id, tOr, config) => nombreDeArea(config, id, tOr('areas.' + id, cap(id)))

function Thumb({ producto, nombreFallback }) {
  const url = urlImagenProducto(producto)
  const nombre = producto?.nombre ?? nombreFallback ?? ''
  const ini = (nombre.trim().charAt(0) || '?').toUpperCase()
  return (
    <span style={{
      width: LADO_VISUAL_PX, height: LADO_VISUAL_PX, flex: '0 0 auto', borderRadius: 8, overflow: 'hidden',
      background: 'var(--libre)', border: '1px solid var(--line)', display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontWeight: 700, fontSize: '.9rem',
    }}>
      {url
        ? <img src={url} alt={`Foto de ${nombre}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : ini}
    </span>
  )
}

const METODOS = ['efectivo', 'qr', 'tarjeta', 'otro']
const PIN_ADMIN_DEMO = '1234'

const MOTIVOS = ['error', 'cambio', 'agotado', 'demora', 'cortesia', 'otro']

function Ventana({ titulo, onClose, children }) {
  const { t } = useIdioma()
  const cerrarRef = useRef(null)
  const salir = useRef(onClose)
  salir.current = onClose
  useEffect(() => {
    // Solo al montar: si depende de onClose (una función nueva en cada render) roba el
    // foco del teclado en cada tecla que se escribe dentro de la ventana.
    const k = e => { if (e.key === 'Escape') salir.current() }
    document.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cerrarRef.current?.focus()
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [])
  return (
    <div className="modal-fondo pedido-fondo">
      <div className="modal-caja pedido-modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <button ref={cerrarRef} type="button" className="pm-atras" onClick={onClose} title={t('pedido.atrasTitulo')}>← {t('pedido.atras')}</button>
        {children}
      </div>
    </div>
  )
}

// `cobro` = llegó desde Caja: solo lo necesario para cobrar. `onEdicion` es el botón «Editar mesa»,
// que apaga ese modo y devuelve la vista completa de mesero.
export default function OrderPanel({ rol, sesion, mesa, cuenta, onClose, bloqueado, cobro, onEdicion }) {
  const { s, d } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const enCobro = Boolean(cobro)
  const usuario = sesion?.usuario || sesion?.nombre || rol
  const secciones = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const [sec, setSec] = useState(secciones[0]?.id)

  const secActiva = secciones.some(x => x.id === sec) ? sec : secciones[0]?.id
  const [marcados, setMarcados] = useState([])
  const [destino, setDestino] = useState('')
  const [canje, setCanje] = useState('')
  const [apertura, setApertura] = useState(null)
  // Apertura directa: al tocar una mesa libre se abre la cuenta (1 comensal) y los comensales se cambian dentro.
  const autoMesa = useRef(null)
  const autoPend = useRef(false)
  const autoCuenta = useRef(null)
  const [uniendo, setUniendo] = useState(false)
  const [aUnir, setAUnir] = useState([])
  const [desc, setDesc] = useState(null)
  const [prop, setProp] = useState(null)
  const [detalle, setDetalle] = useState('')
  const [pagos, setPagos] = useState(null)
  const [sinTurno, setSinTurno] = useState(null)
  const [borrando, setBorrando] = useState(null)
  const [nota, setNota] = useState(null)
  const [aviso, setAviso] = useState('')
  const [cuentaSelId, setCuentaSelId] = useState(null)
  const [menu, setMenu] = useState(false)
  const [modo, setModo] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [verQr, setVerQr] = useState(false)
  const [cliente, setCliente] = useState({ nombre: '', tel: '' })
  const avisoTimer = useRef(null)
  // Refs de los campos «Monto» por id de línea de pago: con índices, borrar una línea
  // descoloca el foco; con id siempre apuntamos al input correcto.
  const montoRefs = useRef({})
  const focoPendiente = useRef(null)
  const confirmarRef = useRef(null)
  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])
  useEffect(() => { setCuentaSelId(null); setModo(null); setMenu(false); setPrevia(null) }, [mesa?.id])
  // Para llevar: el panel se abre con la prop `cuenta` (mesa es undefined), así que el
  // prerrecargado del cliente mira `cuenta?.id`, no `mesa?.id`.
  useEffect(() => { setCliente({ nombre: cuenta?.clienteNombre || '', tel: cuenta?.clienteTel || '' }) }, [cuenta?.id])
  // Enter en el último monto crea la línea nueva; el foco salta a ella cuando ya está montada.
  useEffect(() => {
    if (!pagos || !focoPendiente.current) return
    const el = montoRefs.current[focoPendiente.current]
    if (el) { el.focus(); focoPendiente.current = null }
  }, [pagos])

  const hermanas = mesa ? cuentasDeMesa(s, mesa.id) : []
  const c = cuenta ?? hermanas.find(x => x.id === cuentaSelId) ?? hermanas[0]
  const sufijo = c?.tipo === 'mesa' && hermanas.length > 1 && c.etiqueta ? c.etiqueta : ''
  const titulo = c?.canal === 'llevar' ? tOr('pedido.llevarCabecera', `Pedido ${c.numero ?? ''}`, { n: c.numero }) + (c.clienteNombre ? ' · ' + c.clienteNombre : '') : c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : ((mesa?.nombre ?? t('pedido.cuenta')) + sufijo)
  const reset = () => { setMarcados([]); setDestino(''); setCanje(''); setPagos(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setApertura(null); setSinTurno(null); setBorrando(null); setNota(null); setModo(null); setMenu(false); setPrevia(null); focoPendiente.current = null }
  const cerrar = () => {
    // Si la cuenta se abrió con el toque y no se pidió nada, se descarta: así tocar una mesa por error no la deja ocupada.
    if (c && autoCuenta.current === c.id && c.tipo === 'mesa' && c.estado === 'abierta' && !(c.items || []).length && !(c.pagos || []).length) d({ t: 'abrir-descartar', cuentaId: c.id })
    autoCuenta.current = null
    reset(); onClose()
  }
  useEffect(() => {
    if (!mesa) { autoMesa.current = null; autoCuenta.current = null; autoPend.current = false; return }
    // En modo cobro Caja solo mira: tocar una mesa libre no abre una cuenta vacía.
    if (cobro) return
    if (bloqueado || !puede(rol, 'abrir_mesa') || autoMesa.current === mesa.id) return
    autoMesa.current = mesa.id
    if (cuentasDeMesa(s, mesa.id).length) return
    autoPend.current = true
    d({ t: 'abrir', mesaId: mesa.id, comensales: 1, usuario })
  }, [mesa?.id, bloqueado, cobro])
  useEffect(() => { if (autoPend.current && c?.id) { autoCuenta.current = c.id; autoPend.current = false } }, [c?.id])
  const toggle = id => { setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setCanje('') }
  const nombreMesa = id => s.mesas.find(m => m.id === id)?.nombre ?? t('pedido.mesaCorta')

  const pctProp = Number(s.config?.propinaPct) || 0
  const propinaIncluida = Boolean(s.config?.propinaIncluida) && pctProp > 0
  const manualProp = useRef(new Set())
  useEffect(() => { setDetalle(c?.detalle || '') }, [c?.id, c?.detalle])
  const baseProp = c ? Math.max(0, totalCuenta(c) - (c.descuento || 0)) : 0
  const propinaAuto = Math.round(baseProp * pctProp) / 100
  useEffect(() => {
    if (!c || !propinaIncluida || c.estado !== 'abierta' || !puede(rol, 'propina')) return
    if (manualProp.current.has(c.id)) return
    if (Math.abs((c.propina || 0) - propinaAuto) > 0.004) d({ t: 'extras', cuentaId: c.id, propina: propinaAuto })
  }, [c?.id, c?.estado, c?.propina, propinaAuto, propinaIncluida])

  if (!mesa && !cuenta) return null
  if (bloqueado) return null

  if (!c) return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <h3 className="pm-titulo">{titulo}</h3>
      <p>{enCobro ? tOr('caja.mesaLibre', 'La mesa está libre: no hay ninguna cuenta que cobrar.') : t('pedido.mesaLibre', { cap: mesa?.cap })}</p>
      {enCobro && puede(rol, 'abrir_mesa') && <button className="ghost" onClick={onEdicion}>✎ {tOr('caja.editarMesa', 'Editar mesa')}</button>}
      {!enCobro && puede(rol, 'abrir_mesa') && (apertura ? (
        <div className="pm-apertura">
          <span className="pm-pax">{t('pedido.comensales')}
            <button type="button" className="x" aria-label="−" disabled={(Number(apertura.comensales) || 1) <= 1}
              onClick={() => setApertura({ ...apertura, comensales: Math.max(1, (Number(apertura.comensales) || 1) - 1) })}>−</button>
            <input name="comensales" type="text" inputMode="numeric" autoComplete="off" value={apertura.comensales} autoFocus onFocus={e => e.target.select()}
              onChange={e => setApertura({ ...apertura, comensales: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })}
              onBlur={() => setApertura({ ...apertura, comensales: Math.min(99, Math.max(1, Number(apertura.comensales) || 1)) })} />
            <button type="button" className="x" aria-label="+" disabled={(Number(apertura.comensales) || 1) >= 99}
              onClick={() => setApertura({ ...apertura, comensales: Math.min(99, (Number(apertura.comensales) || 1) + 1) })}>+</button>
          </span>
          <span className="pm-abrio">👤 {t('pedido.abriraComo', { usuario })}</span>
          <div className="pm-apertura-acc">
            <button className="success" onClick={() => {
              d({ t: 'abrir', mesaId: mesa.id, comensales: Math.min(99, Math.max(1, Number(apertura.comensales) || 1)), usuario })
              setApertura(null)
            }}>{t('comun.confirmar')}</button>
            <button className="danger" onClick={() => setApertura(null)}>{t('comun.cancelar')}</button>
          </div>
        </div>
      ) : <button className="success big" onClick={() => setApertura({ comensales: mesa?.cap ?? 1 })}>{t('pedido.abrirCuenta')}</button>)}
    </Ventana>
  )

  // En modo cobro (llegó desde Caja) la cuenta no se toma ni se edita: quedan fuera la carta,
  // las cantidades y las acciones de cocina. Propina y descuento sí son tarea del cajero.
  const editable = !enCobro && c.estado === 'abierta'
  const ajustes = enCobro || c.estado === 'abierta'
  const esLlevar = c.canal === 'llevar'
  const subtotal = totalCuenta(c)
  const final = totalFinal(c)
  const pagado = pagadoCuenta(c)
  const saldo = saldoCuenta(c)
  const vivos = c.items.filter(i => i.estado !== 'anulado')
  const seleccion = vivos.filter(i => marcados.includes(i.id))
  const totalSeleccion = round2(seleccion.reduce((t2, i) => t2 + i.precio * i.qty, 0))
  const conceptoSeleccion = seleccion.map(i => `${i.qty}× ${i.nombre}`).join(', ').slice(0, 120)
  const puedeDescuento = puede(rol, 'descuento')
  const puedeDescuentoPin = puede(rol, 'descuento_pin')
  const puedePropina = puede(rol, 'propina')
  const puedeUnir = puede(rol, 'unir_mesas')
  const puedeMover = puede(rol, 'mover_items')
  const puedeBorrar = puede(rol, 'borrar_producto')
  const estadoVisto = tOr('estado.' + c.estado, c.estado)

  // Nombre/teléfono del pedido para llevar: guarda con el action 'llevar~' ya existente,
  // solo si el valor cambió (Enter o blur), para no escribir de más en la base.
  const guardarCliente = () => {
    if (!esLlevar || !editable) return
    const nombre = cliente.nombre.trim().slice(0, 80)
    const tel = cliente.tel.trim().slice(0, 40)
    if (nombre === (c.clienteNombre || '') && tel === (c.clienteTel || '')) return
    d({ t: 'llevar~', cuentaId: c.id, nombre, tel })
  }

  const nombreDeCuenta = x => {
    const hnas = s.cuentas.filter(y => y.estado !== 'cerrada' && y.mesaIds.some(m => x.mesaIds.includes(m))).length
    return x.mesaIds.map(nombreMesa).join(' + ') + (hnas > 1 && x.etiqueta ? x.etiqueta : '')
  }
  const destinos = [
    ...s.cuentas.filter(x => x.id !== c.id && x.estado !== 'cerrada' && x.tipo === 'mesa')
      .sort((x, y) => nombreDeCuenta(x).localeCompare(nombreDeCuenta(y), undefined, { numeric: true }))
      .map(x => ({ key: 'c:' + x.id, nombre: nombreDeCuenta(x), label: `${nombreDeCuenta(x)} · ${money(totalCuenta(x))}`, cuenta: x })),
    ...s.mesas.filter(m => !s.cuentas.some(x => x.estado !== 'cerrada' && x.mesaIds.includes(m.id)))
      .map(m => ({ key: 'm:' + m.id, nombre: m.nombre, label: `${m.nombre} · ${t('pedido.libre')}`, mesaId: m.id })),
  ]
  const destinoSel = destinos.find(x => x.key === destino)
  const cuentaDestino = destinoSel?.cuenta || null
  const itemsDestino = (cuentaDestino?.items || []).filter(i => i.estado !== 'anulado')
  const mover = () => {
    if (!destinoSel || !marcados.length) return
    d({ t: 'mover', cuentaId: c.id, itemIds: marcados, ...(destinoSel.cuenta ? { cuentaDestinoId: destinoSel.cuenta.id } : { mesaDestino: destinoSel.mesaId }), usuario })
    setMarcados([]); setDestino(''); setCanje('')
    avisar(t('pedido.movidoOk', { mesa: destinoSel.nombre }))
  }
  const intercambiar = () => {
    if (!cuentaDestino || marcados.length !== 1 || !canje) return
    d({ t: 'intercambiar', cuentaA: c.id, itemA: marcados[0], cuentaB: cuentaDestino.id, itemB: canje, usuario })
    setMarcados([]); setDestino(''); setCanje('')
    avisar(t('pedido.intercambiadoOk', { mesa: destinoSel?.nombre || '' }))
  }

  const pedirBorrar = i => {
    const enviado = i.estado === 'enviado' || i.estado === 'listo'
    if (!puede(rol, enviado ? 'anular_enviado' : 'anular_pendiente')) return avisar(enviado ? t('pedido.needAdmin') : t('pedido.sinPermisoAnular'))
    if (!enviado && !puedeBorrar) {
      d({ t: 'anular', cuentaId: c.id, itemId: i.id, motivo: 'pendiente' })
      setMarcados(m => m.filter(x => x !== i.id))
      return
    }
    setBorrando(b => (b?.id === i.id ? null : { id: i.id, motivo: '', texto: '' }))
  }
  const confirmarBorrar = i => {
    const base = borrando.motivo ? t('pedido.motivo.' + borrando.motivo) : ''
    const motivo = [base, borrando.texto.trim()].filter(Boolean).join(': ')
    if ((i.estado === 'enviado' || i.estado === 'listo') && !motivo) return avisar(t('pedido.motivoOblig'))
    d({ t: 'anular', cuentaId: c.id, itemId: i.id, motivo: motivo || 'pendiente' })
    setMarcados(m => m.filter(x => x !== i.id))
    setBorrando(null)
  }

  const aplicarDescuento = () => {
    const v = Number(desc?.valor)
    if (!(v > 0)) return avisar(t('pedido.valorNoValido'))
    if (!puedeDescuento && (desc.pin || '') !== PIN_ADMIN_DEMO) return avisar(t('pedido.pinIncorrecto'))
    const monto = desc.modo === 'pct' ? Math.min(subtotal, subtotal * v / 100) : Math.min(subtotal, v)
    d({ t: 'extras', cuentaId: c.id, descuento: Math.round(monto * 100) / 100 })
    setDesc(null)
  }
  const aplicarPropina = pct => {
    if (propinaIncluida && Math.abs(pct * 100 - pctProp) < 0.0001) manualProp.current.delete(c.id)
    else manualProp.current.add(c.id)
    const base = Math.max(0, subtotal - (c.descuento || 0))
    const monto = round2(base * pct)
    d({ t: 'extras', cuentaId: c.id, propina: monto })
    setProp(null)
  }

  const listo = pasoPedido(c)
  // Cobrar nunca depende de «Marcar listo»: el paso solo se muestra, no corta nada.
  const iniciarCobro = () => {
    if (!s.caja?.turno) { setSinTurno({ fondo: '' }); return }
    setMarcados([])
    setPagos([{ id: nuevoId(), metodo: 'efectivo', monto: String(saldo.toFixed(2)) }])
  }
  const abrirTurnoYCobrar = () => {
    const f = numMonto(sinTurno.fondo)
    d({ t: 'turno+', fondo: round2(f), usuario })
    setSinTurno(null)
    setMarcados([])
    setPagos([{ id: nuevoId(), metodo: 'efectivo', monto: String(saldo.toFixed(2)) }])
  }
  const sumaPagos = round2((pagos || []).reduce((t2, p) => t2 + numMonto(p.monto), 0))
  const pendiente = round2(Math.max(0, saldo - sumaPagos))
  // Total del cobro separado por método (Efectivo / QR / …): se ve en pantalla antes de confirmar.
  const desgloseMetodos = Object.entries((pagos || []).reduce((acc, p) => {
    const v = numMonto(p.monto)
    if (v > 0) acc[p.metodo] = round2((acc[p.metodo] || 0) + v)
    return acc
  }, {}))
  const cambio = round2(Math.max(0, sumaPagos - saldo))
  const lineas = () => pagos.filter(p => numMonto(p.monto) > 0).map(p => ({ metodo: p.metodo, monto: numMonto(p.monto), ...(p.metodo === 'qr' && p.comprobante ? { comprobante: p.comprobante } : {}) }))
  const subiendoFoto = () => pagos.some(p => p.subiendo)
  const confirmarCobro = () => {
    if (subiendoFoto()) return avisar(t('comp.subiendo'))
    if (pendiente > 0.009) return avisar(t('pedido.faltaParaCobrar', { faltan: money(pendiente), total: money(saldo) }))
    const l = lineas()
    if (!l.length) return avisar(t('pedido.sinPagos'))
    d({ t: 'cobrar', cuentaId: c.id, pagos: l, ...(marcados.length ? { concepto: conceptoSeleccion } : {}), propina: c.propina || 0, descuento: c.descuento || 0, usuario })
    cerrar()
  }
  // El abono deja la cuenta abierta con su saldo: es lo que permite cobrar 2 cervezas
  // y que la mesa siga pedida, o que uno del grupo se vaya pagando su parte.
  const confirmarAbono = () => {
    if (subiendoFoto()) return avisar(t('comp.subiendo'))
    const l = lineas()
    if (!l.length) return avisar(t('pedido.sinPagos'))
    if (pendiente <= 0.009) return avisar(t('pedido.abonoCubreTodo'))
    d({ t: 'abonar', cuentaId: c.id, pagos: l, ...(marcados.length ? { concepto: conceptoSeleccion } : {}), usuario })
    setPagos(null); setMarcados([])
    avisar(t('pedido.abonadoOk', { monto: money(sumaPagos), saldo: money(round2(saldo - sumaPagos)) }))
  }
  // Enter en un monto: con saldo cubierto va a la línea vacía sin usar (si existe) o confirma;
  // si falta dinero, baja a la siguiente línea y, si era la última, crea una nueva.
  // Nota: se mantiene type="text" + inputMode="decimal" (con type=number el teclado saltaba y no dejaba escribir).
  const agregarPago = () => {
    const nid = nuevoId()
    focoPendiente.current = nid
    setPagos(ps => [...ps, { id: nid, metodo: 'efectivo', monto: '' }])
  }
  const enterMonto = (i, p) => {
    if (pendiente <= 0.009) {
      const vacia = pagos.find(x => x.id !== p.id && x.monto === '')
      if (vacia) { montoRefs.current[vacia.id]?.focus(); return }
      confirmarRef.current?.focus()
      return
    }
    const sig = pagos[i + 1]
    if (sig) { montoRefs.current[sig.id]?.focus(); return }
    if (numMonto(p.monto) <= 0) return
    agregarPago()
  }

  const imprimirTicketCuenta = async () => {
    if (!c.items.length) return avisar(t('pedido.cuentaVacia'))
    const r = await imprimirCuenta({
      cuenta: c, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }),
      datos: { salon: (s.zonas || []).find(z => z.id === mesa?.zona)?.nombre, mesa: titulo, orden: ordenDelDia(s.cuentas, c) },
    })
    if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
    else if (r === 'sin-impresora') avisar(t('pedido.avisoSinImpresoraTicket'))
    else if (r === 'encolado') avisar(t('pedido.ticketEnviadoEstacion'))
  }

  const resumenEnvio = salida => salida.map(({ grupo, resultado, n }) => (
    resultado === 'silencioso' || resultado === 'encolado' ? `${grupo.nombre} (${n}) ✔`
      : resultado === 'sin-impresora' ? t('pedido.sinImpresoraGrupo', { grupo: grupo.nombre })
        : t('pedido.errorImpresoraGrupo', { grupo: grupo.nombre })
  )).join(' · ')

  const enviarCocina = async () => {
    const pend = c.items.filter(i => i.estado === 'pendiente')
    if (!pend.length) return
    d({ t: 'enviar', cuentaId: c.id })
    const salida = await imprimirComandas({ cuenta: c, items: pend, productos: s.productos, config: s.config, titulo: t('pedido.comandaTitulo', { titulo }) })
    avisar(`${t('pedido.enviadoOk')}: ${resumenEnvio(salida)}`)
  }
  const reimprimirComanda = async () => {
    const env = c.items.filter(i => i.estado === 'enviado')
    if (!env.length) return avisar(t('pedido.nadaQueReimprimir'))
    const salida = await imprimirComandas({ cuenta: c, items: env, productos: s.productos, config: s.config, titulo: t('pedido.comandaTitulo', { titulo }) })
    avisar(resumenEnvio(salida))
  }

  const chico = { minHeight: 32, padding: '2px 10px' }
  const abrirModo = m => { setModo(m); setMenu(false); setMarcados([]); setDestino(''); setCanje(''); setBorrando(null) }
  const dividir = () => { setMenu(false); d({ t: 'dividir', cuentaId: c.id, usuario }); setModo('mover'); avisar(t('pedido.divididaOk')) }
  const hayMenu = editable && (vivos.length > 0 || (puedeUnir && c.tipo === 'mesa'))

  const agotados = agotadosHoy(s.config)
  const puedeMenu = puede(rol, 'gestionar_menu')

  const agregarProd = p => {
    if (agotados[p.id]) return avisar(t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }))
    const listas = listasDe(s.config, p)
    return listas.length ? setPrevia({ p, listas, unidades: [nuevaUnidad()], foco: 0 }) : d({ t: 'item+', cuentaId: c.id, p })
  }
  const nuevaUnidad = () => ({ sel: {}, texto: '' })
  const unidadCompleta = (listas, u) => listas.every(l => cumple(l, u.sel[l.id]))
  const cambiarCantidad = dq => setPrevia(v => {
    const n = Math.min(30, Math.max(1, v.unidades.length + dq))
    const unidades = n > v.unidades.length ? [...v.unidades, ...Array.from({ length: n - v.unidades.length }, nuevaUnidad)] : v.unidades.slice(0, n)
    return { ...v, unidades, foco: Math.min(v.foco, n - 1) }
  })
  // Toca una opción: actúa sobre la unidad en foco; si con eso queda completa, el foco pasa a la siguiente incompleta.
  const tocarOpcion = (lista, o) => setPrevia(v => {
    const unidades = v.unidades.map((u, i) => {
      if (i !== v.foco) return u
      const act = u.sel[lista.id] || []
      let nuevo
      if (act.includes(o)) nuevo = act.filter(x => x !== o)
      else if (maxDe(lista) === 1) nuevo = [o]
      else nuevo = act.length >= maxDe(lista) ? act : [...act, o]
      return { ...u, sel: { ...u.sel, [lista.id]: nuevo } }
    })
    let foco = v.foco
    const saturada = l => { const n = (unidades[foco].sel[l.id] || []).length; return maxDe(l) !== Infinity ? n >= maxDe(l) : (!l.obligatoria || n >= 1) }
    if (v.listas.every(saturada)) {
      const sig = unidades.findIndex((u, i) => i > foco && !unidadCompleta(v.listas, u))
      if (sig >= 0) foco = sig
    }
    return { ...v, unidades, foco }
  })

  const quitarAgotado = id => d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, id, null) } })
  const agotadosEnSeccion = s.productos.filter(p => p.seccionId === secActiva && agotados[p.id])
  const previaLista = previa ? previa.unidades.every(u => unidadCompleta(previa.listas, u)) : false
  const confirmarPrevia = () => {
    if (!previaLista) return
    // Una unidad = un ítem con su nota; las iguales se juntan solas («2× Carne — Medio»).
    previa.unidades.forEach(u => {
      const nota = notaDeUnidad(previa.listas, u)
      const indicaciones = indicacionesDeUnidad(previa.listas, u)
      const extra = extraDeUnidad(previa.listas, u)
      const sel = selDeUnidad(previa.listas, u)
      d({ t: 'item+', cuentaId: c.id, p: previa.p, ...(nota ? { nota } : {}), ...(indicaciones ? { indicaciones } : {}), ...(extra ? { extra } : {}), ...(sel.length ? { sel } : {}) })
    })
    setPrevia(null)
  }
  const hayPendientes = c.items.some(i => i.estado === 'pendiente')

  return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <div className="fila pm-cab">
        <h3 className="pm-titulo">{titulo}</h3>
        <span className={'tag ' + c.estado}>{estadoVisto}</span>
        <span className="pm-pasos" title={tOr('pedido.pasosAyuda', 'Prep → tomando pedido · Parcial/Listo → cocina · Cuenta → pre-cuenta · Pagada → cobrada')}>
          {PASOS.map(p => <em key={p} data-paso={p} className={'pm-paso' + (p === listo ? ' on' : '')}>{tOr('paso.' + p, PASOS_TXT[p])}</em>)}
        </span>
        {enCobro && puede(rol, 'abrir_mesa') && (
          <button type="button" className="ghost pm-cobro-editar" onClick={onEdicion} title={tOr('caja.editarMesaTitle', 'Ver la mesa como mesero: tomar pedido, mover o eliminar ítems')}>✎ {tOr('caja.editarMesa', 'Editar mesa')}</button>
        )}
        {hayMenu && (
          <div className="pm-mas">
            <button type="button" className="pm-mas-btn" aria-haspopup="menu" aria-expanded={menu} title={t('pedido.masOpciones')} aria-label={t('pedido.masOpciones')} onClick={() => setMenu(v => !v)}>⋯</button>
            {menu && (
              <>
                <div className="pm-mas-fondo" onClick={() => setMenu(false)} />
                <ul className="pm-mas-menu" role="menu">
                  {vivos.length > 0 && <li><button type="button" className="peligro" role="menuitem" onClick={() => abrirModo('eliminar')}>🗑 {t('pedido.menuEliminar')}</button></li>}
                  {puedeMover && vivos.length > 0 && <li><button type="button" role="menuitem" onClick={() => abrirModo('mover')}>↔ {t('pedido.menuMover')}</button></li>}
                  {puedeUnir && c.tipo === 'mesa' && hermanas.length < 8 && <li><button type="button" role="menuitem" onClick={dividir}>✂ {t('pedido.menuDividir')}</button></li>}
                  {puedeUnir && c.tipo === 'mesa' && c.mesaIds.length < s.mesas.length && <li><button type="button" role="menuitem" onClick={() => { setMenu(false); setUniendo(true) }}>🔗 {t('pedido.menuUnir')}</button></li>}
                  {puedeUnir && c.mesaIds.length > 1 && c.mesaIds.map(id => (
                    <li key={id}><button type="button" role="menuitem" onClick={() => { setMenu(false); d({ t: 'separar', cuentaId: c.id, mesaId: id, usuario }) }}>⛓ {t('pedido.menuSeparar', { mesa: nombreMesa(id) })}</button></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <p className="pm-ayuda">{enCobro
        ? tOr('caja.modoCobroAyuda', 'Vista de cobro: la cuenta con lo que falta pagar. «✎ Editar mesa» abre la vista del mesero.')
        : tOr('pedido.pasosAyuda', 'Prep → tomando pedido · Parcial/Listo → cocina · Cuenta → pre-cuenta · Pagada → cobrada')}</p>
      {!cuenta && hermanas.length > 1 && (
        <div className="barra pm-subcuentas" role="tablist">
          {hermanas.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === c.id} className={'tab' + (x.id === c.id ? ' on' : '')} onClick={() => { setCuentaSelId(x.id); setMarcados([]); setDestino('') }}>
              {mesa.nombre}{x.etiqueta} · {money(totalFinal(x))}
            </button>
          ))}
        </div>
      )}
      {modo && (
        <div className="pm-modo" role="status">
          <span>{modo === 'eliminar' ? t('pedido.modoEliminar') : t('pedido.modoMover')}</span>
          <button type="button" className="ghost" onClick={() => abrirModo(null)}>{t('pedido.modoListo')}</button>
        </div>
      )}

      <div className="pm-sub fila" style={{ gap: 10, flexWrap: 'wrap' }}>
        {c.tipo === 'mesa' && editable && puede(rol, 'abrir_mesa') ? (
          <span className="pm-pax">{t('pedido.comensales')}
            <button type="button" className="x" disabled={(c.comensales || 1) <= 1} aria-label="−" onClick={() => d({ t: 'comensales~', cuentaId: c.id, comensales: Math.max(1, (c.comensales || 1) - 1) })}>−</button>
            <b>{c.comensales || 1}</b>
            <button type="button" className="x" disabled={(c.comensales || 1) >= 99} aria-label="+" onClick={() => d({ t: 'comensales~', cuentaId: c.id, comensales: Math.min(99, (c.comensales || 1) + 1) })}>+</button>
          </span>
        ) : (c.comensales ? <span className="pm-pax-info">{t('pedido.comensalesInfo', { comensales: c.comensales })}</span> : null)}
        {c.abiertaPor ? (
          <span className="pm-abrio" title={t('pedido.abrio', { usuario: c.abiertaPor })}>
            👤 {c.abiertaEn
              ? t('pedido.abrioHora', { usuario: c.abiertaPor, hora: hora(c.abiertaEn) })
              : t('pedido.abrio', { usuario: c.abiertaPor })}
          </span>
        ) : null}
      </div>
      {aviso && <div className="pm-aviso" role="status">{aviso}<button type="button" className="ico" onClick={() => setAviso('')} aria-label={t('comun.cancelar')}>✕</button></div>}

      {c.mesaIds.length > 1 && (
        <div className="barra" style={{ gap: 6 }}>
          {c.mesaIds.map(id => <span key={id} className="pm-chip">{nombreMesa(id)}</span>)}
        </div>
      )}
      {uniendo && (
        <div className="pm-caja">
          <b style={{ fontSize: '.85rem' }}>{t('pedido.unirNota')}</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
            {s.mesas.filter(m => !c.mesaIds.includes(m.id)).map(m => {
              const mc = cuentaActiva(s, m.id)
              return (
                <label key={m.id} className={'pm-opcion' + (aUnir.includes(m.id) ? ' on' : '')}>
                  <input name="unir-mesa" type="checkbox" checked={aUnir.includes(m.id)} style={{ width: 16, height: 16 }}
                    onChange={() => setAUnir(a => a.includes(m.id) ? a.filter(x => x !== m.id) : [...a, m.id])} />
                  {m.nombre}{mc ? ` · ${money(totalCuenta(mc))}` : ` · ${t('pedido.libre')}`}
                </label>
              )
            })}
          </div>
          <div className="barra">
            <button className="violet" disabled={!aUnir.length} onClick={() => { d({ t: 'unir', cuentaId: c.id, mesaIds: aUnir }); setUniendo(false); setAUnir([]) }}>{t('pedido.unirN', { n: aUnir.length })}</button>
            <button className="danger" onClick={() => { setUniendo(false); setAUnir([]) }}>{t('comun.cancelar')}</button>
          </div>
        </div>
      )}

      <div className={'pm-cols' + (editable ? ' dos' : '')}>
        {editable && (
          <section className="pm-carta">
            <div className="barra pm-tabs">{secciones.map(x => <button key={x.id} className={x.id === secActiva ? 'tab on' : 'tab'} onClick={() => setSec(x.id)}>{x.nombre}</button>)}</div>
            {agotadosEnSeccion.length > 0 && (
              <div className="pm-agotados">
                {agotadosEnSeccion.map(p => (
                  <span key={p.id} className="pm-agotado" title={agotados[p.id].motivo || undefined}>
                    🚫 {p.nombre}{agotados[p.id].motivo ? ` · ${agotados[p.id].motivo}` : ''}
                    {puedeMenu && <button type="button" className="ico pm-agotado-x" onClick={() => quitarAgotado(p.id)} aria-label={t('agotado.disponible')} title={t('agotado.disponible')}>✕</button>}
                  </span>
                ))}
              </div>
            )}
            <div className="grid">
              {s.productos.filter(p => p.activo && p.seccionId === secActiva).map(p => (
                <button key={p.id} className={'prod' + (agotados[p.id] ? ' agotado' : '')} onClick={() => agregarProd(p)}
                  title={agotados[p.id] ? t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }) : undefined}>
                  <Thumb producto={p} />
                  {p.nombre}<small>{money(p.precio)}</small>
                  {agotados[p.id] && <small className="prod-agotado">{t('agotado.badge')}</small>}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="pm-cuenta">

          <ul className="items">
            {c.items.map(i => (
              <li key={i.id} className={i.estado + ' pm-item'}>
                <Thumb producto={s.productos.find(x => x.id === i.productoId)} nombreFallback={i.nombre} />
                {modo === 'mover' && puedeMover && editable && i.estado !== 'anulado' && <input name="mover-title" type="checkbox" checked={marcados.includes(i.id)} onChange={() => toggle(i.id)} aria-label={t('pedido.moverTitle')} />}
                {pagos && i.estado !== 'anulado' && <input name="marcar-para-cobrar" type="checkbox" checked={marcados.includes(i.id)} onChange={() => toggle(i.id)} aria-label={t('pedido.marcarParaCobrar')} title={t('pedido.marcarParaCobrar')} />}
                <span className="n">
                  {i.nombre}
                  {i.estado === 'anulado' && t('pedido.anuladoTag')}
                  {i.estado === 'listo' && <em> · {tOr('estadoItem.listo', 'Listo')}</em>}
                  {i.estado === 'enviado' && Array.isArray(i.areasListas) && i.areasListas.length > 0 && (
                    <em> · {tOr('estadoItem.parcial', 'Parcial')}: {i.areasListas.map(x => nombreDeArea(s.config, x, x)).join(', ')}</em>
                  )}
                  {i.estado === 'anulacion' && <em> · {tOr('estadoItem.anulacion', 'Anulación pedida')}</em>}
                  {i.nota && <em> · {i.nota}</em>}
                  {i.motivo && (i.estado === 'anulado' || i.estado === 'anulacion') && <em> · {i.motivo}</em>}
                  {Array.isArray(i.areas) && i.areas.length > 0 && (
                    <span className="pm-chip" style={{ marginLeft: 6, fontSize: '.72rem' }} title={tOr('areas.title', 'Áreas donde se imprime este artículo')}>
                      🖨 {i.areas.map(a => nombreArea(a, tOr, s.config)).join(' + ')}
                    </span>
                  )}
                </span>
                {editable && i.estado === 'pendiente' ? (
                  <span className="qty"><button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: -1 })}>−</button>{i.qty}<button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: 1 })}>+</button></span>
                ) : <span>×{i.qty}</span>}
                <span className="pr">{money(i.precio * i.qty)}</span>
                {modo === 'eliminar' && editable && i.estado !== 'anulado' && i.estado !== 'anulacion' && <button className="x danger solid" title={t('pedido.borrarProducto')} aria-label={t('pedido.borrarProducto')} onClick={() => pedirBorrar(i)}>🗑</button>}
                {editable && i.estado === 'pendiente' && <button className="x" title={t('pedido.notaTitle')} onClick={() => setNota(n => (n?.id === i.id ? null : { id: i.id, texto: comentarioDe(i.nota, i.indicaciones) }))}>✎</button>}

                {nota?.id === i.id && (
                  <form className="pm-sub-fila" style={{ flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); d({ t: 'nota', cuentaId: c.id, itemId: i.id, nota: componerNota(i.indicaciones, nota.texto) }); setNota(null) }}>
                    {i.indicaciones && (
                      <div className="pm-indic-fijas" style={{ width: '100%' }}>
                        <span className="pm-chip">🔒 {t('pedido.indicaciones')}: {i.indicaciones}</span>
                        <small>{t('pedido.indicacionesFijas')}</small>
                      </div>
                    )}
                    <input name="nota-prompt" autoFocus value={nota.texto} maxLength={Math.max(0, MAX_NOTA - (i.indicaciones ? i.indicaciones.length + 2 : 0))} placeholder={t('pedido.notaPrompt')} onChange={e => setNota({ ...nota, texto: e.target.value })} style={{ flex: 1 }} />
                    <button type="submit" className="primary" style={chico}>{t('comun.guardar')}</button>
                    <button type="button" className="danger" style={chico} onClick={() => setNota(null)}>✕</button>
                  </form>
                )}
                {borrando?.id === i.id && (
                  <div className="pm-borrar">
                    <b>{t('pedido.borrarTitulo', { nombre: i.nombre })}</b>
                    <div className="pm-motivos" role="group" aria-label={t('pedido.motivoLabel')}>
                      {MOTIVOS.map(k => (
                        <button key={k} type="button" className={'tab' + (borrando.motivo === k ? ' on' : '')} style={chico}
                          onClick={() => setBorrando({ ...borrando, motivo: borrando.motivo === k ? '' : k })}>{t('pedido.motivo.' + k)}</button>
                      ))}
                    </div>
                    <input name="texto" value={borrando.texto} maxLength={80} placeholder={i.estado !== 'pendiente' ? t('pedido.motivoEscribe') : t('pedido.motivoOpcional')}
                      onChange={e => setBorrando({ ...borrando, texto: e.target.value })} />
                    <div className="barra" style={{ margin: 0 }}>
                      <button type="button" className="danger solid" onClick={() => confirmarBorrar(i)}>{t('pedido.confirmarBorrar')}</button>
                      <button type="button" className="danger" onClick={() => setBorrando(null)}>{t('comun.cancelar')}</button>
                      {i.estado !== 'pendiente' && <small style={{ color: 'var(--mut)' }}>{t('pedido.motivoOblig')}</small>}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {!c.items.length && <li className="vacio">{t('pedido.sinItems')}</li>}
          </ul>

          {esLlevar && editable && (
            <div className="pm-cliente">
              <label className="pm-campo">{t('salon.llevarNombre')}
                <input name="llevar-nombre" value={cliente.nombre} maxLength={80} aria-label={t('salon.llevarNombre')}
                  onChange={e => setCliente(v => ({ ...v, nombre: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarCliente(); e.currentTarget.blur() } }}
                  onBlur={guardarCliente} />
              </label>
              <label className="pm-campo">{t('salon.llevarTel')}
                <input name="llevar-tel" value={cliente.tel} maxLength={40} inputMode="tel" aria-label={t('salon.llevarTel')}
                  onChange={e => setCliente(v => ({ ...v, tel: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarCliente(); e.currentTarget.blur() } }}
                  onBlur={guardarCliente} />
              </label>
            </div>
          )}

          {modo === 'mover' && puedeMover && editable && (
            <div className="pm-caja pm-mover">
              <b>{t('pedido.moverTitulo')}</b>
              <label className="pm-campo">{t('pedido.destino')}
                <select name="destino" value={destino} onChange={e => { setDestino(e.target.value); setCanje('') }}>
                  <option value="">{t('pedido.elegirMesa')}</option>
                  {destinos.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </label>
              <div className="barra" style={{ margin: 0 }}>
                <button className="teal" disabled={!destino || !marcados.length} onClick={mover}>{t('pedido.moverN', { n: marcados.length })}</button>
              </div>
              {destino && marcados.length === 1 && (
                itemsDestino.length ? (
                  <div className="barra" style={{ margin: 0 }}>
                    <select name="intercambiar-por" value={canje} onChange={e => setCanje(e.target.value)} aria-label={t('pedido.intercambiarPor')}>
                      <option value="">{t('pedido.intercambiarPor')}</option>
                      {itemsDestino.map(i => <option key={i.id} value={i.id}>{i.qty}× {i.nombre}</option>)}
                    </select>
                    <button className="violet" disabled={!canje} onClick={intercambiar}>⇄ {t('pedido.intercambiar')}</button>
                  </div>
                ) : <small style={{ color: 'var(--mut)' }}>{t('pedido.destinoVacia')}</small>
              )}
            </div>
          )}

          {(editable || c.detalle) && (
            <label className="pm-detalle">
              <span>{t('pedido.detalleCuenta')}</span>
              <textarea name="detalle-cuenta-hint" rows={2} maxLength={500} value={detalle} readOnly={!editable} placeholder={t('pedido.detalleCuentaHint')}
                onChange={e => setDetalle(e.target.value)}
                onBlur={() => { if (editable && detalle.trim() !== (c.detalle || '')) d({ t: 'detalle', cuentaId: c.id, detalle: detalle.trim() }) }} />
            </label>
          )}

          {puedePropina && ajustes && (
            <div className="barra" style={{ fontSize: '.85rem' }}>
              <span>{t('pedido.propina')}{c.propina ? `: ${money(c.propina)}` : ''}:</span>
              {s.config.propinaPct > 0 && <button className="ghost" style={chico} onClick={() => aplicarPropina(s.config.propinaPct / 100)}>{s.config.propinaPct}% {t('pedido.sugerida')}</button>}
              <button className="danger" style={chico} onClick={() => aplicarPropina(0)}>{t('comun.quitar')}</button>
              {prop === null
                ? <button className="ghost" style={chico} onClick={() => setProp('15')}>{t('pedido.otraPct')}</button>
                : <>
                  <input name="prop" type="text" inputMode="numeric" autoComplete="off" value={prop} style={{ width: 64 }} onChange={e => setProp(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} onFocus={e => e.target.select()} placeholder="%" />
                  <button className="primary" style={chico} onClick={() => { const v = Number(prop); if (v > 0) aplicarPropina(v / 100); else setProp(null) }}>{t('comun.ok')}</button>
                  <button className="danger" style={chico} onClick={() => setProp(null)}>✕</button>
                </>}
            </div>
          )}

          {(puedeDescuento || puedeDescuentoPin) && ajustes && (
            <div className="barra" style={{ fontSize: '.85rem' }}>
              <span>{t('pedido.descuento')}{c.descuento ? `: ${money(c.descuento)}` : ''}:</span>
              {desc === null ? <>
                <button className="primary" style={chico} onClick={() => setDesc({ modo: 'monto', valor: '', pin: '' })}>{t('pedido.aplicar')}</button>
                {c.descuento > 0 && <button className="danger" style={chico} onClick={() => d({ t: 'extras', cuentaId: c.id, descuento: 0 })}>{t('comun.quitar')}</button>}
              </> : <>
                <select name="modo" value={desc.modo} onChange={e => setDesc({ ...desc, modo: e.target.value })}><option value="monto">{t('comun.monto')}</option><option value="pct">{t('pedido.pctSubtotal')}</option></select>
                <input name="valor" type="text" inputMode={desc.modo === 'pct' ? 'numeric' : 'decimal'} autoComplete="off" value={desc.valor} style={{ width: 80 }}
                  onChange={e => setDesc({ ...desc, valor: desc.modo === 'pct' ? e.target.value.replace(/[^0-9]/g, '').slice(0, 3) : limpiarMonto(e.target.value) })}
                  onFocus={e => e.target.select()} placeholder={desc.modo === 'pct' ? t('pedido.pEjemplo10') : t('pedido.pEjemplo15')} />
                {!puedeDescuento && <input name="pin-admin" type="password" inputMode="numeric" value={desc.pin} style={{ width: 90 }} onChange={e => setDesc({ ...desc, pin: e.target.value })} placeholder={t('pedido.pinAdmin')} />}
                <button className="primary" style={chico} onClick={aplicarDescuento}>{t('comun.ok')}</button>
                <button className="danger" style={chico} onClick={() => setDesc(null)}>✕</button>
                {!puedeDescuento && <small style={{ color: 'var(--mut)' }}>{t('pedido.avisoCajeroPin')}</small>}
              </>}
            </div>
          )}

          <div className="total"><span>{t('pedido.subtotal')}</span><b>{money(subtotal)}</b></div>
          {c.descuento > 0 && <div className="total"><span>{t('pedido.descuento')}</span><b>−{money(c.descuento)}</b></div>}
          {c.propina > 0 && <div className="total"><span>{t('pedido.propina')}</span><b>{money(c.propina)}</b></div>}
          {s.config?.propinaMostrar !== false && !propinaIncluida && pctProp > 0 && !(c.propina > 0) && baseProp > 0 && <div className="total pm-sugerida"><span>{t('pedido.propinaSugeridaLinea', { pct: pctProp })}</span><b>{money(propinaAuto)}</b></div>}
          <div className="total pm-total" style={{ borderTop: '2px solid var(--line-fuerte)', paddingTop: 8 }}><span>{t('pedido.totalPagar')}</span><b>{money(c.propina > 0 ? baseProp : final)}</b></div>
          {c.propina > 0 && <div className="total pm-conpropina"><span>{tOr('pedido.totalConPropina', 'Total a pagar con propina')}</span><b>{money(final)}</b></div>}
          {pagado > 0 && (
            <>
              <div className="total pm-pagado"><span>{t('pedido.pagado')}</span><b>−{money(pagado)}</b></div>
              {c.estado !== 'cerrada' && <div className="total pm-saldo"><span>{t('pedido.saldo')}</span><b>{money(saldo)}</b></div>}
              {(c.pagos || []).map(p => (
                <div key={p.id} className="total pm-abono">
                  <span>{tOr('metodo.' + p.metodo, p.metodo)}{p.concepto ? ` · ${p.concepto}` : ''}{(p.en ?? p.creadaEn) ? ` · ${hora(p.en ?? p.creadaEn)}` : ''}</span>
                  <b>{money(p.monto)} <VerComprobante valor={p.comprobante} /></b>
                </div>
              ))}
            </>
          )}

          {sinTurno && (
            <div className="pm-caja">
              <b>{t('pedido.sinTurno')}</b>
              <div className="barra" style={{ margin: 0, alignItems: 'flex-end' }}>
                <label className="pm-campo">{t('caja.fondoLabel')}
                  <input name="fondo" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" autoFocus value={sinTurno.fondo}
                    onChange={e => setSinTurno({ fondo: limpiarMonto(e.target.value) })} style={{ width: 120 }} />
                </label>
                <button className="success" onClick={abrirTurnoYCobrar}>{t('pedido.abrirTurnoCobrar')}</button>
                <button className="danger" onClick={() => setSinTurno(null)}>{t('comun.cancelar')}</button>
              </div>
            </div>
          )}

          {pagos ? (
            <div className="pm-caja">
              <b style={{ fontSize: '.85rem' }}>{t('pedido.pagosTitulo', { saldo: money(saldo) })}</b>
              <div className="barra" style={{ margin: 0, flexWrap: 'wrap' }}>
                <span className="pm-pista-cobro">{t('pedido.pistaSeleccion')}</span>
                {marcados.length > 0 && (
                  <button type="button" className="teal" style={chico} onClick={() => setPagos(ps => ps.map((x, j) => j === 0 ? { ...x, monto: String(totalSeleccion.toFixed(2)) } : x))}>
                    {t('pedido.ponerSeleccion', { monto: money(totalSeleccion) })}
                  </button>
                )}
              </div>
              {pagos.map((p, i) => (
                <div key={p.id}>
                <div className="barra" style={{ margin: 0 }}>
                  <select name="metodo" value={p.metodo} onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, metodo: e.target.value } : x))}>{METODOS.map(m => <option key={m} value={m}>{tOr('metodo.' + m, m)}</option>)}</select>
                  <input name="monto" type="text" inputMode="decimal" autoComplete="off" value={p.monto} style={{ flex: 1 }}
                    ref={el => { if (el) montoRefs.current[p.id] = el; else delete montoRefs.current[p.id] }}
                    onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, monto: limpiarMonto(e.target.value) } : x))}
                    onBlur={() => setPagos(ps => ps.map((x, j) => j === i && x.monto !== '' ? { ...x, monto: numMonto(x.monto).toFixed(2) } : x))}
                    onFocus={e => e.target.select()} placeholder={t('comun.monto')}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); enterMonto(i, p) } }} />
                  {pagos.length > 1 && <button className="x" onClick={() => setPagos(ps => ps.filter((_, j) => j !== i))}>✕</button>}
                </div>
                {p.metodo === 'qr' && (
                  <div className="barra" style={{ margin: '4px 0 0' }}>
                    <button className="slate" style={chico} onClick={() => setVerQr(true)}>📱 {tOr('pedido.mostrarQr', 'Mostrar QR del negocio')}</button>
                  </div>
                )}
                {p.metodo === 'qr' && <ComprobanteQr valor={p.comprobante} onCambio={v => setPagos(ps => ps.map((x, j) => (j === i ? { ...x, ...v } : x)))} />}
                </div>
              ))}
              <div className="barra">
                <button className="success" style={chico} onClick={agregarPago}>{tOr('pedido.agregarOtroPago', 'Agregar otro pago')}</button>
                <span className="sp" />
                {pendiente > 0 ? <small>{t('pedido.falta', { monto: money(pendiente) })}</small> : <small>{t('pedido.cambio', { monto: money(cambio) })}</small>}
              </div>
              {desgloseMetodos.length > 1 && (
                <div className="pm-desglose" aria-label={tOr('pedido.desgloseTitulo', 'Cobro por método')}>
                  {desgloseMetodos.map(([m, v]) => <span key={m}>{tOr('metodo.' + m, m)}: <b>{money(v)}</b></span>)}
                </div>
              )}
              <div className="barra">
                <button ref={confirmarRef} className="success" disabled={pendiente > 0.009} onClick={confirmarCobro}>{t('pedido.confirmarCobro')}</button>
                {pendiente > 0.009 && sumaPagos > 0 && <button className="warning" onClick={confirmarAbono}>{t('pedido.abonar', { monto: money(sumaPagos) })}</button>}
                <button className="danger" onClick={() => { setPagos(null); setMarcados([]) }}>{t('comun.cancelar')}</button>
                {cambio > 0 && <button className="slate" onClick={imprimirTicketCuenta}>{t('pedido.imprimirTicket')}</button>}
              </div>
            </div>
          ) : !sinTurno && (
            <div className="barra pm-acciones">
              {editable && hayPendientes && <button className="orange" onClick={enviarCocina}>🔥 {t('pedido.enviarCocina')}</button>}
              {puede(rol, 'marcar_listo') && editable && c.items.some(i => i.estado === 'enviado') && (
                <button className="teal" onClick={() => d({ t: 'listo', cuentaId: c.id, lista: true, usuario })}>✔ {tOr('pedido.marcarListo', 'Marcar listo')}</button>
              )}
              {puede(rol, 'marcar_listo') && editable && listo === 'listo' && (
                <button className="slate" onClick={() => d({ t: 'listo', cuentaId: c.id, lista: false, usuario })}>↺ {tOr('pedido.deshacerListo', 'Deshacer listo')}</button>
              )}
              {editable && c.items.length > 0 && <button className="violet" onClick={() => d({ t: 'precuenta', cuentaId: c.id })}>{t('pedido.precuenta')}</button>}
              {!enCobro && c.estado === 'precuenta' && <button className="warning" onClick={() => d({ t: 'reabrir', cuentaId: c.id })}>{t('pedido.reabrir')}</button>}
              {puede(rol, 'cobrar') && c.items.length > 0 && (
                <button className="success" onClick={iniciarCobro}>💵 {t('pedido.cobrar')}</button>
              )}
              {c.items.length > 0 && <button className="slate" onClick={imprimirTicketCuenta}>🖨 {t('pedido.imprimirTicket')}</button>}
              {!enCobro && c.items.some(i => i.estado === 'enviado') && <button className="teal" onClick={reimprimirComanda}>↻ {t('pedido.reimprimirComanda')}</button>}
            </div>
          )}
          <p className="pm-sub" style={{ marginTop: 6 }}>{t('pedido.pagadoEstado', { pagado: money(pagadoCuenta(c)), estado: estadoVisto })}</p>
        </section>
      </div>
      {verQr && (
        <div className="pm-previa-fondo" onClick={() => setVerQr(false)}>
          <div className="pm-previa" role="dialog" aria-label={tOr('pago.qrTitulo', 'QR de pago')} onClick={e => e.stopPropagation()}>
            <PagoQrCard config={s.config} monto={saldo} empresaNombre={s.config?.nombre} onCerrar={() => setVerQr(false)} />
          </div>
        </div>
      )}
      {previa && (
        <div className="pm-previa-fondo" onClick={() => setPrevia(null)}>
          <div className="pm-previa" role="dialog" aria-label={previa.p.nombre} onClick={e => e.stopPropagation()}>
            <div className="pm-cant">
              <b>{previa.p.nombre}</b>
              <span className="pm-cant-ctl">
                <button type="button" className="ghost" aria-label="−" disabled={previa.unidades.length <= 1} onClick={() => cambiarCantidad(-1)}>−</button>
                <output aria-live="polite">{previa.unidades.length}</output>
                <button type="button" className="ghost" aria-label="+" onClick={() => cambiarCantidad(1)}>+</button>
              </span>
            </div>
            {previa.unidades.length > 1 && (
              <div className="pm-unidades" role="tablist">
                {previa.unidades.map((u, i) => (
                  <button key={i} type="button" role="tab" aria-selected={previa.foco === i}
                    className={'tab' + (previa.foco === i ? ' on' : '') + (unidadCompleta(previa.listas, u) ? ' ok' : '')}
                    onClick={() => setPrevia(v => ({ ...v, foco: i }))}>
                    {i + 1}{unidadCompleta(previa.listas, u) ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
            {previa.listas.map(l => {
              const act = previa.unidades[previa.foco].sel[l.id] || []
              return (
                <div key={l.id} className="pm-lista">
                  {!l.legacy && (
                    <small className="pm-lista-tit">
                      {l.nombre}{l.obligatoria ? ' *' : ''}
                      {maxDe(l) !== Infinity && maxDe(l) > 1 ? ` · ${t('indic.hasta', { n: maxDe(l) })}` : ''}
                      {previa.unidades.length > 1 ? ` · ${t('indic.unidadN', { n: previa.foco + 1 })}` : ''}
                    </small>
                  )}
                  <div className="pm-opciones">
                    {l.opciones.map(o => (
                      <button key={o} type="button" className={'tab' + (act.includes(o) ? ' on' : '')} onClick={() => tocarOpcion(l, o)}>{o}{extraDe(l, o) > 0 ? ` +${money(extraDe(l, o))}` : ''}</button>
                    ))}
                  </div>
                </div>
              )
            })}
            <input name="nota-extra" value={previa.unidades[previa.foco].texto} maxLength={60} placeholder={t('pedido.notaExtra')}
              onChange={e => setPrevia(v => ({ ...v, unidades: v.unidades.map((u, i) => (i === v.foco ? { ...u, texto: e.target.value } : u)) }))} />
            {!previaLista && <small className="pm-falta">{t('indic.faltan')}</small>}
            <div className="barra" style={{ margin: 0 }}>
              <button type="button" className="success" disabled={!previaLista} onClick={confirmarPrevia}>{t('indic.agregar', { n: previa.unidades.length })}</button>
              <button type="button" className="danger" onClick={() => setPrevia(null)}>{t('comun.cancelar')}</button>
            </div>
          </div>
        </div>
      )}
    </Ventana>
  )
}
