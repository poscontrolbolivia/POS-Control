import { useEffect, useRef, useState } from 'react'
import { useStore, cuentaActiva, cuentasDeMesa, totalCuenta, totalFinal, pagadoCuenta, saldoCuenta, ordenDelDia, nuevoId, pasoPedido } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { useMoneda } from '../../../services/money.js'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { imprimirCuenta, imprimirComandas } from '../../printing/Ticket.jsx'
import { nombreDeArea } from '../../../services/printing.js'
import { agotadosHoy, conMarca } from '../../../services/soldOut.js'
import { VerComprobante } from '../pago/ComprobanteQr.jsx'
import CobroForm, { imputarPagos, cobroNuevo } from '../pago/CobroForm.jsx'
import '../pago/ComprobanteQr.css'
import { listasDe, notaDeUnidad, indicacionesDeUnidad, componerNota, comentarioDe, MAX_NOTA, extraDeUnidad, selDeUnidad } from '../../../services/indicaciones.js'
import IndicacionesPrevio from './IndicacionesPrevio.jsx'
import { ruedaHorizontal } from '../../../services/ruedaHorizontal.js'
import './OrderPanel.css'
import { round2, hora, limpiarMonto, numMonto } from '../../../services/format.js'

const cap = x => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '')

const PASOS = ['prep', 'parcial', 'listo', 'cuenta', 'pagada']
const PASOS_TXT = { prep: 'Prep', parcial: 'Parcial', listo: 'Listo', cuenta: 'Cuenta', pagada: 'Pagada' }
const TODOS = 'todas'

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
export default function OrderPanel({ rol, sesion, mesa, cuenta, cuentaInicial, onClose, bloqueado, cobro, onEdicion }) {
  const { s, d } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const enCobro = Boolean(cobro)
  const usuario = sesion?.usuario || sesion?.nombre || rol
  const secciones = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  // «Todos» abre la carta: sin buscador ni filtro, el mesero encontraba el producto sección por sección.
  const [sec, setSec] = useState(TODOS)
  const [busca, setBusca] = useState('')

  const secActiva = sec === TODOS || secciones.some(x => x.id === sec) ? sec : TODOS
  // La barra de la carta se queda donde el mesero la dejó; al filtrar eso deja los platos nuevos fuera por
  // la izquierda, así que cada cambio de grupo o de búsqueda la vuelve a arrancar.
  const tira = useRef(null)
  useEffect(() => { if (tira.current) tira.current.scrollLeft = 0 }, [secActiva, busca])
  const [marcados, setMarcados] = useState([])
  const [destino, setDestino] = useState('')
  const [canje, setCanje] = useState('')
  const [partes, setPartes] = useState({})
  const [apertura, setApertura] = useState(null)
  // Apertura directa: al tocar una mesa libre se abre la cuenta (1 comensal) y los comensales se cambian dentro.
  const autoMesa = useRef(null)
  const [uniendo, setUniendo] = useState(false)
  const [aUnir, setAUnir] = useState([])
  const [aUnirCtas, setAUnirCtas] = useState([])
  const [desc, setDesc] = useState(null)
  const [prop, setProp] = useState(null)
  const [confirmar, setConfirmar] = useState(null)
  const [destZona, setDestZona] = useState('')
  const [pagos, setPagos] = useState(null)
  const [sinTurno, setSinTurno] = useState(null)
  const [borrando, setBorrando] = useState(null)
  const [nota, setNota] = useState(null)
  const [aviso, setAviso] = useState('')
  // Caja puede abrir la mesa ya posicionada en una subcuenta (2b), no siempre en la primera.
  const [cuentaSelId, setCuentaSelId] = useState(cuentaInicial ?? null)
  const [menu, setMenu] = useState(false)
  const [modo, setModo] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [cliente, setCliente] = useState({ nombre: '', tel: '' })
  const avisoTimer = useRef(null)
  useEffect(() => { if (cuentaInicial) setCuentaSelId(cuentaInicial) }, [cuentaInicial])
  // Refs de los campos «Monto» por id de línea de pago: con índices, borrar una línea
  // descoloca el foco; con id siempre apuntamos al input correcto.
  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])
  useEffect(() => { setCuentaSelId(null); setModo(null); setMenu(false); setPrevia(null) }, [mesa?.id])
  // Para llevar: el panel se abre con la prop `cuenta` (mesa es undefined), así que el
  // prerrecargado del cliente mira `cuenta?.id`, no `mesa?.id`.
  useEffect(() => { setCliente({ nombre: cuenta?.clienteNombre || '', tel: cuenta?.clienteTel || '' }) }, [cuenta?.id])
  const hermanas = mesa ? cuentasDeMesa(s, mesa.id) : []
  const c = cuenta ?? hermanas.find(x => x.id === cuentaSelId) ?? hermanas[0]
  const sufijo = c?.tipo === 'mesa' && hermanas.length > 1 && c.etiqueta ? c.etiqueta : ''
  const titulo = c?.canal === 'llevar' ? tOr('pedido.llevarCabecera', `Pedido ${c.numero ?? ''}`, { n: c.numero }) + (c.clienteNombre ? ' · ' + c.clienteNombre : '') : c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : ((mesa?.nombre ?? t('pedido.cuenta')) + sufijo)
  const reset = () => { setMarcados([]); setDestino(''); setCanje(''); setPagos(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setAUnirCtas([]); setPartes({}); setApertura(null); setSinTurno(null); setBorrando(null); setNota(null); setModo(null); setMenu(false); setPrevia(null); setConfirmar(null); setDestZona('') }
  const cerrar = () => {
    // Cualquier cuenta de mesa que quede en blanco se descarta al salir, la abrieron un toque de más
    // o sobró de una división: una mesa «activa» sin platos no sirve para nada y ensucia Caja.
    if (mesaVacia) d({ t: 'abrir-descartar', cuentaId: c.id })
    reset(); onClose()
  }
  useEffect(() => {
    if (!mesa) { autoMesa.current = null; return }
    // En modo cobro Caja solo mira: tocar una mesa libre no abre una cuenta vacía.
    if (cobro) return
    if (bloqueado || !puede(rol, 'abrir_mesa') || autoMesa.current === mesa.id) return
    autoMesa.current = mesa.id
    if (cuentasDeMesa(s, mesa.id).length) return
    d({ t: 'abrir', mesaId: mesa.id, comensales: 1, usuario })
  }, [mesa?.id, bloqueado, cobro])
  const toggle = id => { setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setCanje(''); setPartes({}) }
  const nombreMesa = id => s.mesas.find(m => m.id === id)?.nombre ?? t('pedido.mesaCorta')

  const pctProp = Number(s.config?.propinaPct) || 0
  const propinaIncluida = Boolean(s.config?.propinaIncluida) && pctProp > 0
  const manualProp = useRef(new Set())
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
  // Mesa en blanco: abierta de un toque por error o sobrante de una división. Sin ítems NI anulados,
  // que es justo lo que el servidor acepta para borrar (descartar_cuenta_vacia).
  const mesaVacia = !enCobro && editable && c.tipo === 'mesa' && c.estado === 'abierta' && !(c.items || []).length && !(c.pagos || []).length
  // Cuenta en blanco (mesa o pedido para llevar): se puede cerrar con un toque desde las acciones.
  const cuentaVacia = c.estado === 'abierta' && (c.tipo === 'mesa' || c.canal === 'llevar') && !(c.items || []).length && !(c.pagos || []).length
  const cerrarVacia = () => { d({ t: 'abrir-descartar', cuentaId: c.id }); reset(); onClose() }
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
  const zonaDe = mesaId => s.mesas.find(m => m.id === mesaId)?.zona ?? ''
  const destinosTodos = [
    ...s.cuentas.filter(x => x.id !== c.id && x.estado !== 'cerrada' && x.tipo === 'mesa')
      .sort((x, y) => nombreDeCuenta(x).localeCompare(nombreDeCuenta(y), undefined, { numeric: true }))
      .map(x => ({ key: 'c:' + x.id, nombre: nombreDeCuenta(x), zona: zonaDe(x.mesaIds[0]), label: `${nombreDeCuenta(x)} · ${money(totalCuenta(x))}`, cuenta: x })),
    ...s.mesas.filter(m => !s.cuentas.some(x => x.estado !== 'cerrada' && x.mesaIds.includes(m.id)))
      .sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), undefined, { numeric: true }))
      .map(m => ({ key: 'm:' + m.id, nombre: m.nombre, zona: m.zona ?? '', label: `${m.nombre} · ${t('pedido.libre')}`, mesaId: m.id })),
  ]
  // Primero se elige el salón y después la mesa de ese salón: con 100 mesas una sola lista no se podía usar.
  const salonesDest = [...(s.zonas || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const haySinSalon = destinosTodos.some(x => !x.zona || !salonesDest.some(z => z.id === x.zona))
  const zonaPropia = mesa ? zonaDe(mesa.id) : ''
  const zonaElegida = destZona !== '' ? destZona : (salonesDest.some(z => z.id === zonaPropia) ? zonaPropia : (salonesDest[0]?.id ?? '__sin'))
  const destinos = destinosTodos.filter(x => (zonaElegida === '__sin' ? (!x.zona || !salonesDest.some(z => z.id === x.zona)) : x.zona === zonaElegida))
  const destinoSel = destinos.find(x => x.key === destino)
  const cuentaDestino = destinoSel?.cuenta || null
  const itemsDestino = (cuentaDestino?.items || []).filter(i => i.estado !== 'anulado')
  // Cuántas unidades se llevan de cada plato marcado: se ajusta con el − / + de la propia fila,
  // no con un campo aparte. Sin marcar nada, cantDe no se usa; con 1 marcado y qty 1 mueve el entero.
  const cantDe = i => Math.min(Math.max(1, Number(partes[i.id]) || i.qty), i.qty)
  const marcadosVivos = marcados.map(id => vivos.find(i => i.id === id)).filter(Boolean)
  const parciales = marcadosVivos.filter(i => cantDe(i) < i.qty)
  const enteros = marcadosVivos.filter(i => cantDe(i) >= i.qty)
  const nMovidas = marcadosVivos.reduce((t2, i) => t2 + cantDe(i), 0)
  const mover = () => {
    if (!destinoSel || !marcados.length) return
    const destino = destinoSel.cuenta ? { cuentaDestinoId: destinoSel.cuenta.id } : { mesaDestino: destinoSel.mesaId }
    // Primero las partidas (nacen como fila nueva en el destino) y después los platos completos.
    parciales.forEach(i => d({ t: 'mover-parcial', cuentaId: c.id, itemId: i.id, cantidad: cantDe(i), ...destino, usuario }))
    if (enteros.length) d({ t: 'mover', cuentaId: c.id, itemIds: enteros.map(i => i.id), ...destino, usuario })
    setMarcados([]); setDestino(''); setCanje(''); setPartes({}); setModo(null)
    const detalle = parciales.map(i => `${cantDe(i)}/${i.qty} ${i.nombre}`).join(', ')
    avisar(parciales.length
      ? tOr('pedido.movidoParcialOk', 'Movido: {detalle} a {mesa}', { detalle, mesa: destinoSel.nombre })
      : t('pedido.movidoOk', { mesa: destinoSel.nombre }))
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
  const iPaso = PASOS.indexOf(listo)
  // El menú de cobro es el mismo de Venta directa. Con platos marcados se cobra solo esa parte (abono).
  const baseCobro = marcados.length ? Math.min(saldo, totalSeleccion) : saldo
  const iniciarCobro = () => {
    if (!s.caja?.turno) { setSinTurno({ fondo: '' }); return }
    setMarcados([])
    setPagos(cobroNuevo({ comanda: false }))
  }
  const abrirTurnoYCobrar = () => {
    const f = numMonto(sinTurno.fondo)
    d({ t: 'turno+', fondo: round2(f), usuario })
    setSinTurno(null)
    setMarcados([])
    setPagos(cobroNuevo({ comanda: false }))
  }
  // Una sola línea sin monto = el total exacto (el campo lo muestra de ejemplo).
  const lineasDeCobro = base => {
    const ls = pagos.lineas
    return ls.length === 1 && !numMonto(ls[0].monto) ? [{ ...ls[0], monto: String(base.toFixed(2)) }] : ls
  }
  const confirmarCobro = () => {
    if (pagos.lineas.some(l => l.subiendo)) return avisar(t('comp.subiendo'))
    const base = round2(baseCobro)
    const { pagos: pg, saldo: falta } = imputarPagos(lineasDeCobro(base), base)
    if (falta > 0.009) return avisar(t('pedido.faltaParaCobrar', { faltan: money(falta), total: money(base) }))
    if (!pg.length) return avisar(t('pedido.sinPagos'))
    const concepto = marcados.length ? { concepto: conceptoSeleccion } : {}
    if (base < round2(saldo) - 0.009) {
      d({ t: 'abonar', cuentaId: c.id, pagos: pg, ...concepto, usuario })
      setPagos(null); setMarcados([])
      avisar(t('pedido.abonadoOk', { monto: money(base), saldo: money(round2(saldo - base)) }))
      return
    }
    d({ t: 'cobrar', cuentaId: c.id, pagos: pg, ...concepto, propina: c.propina || 0, descuento: c.descuento || 0, usuario })
    if (pagos.imprimir) {
      const cerrada = { ...c, estado: 'cerrada', pagos: [...(c.pagos || []), ...pg], cerradaEn: Date.now() }
      const datos = datosImpresion()
      // Diferido: el diálogo de impresión de Windows congela el hilo y no debe frenar el cobro.
      setTimeout(() => { imprimirCuenta({ cuenta: cerrada, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }), datos }).catch(() => { }) }, 0)
    }
    cerrar()
  }
  // Abono libre: se recibió menos que el saldo y no hay platos marcados.
  const abonoLibre = () => {
    if (pagos.lineas.some(l => l.subiendo)) return avisar(t('comp.subiendo'))
    const { pagos: pg, saldo: falta } = imputarPagos(pagos.lineas, round2(saldo))
    if (!pg.length) return avisar(t('pedido.sinPagos'))
    if (falta <= 0.009) return avisar(t('pedido.abonoCubreTodo'))
    const recibido = round2(pg.reduce((a, x) => a + x.monto, 0))
    d({ t: 'abonar', cuentaId: c.id, pagos: pg, usuario })
    setPagos(null); setMarcados([])
    avisar(t('pedido.abonadoOk', { monto: money(recibido), saldo: money(round2(saldo - recibido)) }))
  }
  const sumaRecibida = pagos ? round2(pagos.lineas.reduce((a, l) => a + numMonto(l.monto), 0)) : 0

  const datosImpresion = () => ({ salon: (s.zonas || []).find(z => z.id === mesa?.zona)?.nombre, mesa: titulo, orden: ordenDelDia(s.cuentas, c) })

  // «Sacar cuenta» = dejar la mesa en pre-cuenta (por cobrar) E imprimir el ticket del cliente, en un solo toque.
  const sacarCuenta = async () => {
    if (!c.items.length) return avisar(t('pedido.cuentaVacia'))
    if (c.estado === 'abierta') d({ t: 'precuenta', cuentaId: c.id })
    await imprimirTicketCuenta()
  }
  const imprimirTicketCuenta = async () => {
    if (!c.items.length) return avisar(t('pedido.cuentaVacia'))
    const r = await imprimirCuenta({
      cuenta: c, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }),
      datos: datosImpresion(),
    })
    if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
    else if (r === 'sin-impresora') avisar(t('pedido.avisoSinImpresoraTicket'))
    else if (r === 'encolado') avisar(t('pedido.ticketEnviadoEstacion'))
    // Sin este aviso el ticket silencioso salía y la pantalla no decía nada: parecía que el botón no hacía nada.
    else if (r === 'silencioso') avisar(tOr('pedido.ticketImpreso', 'Ticket impreso en la impresora del grupo de cuentas.'))
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
    const salida = await imprimirComandas({ cuenta: c, items: pend, productos: s.productos, config: s.config, titulo: t('pedido.comandaTitulo', { titulo }), datos: datosImpresion() })
    avisar(`${t('pedido.enviadoOk')}: ${resumenEnvio(salida)}`)
  }
  const reimprimirComanda = async () => {
    const env = c.items.filter(i => i.estado === 'enviado')
    if (!env.length) return avisar(t('pedido.nadaQueReimprimir'))
    const salida = await imprimirComandas({ cuenta: c, items: env, productos: s.productos, config: s.config, titulo: t('pedido.comandaTitulo', { titulo }), datos: datosImpresion() })
    avisar(resumenEnvio(salida))
  }

  const chico = { minHeight: 32, padding: '2px 10px' }
  const abrirModo = m => { setModo(m); setMenu(false); setMarcados([]); setDestino(''); setCanje(''); setPartes({}); setBorrando(null) }
  const dividir = () => { setMenu(false); d({ t: 'dividir', cuentaId: c.id, usuario }); setModo('mover'); avisar(t('pedido.divididaOk')) }
  // 2A y 2B comparten la misma mesa, así que unir_mesas (que trabaja por mesa) no las ve: se unen por cuenta.
  const hermanasOtras = s.cuentas.filter(x => x.id !== c.id && x.estado !== 'cerrada' && x.mesaIds.some(m => c.mesaIds.includes(m)))
  const cerrarUnir = () => { setUniendo(false); setAUnir([]); setAUnirCtas([]) }
  const unirAhora = () => {
    if (aUnirCtas.length) d({ t: 'unir-sub', cuentaId: c.id, cuentaIds: aUnirCtas, usuario })
    if (aUnir.length) d({ t: 'unir', cuentaId: c.id, mesaIds: aUnir })
    cerrarUnir()
  }
  const puedeDividir = !enCobro && editable && puedeUnir && c.tipo === 'mesa' && hermanas.length < 8
  const quitarSinEnviar = () => {
    c.items.filter(i => i.estado === 'pendiente').forEach(i => d({ t: 'anular', cuentaId: c.id, itemId: i.id, motivo: 'pendiente' }))
    setMarcados([]); setConfirmar(null)
  }
  const reenviarComanda = async () => { setConfirmar(null); await reimprimirComanda() }
  const hayMenu = editable && (vivos.length > 0 || (puedeUnir && c.tipo === 'mesa') || puedeDividir)
  const tituloMenu = c.tipo === 'mesa' ? tOr('pedido.opcionesMesa', 'Opciones de mesa') : tOr('pedido.opcionesPedido', 'Opciones del pedido')

  const agotados = agotadosHoy(s.config)
  const puedeMenu = puede(rol, 'gestionar_menu')

  const agregarProd = p => {
    if (agotados[p.id]) return avisar(t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }))
    const listas = listasDe(s.config, p)
    return listas.length ? setPrevia({ p, listas }) : d({ t: 'item+', cuentaId: c.id, p })
  }

  const quitarAgotado = id => d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, id, null) } })
  const q = busca.trim().toLowerCase()
  const enCarta = s.productos.filter(p => p.activo
    && (q ? (p.nombre || '').toLowerCase().includes(q) : secActiva === TODOS || p.seccionId === secActiva))
  const agotadosEnSeccion = enCarta.filter(p => agotados[p.id])
  // Una unidad = un ítem con su nota; las iguales se juntan solas («2× Carne — Medio»).
  const confirmarPrevia = unidades => {
    const { p, listas } = previa
    unidades.forEach(u => {
      const nota = notaDeUnidad(listas, u)
      const indicaciones = indicacionesDeUnidad(listas, u)
      const extra = extraDeUnidad(listas, u)
      const sel = selDeUnidad(listas, u)
      d({ t: 'item+', cuentaId: c.id, p, ...(nota ? { nota } : {}), ...(indicaciones ? { indicaciones } : {}), ...(extra ? { extra } : {}), ...(sel.length ? { sel } : {}) })
    })
    setPrevia(null)
  }
  const hayPendientes = c.items.some(i => i.estado === 'pendiente')

  return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <div className="fila pm-cab">
        <h3 className="pm-titulo">{titulo}</h3>
        <span className={'tag ' + c.estado}>{estadoVisto}</span>
        {/* Las acciones van juntas a la derecha y los pasos en su propia línea: así ningún botón
            «se come» el recuadro cuando el nombre de la mesa es largo. */}
        {(enCobro && puede(rol, 'abrir_mesa') || hayMenu) && (
          <span className="pm-cab-acc">
            {enCobro && puede(rol, 'abrir_mesa') && (
              <button type="button" className="ghost pm-cobro-editar" onClick={onEdicion} title={tOr('caja.editarMesaTitle', 'Ver la mesa como mesero: tomar pedido, mover o eliminar ítems')}>✎ {tOr('caja.editarMesa', 'Editar mesa')}</button>
            )}
            {hayMenu && (
              <div className="pm-mas">
                <button type="button" className="pm-mas-btn" aria-haspopup="menu" aria-expanded={menu} title={tituloMenu} aria-label={tituloMenu} onClick={() => setMenu(v => !v)}>⋯ <span className="pm-mas-txt">{tituloMenu}</span></button>
                {menu && (
                  <>
                    <div className="pm-mas-fondo" onClick={() => setMenu(false)} />
                    <ul className="pm-mas-menu" role="menu">
                      {puedeDividir && <li><button type="button" role="menuitem" onClick={dividir}>✂ {tOr('pedido.menuDividir', 'Dividir mesa')}</button></li>}
                      {puede(rol, 'marcar_listo') && c.items.some(i => i.estado === 'enviado') && <li><button type="button" role="menuitem" onClick={() => { setMenu(false); d({ t: 'listo', cuentaId: c.id, lista: true, usuario }) }}>✔ {tOr('pedido.marcarListo', 'Marcar listo')}</button></li>}
                      {puede(rol, 'marcar_listo') && listo === 'listo' && <li><button type="button" role="menuitem" onClick={() => { setMenu(false); d({ t: 'listo', cuentaId: c.id, lista: false, usuario }) }}>↺ {tOr('pedido.deshacerListo', 'Deshacer listo')}</button></li>}
                      {vivos.length > 0 && <li><button type="button" className="peligro" role="menuitem" onClick={() => abrirModo('eliminar')}>🗑 {t('pedido.menuEliminar')}</button></li>}
                      {puedeMover && vivos.length > 0 && <li><button type="button" role="menuitem" onClick={() => abrirModo('mover')}>↔ {t('pedido.menuMover')}</button></li>}
                      {puedeUnir && c.tipo === 'mesa' && (c.mesaIds.length < s.mesas.length || hermanasOtras.length > 0) && <li><button type="button" role="menuitem" onClick={() => { setMenu(false); setAUnir([]); setAUnirCtas([]); setUniendo(true) }}>🔗 {t('pedido.menuUnir')}</button></li>}
                      {puedeUnir && c.mesaIds.length > 1 && c.mesaIds.map(id => (
                        <li key={id}><button type="button" role="menuitem" onClick={() => { setMenu(false); d({ t: 'separar', cuentaId: c.id, mesaId: id, usuario }) }}>⛓ {t('pedido.menuSeparar', { mesa: nombreMesa(id) })}</button></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </span>
        )}
        <ol className="pm-pasos" aria-label={tOr('pedido.pasosTitulo', 'Estado del pedido')}>
          {PASOS.map((p, k) => (
            <li key={p} data-paso={p} aria-current={k === iPaso ? 'step' : undefined}
              className={'pm-paso ' + (k < iPaso ? 'hecho' : k === iPaso ? 'actual' : 'futuro')}>
              <i aria-hidden="true">{k < iPaso ? '✓' : k + 1}</i>
              <span>{tOr('paso.' + p, PASOS_TXT[p])}</span>
            </li>
          ))}
        </ol>
      </div>
      {!cuenta && hermanas.length > 1 && (
        <div className="barra pm-subcuentas" role="tablist">
          {hermanas.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === c.id} className={'tab' + (x.id === c.id ? ' on' : '')} onClick={() => { setCuentaSelId(x.id); setMarcados([]); setDestino(''); setPartes({}) }}>
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
          {hermanasOtras.length > 0 && (
            <>
              <b className="pm-unir-grupo">{tOr('pedido.unirHermanas', 'Otras cuentas de esta mesa')}</b>
              <div className="pm-unir-opts">
                {hermanasOtras.map(x => (
                  <label key={x.id} className={'pm-opcion' + (aUnirCtas.includes(x.id) ? ' on' : '')}>
                    <input name="unir-cuenta" type="checkbox" checked={aUnirCtas.includes(x.id)} style={{ width: 16, height: 16 }}
                      onChange={() => setAUnirCtas(a => a.includes(x.id) ? a.filter(y => y !== x.id) : [...a, x.id])} />
                    {nombreDeCuenta(x)} · {money(totalCuenta(x))}
                  </label>
                ))}
              </div>
            </>
          )}
          <b className="pm-unir-grupo">{tOr('pedido.unirOtras', 'Otras mesas')}</b>
          <div className="pm-unir-opts">
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
            <button className="violet" disabled={!aUnir.length && !aUnirCtas.length} onClick={unirAhora}>{t('pedido.unirN', { n: aUnir.length + aUnirCtas.length })}</button>
            <button className="danger" onClick={cerrarUnir}>{t('comun.cancelar')}</button>
          </div>
        </div>
      )}

      <div className={'pm-cols' + (editable && !modo ? ' dos' : '')}>
        {editable && !modo && (
          <section className="pm-carta">
            <div className="pm-busca-fila">
              <input name="buscar-producto" type="search" inputMode="search" autoComplete="off" value={busca}
                aria-label={tOr('pedido.buscarProducto', 'Buscar producto')} placeholder={tOr('pedido.buscarProducto', 'Buscar producto…')}
                onChange={e => setBusca(e.target.value)} />
              {busca && <button type="button" className="ghost pm-busca-x" onClick={() => setBusca('')} aria-label={t('comun.cancelar')}>✕</button>}
            </div>
            {/* Los grupos corren hacia los lados: con diez secciones la carta quedaba empujada fuera de la pantalla. */}
            <div className="barra pm-tabs" role="tablist" ref={ruedaHorizontal}>
              <button type="button" role="tab" aria-selected={secActiva === TODOS} className={secActiva === TODOS ? 'tab on' : 'tab'} onClick={() => { setSec(TODOS); setBusca('') }}>{tOr('pedido.todas', 'Todos')}</button>
              {secciones.map(x => <button key={x.id} type="button" role="tab" aria-selected={x.id === secActiva} className={x.id === secActiva ? 'tab on' : 'tab'} onClick={() => { setSec(x.id); setBusca('') }}>{x.nombre}</button>)}
            </div>
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
            {/* La carta entra por una tira que se desliza hacia la izquierda con su barra, como en el
                mostrador: con «Todos» hay decenas de platos y un recuadro dejaba el resto sin alcanzar. */}
            {!!enCarta.length && <div className="grid pm-productos" ref={el => { tira.current = el; ruedaHorizontal(el) }}>
              {enCarta.map(p => (
                <button key={p.id} className={'prod' + (agotados[p.id] ? ' agotado' : '')} onClick={() => agregarProd(p)}
                  title={agotados[p.id] ? t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }) : undefined}>
                  <Thumb producto={p} />
                  <span className="pm-prod-nombre">{p.nombre}</span><small>{money(p.precio)}</small>
                  {agotados[p.id] && <small className="prod-agotado">{t('agotado.badge')}</small>}
                </button>
              ))}
            </div>}
            {!enCarta.length && <p className="pm-sin-busca">{tOr('pedido.sinProducto', 'Ningún producto coincide con la búsqueda.')}</p>}
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
                {modo === 'mover' && marcados.includes(i.id) && i.qty > 1 ? (
                  <span className="qty qty-partir" title={tOr('pedido.moverCantidad', 'Unidades a mover')}>
                    <button type="button" aria-label={tOr('comun.menos', 'Menos')} disabled={cantDe(i) <= 1} onClick={() => setPartes(p => ({ ...p, [i.id]: cantDe(i) - 1 }))}>−</button>
                    <b>{cantDe(i)}<small>/{i.qty}</small></b>
                    <button type="button" aria-label={tOr('comun.mas', 'Más')} disabled={cantDe(i) >= i.qty} onClick={() => setPartes(p => ({ ...p, [i.id]: cantDe(i) + 1 }))}>+</button>
                  </span>
                ) : editable && i.estado === 'pendiente' ? (
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
              {(salonesDest.length > 1 || haySinSalon) && (
                <label className="pm-campo">{tOr('pedido.destinoSalon', 'Salón')}
                  <select name="destino-salon" value={zonaElegida} onChange={e => { setDestZona(e.target.value); setDestino(''); setCanje('') }}>
                    {salonesDest.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
                    {haySinSalon && <option value="__sin">{t('salon.sinZona')}</option>}
                  </select>
                </label>
              )}
              <label className="pm-campo">{tOr('pedido.destinoMesa', 'Mesa')}
                <select name="destino" value={destino} onChange={e => { setDestino(e.target.value); setCanje('') }}>
                  <option value="">{t('pedido.elegirMesa')}</option>
                  {destinos.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </label>
              <p className="pm-mover-ayuda">{tOr('pedido.moverPiezasAyuda', 'Toca el − / + del propio plato para elegir cuántas piezas se van a la otra mesa.')}</p>
              <div className="barra" style={{ margin: 0 }}>
                <button className="primary" disabled={!destino || !marcados.length} onClick={mover}>{t('pedido.moverN', { n: nMovidas })}</button>
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

          {c.detalle && <p className="pm-sub">📝 {c.detalle}</p>}

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
              {seleccion.length === 0 && <small className="pm-pista-cobro">{t('pedido.pistaSeleccion')}</small>}
              {seleccion.length > 0 && <small className="pm-pista-cobro">{conceptoSeleccion}</small>}
              <CobroForm cobro={pagos} onChange={setPagos} total={round2(baseCobro)} config={s.config} />
              <div className="barra pm-acciones">
                <button className="success" onClick={confirmarCobro}>{t('pedido.confirmarCobro')}</button>
                {!marcados.length && sumaRecibida > 0.009 && sumaRecibida < round2(saldo) - 0.009 && <button className="warning" onClick={abonoLibre}>{t('pedido.abonar', { monto: money(sumaRecibida) })}</button>}
                <button className="danger" onClick={() => { setPagos(null); setMarcados([]) }}>{t('comun.cancelar')}</button>
              </div>
            </div>
          ) : !sinTurno && (
            <>
              {confirmar && (
                <div className="pm-caja pm-confirmar" role="alertdialog">
                  <b>{confirmar === 'reenviar'
                    ? tOr('pedido.confirmarReenviar', '¿Seguro que quiere reenviar la comanda a despacho?')
                    : tOr('pedido.confirmarQuitarSinEnviar', '¿Seguro que quiere quitar los productos sin enviar?')}</b>
                  {confirmar === 'reenviar' && <small>{tOr('pedido.confirmarReenviarAyuda', 'Se usa si la impresora falló y la comanda no salió: se imprime otra vez.')}</small>}
                  <div className="barra pm-acciones">
                    <button className={confirmar === 'reenviar' ? 'info' : 'danger solid'} onClick={confirmar === 'reenviar' ? reenviarComanda : quitarSinEnviar}>{t('comun.confirmar')}</button>
                    <button className="ghost" onClick={() => setConfirmar(null)}>{t('comun.cancelar')}</button>
                  </div>
                </div>
              )}
              {!confirmar && (
                <div className="barra pm-acciones">
                  {/* 1 · cuenta en blanco */}
                  {cuentaVacia && <button className="danger solid" onClick={cerrarVacia}>✕ {c.tipo === 'mesa' ? tOr('pedido.cerrarVacia', 'Cerrar mesa vacía') : tOr('pedido.cerrarPedidoVacio', 'Cerrar pedido vacío')}</button>}
                  {/* 2 · con productos sin enviar */}
                  {c.estado === 'abierta' && hayPendientes && <button className="orange" onClick={enviarCocina}>🔥 {tOr('pedido.enviarDespacho', 'Enviar a despacho')}</button>}
                  {c.estado === 'abierta' && hayPendientes && <button className="danger" onClick={() => setConfirmar('quitar')}>🗑 {tOr('pedido.quitarSinEnviar', 'Quitar productos sin enviar')}</button>}
                  {/* 3 · todo enviado a despacho */}
                  {c.estado === 'abierta' && !hayPendientes && vivos.length > 0 && <button className="violet" onClick={sacarCuenta}>🧾 {tOr('pedido.sacarCuenta', 'Sacar cuenta')}</button>}
                  {c.estado === 'abierta' && !hayPendientes && c.items.some(i => i.estado === 'enviado') && <button className="info" onClick={() => setConfirmar('reenviar')}>↻ {tOr('pedido.reenviarComanda', 'Reenviar comanda a despacho')}</button>}
                  {/* 4 · cuenta ya sacada */}
                  {c.estado === 'precuenta' && puede(rol, 'cobrar') && <button className="success" onClick={iniciarCobro}>💵 {t('pedido.cobrar')}</button>}
                  {c.estado === 'precuenta' && <button className="slate" onClick={imprimirTicketCuenta}>🖨 {tOr('pedido.reimprimirCuenta', 'Reimprimir cuenta')}</button>}
                  {c.estado === 'precuenta' && <button className="warning" onClick={() => d({ t: 'reabrir', cuentaId: c.id })}>↺ {c.tipo === 'mesa' ? tOr('pedido.reabrirMesa', 'Reabrir mesa') : tOr('pedido.reabrirPedido', 'Reabrir pedido')}</button>}
                </div>
              )}
            </>
          )}
          <p className="pm-sub" style={{ marginTop: 6 }}>{t('pedido.pagadoEstado', { pagado: money(pagadoCuenta(c)), estado: estadoVisto })}</p>
        </section>
      </div>
      {previa && (
        <IndicacionesPrevio producto={previa.p} listas={previa.listas}
          onClose={() => setPrevia(null)} onConfirm={confirmarPrevia} />
      )}
    </Ventana>
  )
}
