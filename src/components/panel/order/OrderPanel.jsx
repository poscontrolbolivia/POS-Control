import { useEffect, useRef, useState } from 'react'
import { useStore, cuentaActiva, cuentasDeMesa, totalCuenta, totalFinal, pagadoCuenta } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { useMoneda } from '../../../services/money.js'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { imprimirCuenta, imprimirComandas } from '../../printing/Ticket.jsx'
import { nombreDeArea } from '../../../services/printing.js'
import { agotadosHoy, conMarca } from '../../../services/soldOut.js'
import './OrderPanel.css'

const cap = x => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '')

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
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cerrarRef.current?.focus()
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="modal-fondo pedido-fondo">
      <div className="modal-caja pedido-modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <button ref={cerrarRef} type="button" className="pm-atras" onClick={onClose} title={t('pedido.atrasTitulo')}>← {t('pedido.atras')}</button>
        {children}
      </div>
    </div>
  )
}

export default function OrderPanel({ rol, sesion, mesa, cuenta, onClose, bloqueado }) {
  const { s, d } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol
  const secciones = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const [sec, setSec] = useState(secciones[0]?.id)

  const secActiva = secciones.some(x => x.id === sec) ? sec : secciones[0]?.id
  const [marcados, setMarcados] = useState([])
  const [destino, setDestino] = useState('')
  const [canje, setCanje] = useState('')
  const [apertura, setApertura] = useState(null)
  const [uniendo, setUniendo] = useState(false)
  const [aUnir, setAUnir] = useState([])
  const [desc, setDesc] = useState(null)
  const [prop, setProp] = useState(null)
  const [pagos, setPagos] = useState(null)
  const [sinTurno, setSinTurno] = useState(null)
  const [borrando, setBorrando] = useState(null)
  const [nota, setNota] = useState(null)
  const [aviso, setAviso] = useState('')
  const [cuentaSelId, setCuentaSelId] = useState(null)
  const [menu, setMenu] = useState(false)
  const [modo, setModo] = useState(null)
  const [previa, setPrevia] = useState(null)
  const avisoTimer = useRef(null)
  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])
  useEffect(() => { setCuentaSelId(null); setModo(null); setMenu(false); setPrevia(null) }, [mesa?.id])

  const hermanas = mesa ? cuentasDeMesa(s, mesa.id) : []
  const c = cuenta ?? hermanas.find(x => x.id === cuentaSelId) ?? hermanas[0]
  const sufijo = c?.tipo === 'mesa' && hermanas.length > 1 && c.etiqueta ? c.etiqueta : ''
  const titulo = c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : ((mesa?.nombre ?? t('pedido.cuenta')) + sufijo)
  const reset = () => { setMarcados([]); setDestino(''); setCanje(''); setPagos(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setApertura(null); setSinTurno(null); setBorrando(null); setNota(null); setModo(null); setMenu(false); setPrevia(null) }
  const cerrar = () => { reset(); onClose() }
  const toggle = id => { setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setCanje('') }
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
  }, [c?.id, c?.estado, c?.propina, propinaAuto, propinaIncluida]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mesa && !cuenta) return null
  if (bloqueado) return null

  if (!c) return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <h3 className="pm-titulo">{titulo}</h3>
      <p>{t('pedido.mesaLibre', { cap: mesa?.cap })}</p>
      {puede(rol, 'abrir_mesa') && (apertura ? (
        <div className="pm-apertura">
          <span className="pm-pax">{t('pedido.comensales')}
            <button type="button" className="x" aria-label="−" disabled={(Number(apertura.comensales) || 1) <= 1}
              onClick={() => setApertura({ ...apertura, comensales: Math.max(1, (Number(apertura.comensales) || 1) - 1) })}>−</button>
            <input type="number" min="1" max="99" inputMode="numeric" value={apertura.comensales} autoFocus onFocus={e => e.target.select()}
              onChange={e => setApertura({ ...apertura, comensales: e.target.value })} />
            <button type="button" className="x" aria-label="+" disabled={(Number(apertura.comensales) || 1) >= 99}
              onClick={() => setApertura({ ...apertura, comensales: Math.min(99, (Number(apertura.comensales) || 1) + 1) })}>+</button>
          </span>
          <span className="pm-abrio">👤 {t('pedido.abriraComo', { usuario })}</span>
          <div className="pm-apertura-acc">
            <button className="success" onClick={() => {
              d({ t: 'abrir', mesaId: mesa.id, comensales: Math.min(99, Math.max(1, Number(apertura.comensales) || 1)), usuario })
              setApertura(null)
            }}>{t('comun.confirmar')}</button>
            <button className="ghost" onClick={() => setApertura(null)}>{t('comun.cancelar')}</button>
          </div>
        </div>
      ) : <button className="success big" onClick={() => setApertura({ comensales: mesa?.cap ?? 1 })}>{t('pedido.abrirCuenta')}</button>)}
    </Ventana>
  )

  const editable = c.estado === 'abierta'
  const subtotal = totalCuenta(c)
  const final = totalFinal(c)
  const puedeDescuento = puede(rol, 'descuento')
  const puedeDescuentoPin = puede(rol, 'descuento_pin')
  const puedePropina = puede(rol, 'propina')
  const puedeUnir = puede(rol, 'unir_mesas')
  const puedeMover = puede(rol, 'mover_items')
  const puedeBorrar = puede(rol, 'borrar_producto')
  const estadoVisto = tOr('estado.' + c.estado, c.estado)
  const vivos = c.items.filter(i => i.estado !== 'anulado')

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
    const base = subtotal - (c.descuento || 0)
    const monto = Math.round(base * pct * 100) / 100
    d({ t: 'extras', cuentaId: c.id, propina: monto })
    setProp(null)
  }

  const iniciarCobro = () => {
    if (!s.caja?.turno) { setSinTurno({ fondo: '' }); return }
    setPagos([{ metodo: 'efectivo', monto: String(final.toFixed(2)) }])
  }
  const abrirTurnoYCobrar = () => {
    const f = Number(sinTurno.fondo === '' ? 0 : sinTurno.fondo)
    if (!Number.isFinite(f) || f < 0) return avisar(t('caja.fondoInvalido'))
    d({ t: 'turno+', fondo: Math.round(f * 100) / 100, usuario })
    setSinTurno(null)
    setPagos([{ metodo: 'efectivo', monto: String(final.toFixed(2)) }])
  }
  const sumaPagos = (pagos || []).reduce((t2, p) => t2 + (Number(p.monto) || 0), 0)
  const pendiente = Math.max(0, final - sumaPagos)
  const cambio = Math.max(0, sumaPagos - final)
  const confirmarCobro = () => {
    if (sumaPagos < final) return avisar(t('pedido.faltaParaCobrar', { faltan: money(pendiente), total: money(final) }))
    const lineas = pagos.filter(p => Number(p.monto) > 0).map(p => ({ metodo: p.metodo, monto: Number(p.monto) }))
    if (!lineas.length) return avisar(t('pedido.sinPagos'))
    d({ t: 'cobrar', cuentaId: c.id, pagos: lineas, propina: c.propina || 0, descuento: c.descuento || 0, usuario })
    cerrar()
  }

  const imprimirTicketCuenta = async () => {
    if (!c.items.length) return avisar(t('pedido.cuentaVacia'))
    const r = await imprimirCuenta({ cuenta: c, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }) })
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

  const tokens = txt => String(txt || '').split(',').map(x => x.trim()).filter(Boolean)
  const alternarToken = (txt, o) => { const t0 = tokens(txt); return (t0.includes(o) ? t0.filter(x => x !== o) : [...t0, o]).join(', ') }
  const agregarProd = p => {
    if (agotados[p.id]) return avisar(t('agotado.bloqueado', { nombre: p.nombre, motivo: agotados[p.id].motivo ? t('agotado.motivoSep', { motivo: agotados[p.id].motivo }) : '' }))
    return (p.opciones || []).length ? setPrevia({ p, sel: [], texto: '' }) : d({ t: 'item+', cuentaId: c.id, p })
  }

  const quitarAgotado = id => d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, id, null) } })
  const agotadosEnSeccion = s.productos.filter(p => p.seccionId === secActiva && agotados[p.id])
  const confirmarPrevia = () => {
    const nota = [...previa.sel, previa.texto.trim()].filter(Boolean).join(', ').slice(0, 120)
    d({ t: 'item+', cuentaId: c.id, p: previa.p, ...(nota ? { nota } : {}) })
    setPrevia(null)
  }
  const hayPendientes = c.items.some(i => i.estado === 'pendiente')

  return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <div className="fila pm-cab">
        <h3 className="pm-titulo">{titulo}</h3>
        <span className={'tag ' + c.estado}>{estadoVisto}</span>
        {hayMenu && (
          <div className="pm-mas">
            <button type="button" className="pm-mas-btn" aria-haspopup="menu" aria-expanded={menu} title={t('pedido.masOpciones')} aria-label={t('pedido.masOpciones')} onClick={() => setMenu(v => !v)}>⋯</button>
            {menu && (
              <>
                <div className="pm-mas-fondo" onClick={() => setMenu(false)} />
                <ul className="pm-mas-menu" role="menu">
                  {vivos.length > 0 && <li><button type="button" role="menuitem" onClick={() => abrirModo('eliminar')}>🗑 {t('pedido.menuEliminar')}</button></li>}
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
              ? t('pedido.abrioHora', { usuario: c.abiertaPor, hora: new Date(c.abiertaEn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
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
                  <input type="checkbox" checked={aUnir.includes(m.id)} style={{ width: 16, height: 16 }}
                    onChange={() => setAUnir(a => a.includes(m.id) ? a.filter(x => x !== m.id) : [...a, m.id])} />
                  {m.nombre}{mc ? ` · ${money(totalCuenta(mc))}` : ` · ${t('pedido.libre')}`}
                </label>
              )
            })}
          </div>
          <div className="barra">
            <button className="violet" disabled={!aUnir.length} onClick={() => { d({ t: 'unir', cuentaId: c.id, mesaIds: aUnir }); setUniendo(false); setAUnir([]) }}>{t('pedido.unirN', { n: aUnir.length })}</button>
            <button className="ghost" onClick={() => { setUniendo(false); setAUnir([]) }}>{t('comun.cancelar')}</button>
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
                {modo === 'mover' && puedeMover && editable && i.estado !== 'anulado' && <input type="checkbox" checked={marcados.includes(i.id)} onChange={() => toggle(i.id)} aria-label={t('pedido.moverTitle')} />}
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
                {editable && i.estado === 'pendiente' && <button className="x" title={t('pedido.notaTitle')} onClick={() => setNota(n => (n?.id === i.id ? null : { id: i.id, texto: i.nota || '' }))}>✎</button>}

                {nota?.id === i.id && (
                  <form className="pm-sub-fila" style={{ flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); d({ t: 'nota', cuentaId: c.id, itemId: i.id, nota: nota.texto.slice(0, 120) }); setNota(null) }}>
                    {(s.productos.find(x => x.id === i.productoId)?.opciones || []).length > 0 && (
                      <div className="pm-opciones" style={{ width: '100%' }}>
                        {s.productos.find(x => x.id === i.productoId).opciones.map(o => (
                          <button key={o} type="button" className={'tab' + (tokens(nota.texto).includes(o) ? ' on' : '')} onClick={() => setNota({ ...nota, texto: alternarToken(nota.texto, o) })}>{o}</button>
                        ))}
                      </div>
                    )}
                    <input autoFocus value={nota.texto} placeholder={t('pedido.notaPrompt')} onChange={e => setNota({ ...nota, texto: e.target.value })} style={{ flex: 1 }} />
                    <button type="submit" className="primary" style={chico}>{t('comun.guardar')}</button>
                    <button type="button" className="ghost" style={chico} onClick={() => setNota(null)}>✕</button>
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
                    <input value={borrando.texto} maxLength={80} placeholder={i.estado !== 'pendiente' ? t('pedido.motivoEscribe') : t('pedido.motivoOpcional')}
                      onChange={e => setBorrando({ ...borrando, texto: e.target.value })} />
                    <div className="barra" style={{ margin: 0 }}>
                      <button type="button" className="danger solid" onClick={() => confirmarBorrar(i)}>{t('pedido.confirmarBorrar')}</button>
                      <button type="button" className="ghost" onClick={() => setBorrando(null)}>{t('comun.cancelar')}</button>
                      {i.estado !== 'pendiente' && <small style={{ color: 'var(--mut)' }}>{t('pedido.motivoOblig')}</small>}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {!c.items.length && <li className="vacio">{t('pedido.sinItems')}</li>}
          </ul>

          {modo === 'mover' && puedeMover && editable && (
            <div className="pm-caja pm-mover">
              <b>{t('pedido.moverTitulo')}</b>
              <label className="pm-campo">{t('pedido.destino')}
                <select value={destino} onChange={e => { setDestino(e.target.value); setCanje('') }}>
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
                    <select value={canje} onChange={e => setCanje(e.target.value)} aria-label={t('pedido.intercambiarPor')}>
                      <option value="">{t('pedido.intercambiarPor')}</option>
                      {itemsDestino.map(i => <option key={i.id} value={i.id}>{i.qty}× {i.nombre}</option>)}
                    </select>
                    <button className="violet" disabled={!canje} onClick={intercambiar}>⇄ {t('pedido.intercambiar')}</button>
                  </div>
                ) : <small style={{ color: 'var(--mut)' }}>{t('pedido.destinoVacia')}</small>
              )}
            </div>
          )}

          {puedePropina && editable && (
            <div className="barra" style={{ fontSize: '.85rem' }}>
              <span>{t('pedido.propina')}{c.propina ? `: ${money(c.propina)}` : ''}:</span>
              {s.config.propinaPct > 0 && <button className="ghost" style={chico} onClick={() => aplicarPropina(s.config.propinaPct / 100)}>{s.config.propinaPct}% {t('pedido.sugerida')}</button>}
              <button className="ghost" style={chico} onClick={() => aplicarPropina(0)}>{t('comun.quitar')}</button>
              {prop === null
                ? <button className="ghost" style={chico} onClick={() => setProp('15')}>{t('pedido.otraPct')}</button>
                : <>
                  <input type="number" min="0" max="100" value={prop} style={{ width: 64 }} onChange={e => setProp(e.target.value)} />
                  <button className="primary" style={chico} onClick={() => { const v = Number(prop); if (v > 0) aplicarPropina(v / 100); else setProp(null) }}>{t('comun.ok')}</button>
                  <button className="ghost" style={chico} onClick={() => setProp(null)}>✕</button>
                </>}
            </div>
          )}

          {(puedeDescuento || puedeDescuentoPin) && editable && (
            <div className="barra" style={{ fontSize: '.85rem' }}>
              <span>{t('pedido.descuento')}{c.descuento ? `: ${money(c.descuento)}` : ''}:</span>
              {desc === null ? <>
                <button className="ghost" style={chico} onClick={() => setDesc({ modo: 'monto', valor: '', pin: '' })}>{t('pedido.aplicar')}</button>
                {c.descuento > 0 && <button className="ghost" style={chico} onClick={() => d({ t: 'extras', cuentaId: c.id, descuento: 0 })}>{t('comun.quitar')}</button>}
              </> : <>
                <select value={desc.modo} onChange={e => setDesc({ ...desc, modo: e.target.value })}><option value="monto">{t('comun.monto')}</option><option value="pct">{t('pedido.pctSubtotal')}</option></select>
                <input type="number" min="0" value={desc.valor} style={{ width: 80 }} onChange={e => setDesc({ ...desc, valor: e.target.value })} placeholder={desc.modo === 'pct' ? t('pedido.pEjemplo10') : t('pedido.pEjemplo15')} />
                {!puedeDescuento && <input type="password" inputMode="numeric" value={desc.pin} style={{ width: 90 }} onChange={e => setDesc({ ...desc, pin: e.target.value })} placeholder={t('pedido.pinAdmin')} />}
                <button className="primary" style={chico} onClick={aplicarDescuento}>{t('comun.ok')}</button>
                <button className="ghost" style={chico} onClick={() => setDesc(null)}>✕</button>
                {!puedeDescuento && <small style={{ color: 'var(--mut)' }}>{t('pedido.avisoCajeroPin')}</small>}
              </>}
            </div>
          )}

          <div className="total"><span>{t('pedido.subtotal')}</span><b>{money(subtotal)}</b></div>
          {c.descuento > 0 && <div className="total"><span>{t('pedido.descuento')}</span><b>−{money(c.descuento)}</b></div>}
          {c.propina > 0 && <div className="total"><span>{t('pedido.propina')}</span><b>{money(c.propina)}</b></div>}
          {!propinaIncluida && pctProp > 0 && !(c.propina > 0) && baseProp > 0 && <div className="total pm-sugerida"><span>{t('pedido.propinaSugeridaLinea', { pct: pctProp })}</span><b>{money(propinaAuto)}</b></div>}
          <div className="total" style={{ borderTop: '2px solid var(--line-fuerte)', paddingTop: 8 }}><span>{t('pedido.totalPagar')}</span><b>{money(final)}</b></div>
          {(c.comensales || 1) > 1 && (
            <div className="total pm-porpersona"><span>{t('pedido.porPersona', { n: c.comensales })}</span><b>{money(Math.ceil((final / c.comensales) * 100) / 100)}</b></div>
          )}

          {sinTurno && (
            <div className="pm-caja">
              <b>{t('pedido.sinTurno')}</b>
              <div className="barra" style={{ margin: 0, alignItems: 'flex-end' }}>
                <label className="pm-campo">{t('caja.fondoLabel')}
                  <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" autoFocus value={sinTurno.fondo}
                    onChange={e => setSinTurno({ fondo: e.target.value })} style={{ width: 120 }} />
                </label>
                <button className="success" onClick={abrirTurnoYCobrar}>{t('pedido.abrirTurnoCobrar')}</button>
                <button className="ghost" onClick={() => setSinTurno(null)}>{t('comun.cancelar')}</button>
              </div>
            </div>
          )}

          {pagos ? (
            <div className="pm-caja">
              <b style={{ fontSize: '.85rem' }}>{t('pedido.pagosMixtos', { total: money(final) })}</b>
              {pagos.map((p, i) => (
                <div key={i} className="barra" style={{ margin: 0 }}>
                  <select value={p.metodo} onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, metodo: e.target.value } : x))}>{METODOS.map(m => <option key={m} value={m}>{tOr('metodo.' + m, m)}</option>)}</select>
                  <input type="number" min="0" step="0.01" value={p.monto} style={{ flex: 1 }} onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))} placeholder={t('comun.monto')} />
                  {pagos.length > 1 && <button className="x" onClick={() => setPagos(ps => ps.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              <div className="barra">
                <button className="ghost" style={chico} onClick={() => setPagos(ps => [...ps, { metodo: 'qr', monto: '' }])}>{t('pedido.agregarLinea')}</button>
                <span className="sp" />
                {pendiente > 0 ? <small>{t('pedido.falta', { monto: money(pendiente) })}</small> : <small>{t('pedido.cambio', { monto: money(cambio) })}</small>}
              </div>
              <div className="barra">
                <button className="success" disabled={pendiente > 0.009} onClick={confirmarCobro}>{t('pedido.confirmarCobro')}</button>
                <button className="ghost" onClick={() => setPagos(null)}>{t('comun.cancelar')}</button>
                {cambio > 0 && <button className="slate" onClick={imprimirTicketCuenta}>{t('pedido.imprimirTicket')}</button>}
              </div>
            </div>
          ) : !sinTurno && (
            <div className="barra pm-acciones">
              {editable && hayPendientes && <button className="orange" onClick={enviarCocina}>🔥 {t('pedido.enviarCocina')}</button>}
              {editable && c.items.length > 0 && <button className="violet" onClick={() => d({ t: 'precuenta', cuentaId: c.id })}>{t('pedido.precuenta')}</button>}
              {c.estado === 'precuenta' && <button className="warning" onClick={() => d({ t: 'reabrir', cuentaId: c.id })}>{t('pedido.reabrir')}</button>}
              {puede(rol, 'cobrar') && c.items.length > 0 && <button className="success" onClick={iniciarCobro}>💵 {t('pedido.cobrar')}</button>}
              {c.items.length > 0 && <button className="slate" onClick={imprimirTicketCuenta}>🖨 {t('pedido.imprimirTicket')}</button>}
              {c.items.some(i => i.estado === 'enviado') && <button className="teal" onClick={reimprimirComanda}>↻ {t('pedido.reimprimirComanda')}</button>}
            </div>
          )}
          <p className="pm-sub" style={{ marginTop: 6 }}>{t('pedido.pagadoEstado', { pagado: money(pagadoCuenta(c)), estado: estadoVisto })}</p>
        </section>
      </div>
      {previa && (
        <div className="pm-previa-fondo" onClick={() => setPrevia(null)}>
          <div className="pm-previa" role="dialog" aria-label={previa.p.nombre} onClick={e => e.stopPropagation()}>
            <b>{previa.p.nombre}</b>
            <div className="pm-opciones">
              {previa.p.opciones.map(o => (
                <button key={o} type="button" className={'tab' + (previa.sel.includes(o) ? ' on' : '')}
                  onClick={() => setPrevia(v => ({ ...v, sel: v.sel.includes(o) ? v.sel.filter(x => x !== o) : [...v.sel, o] }))}>{o}</button>
              ))}
            </div>
            <input value={previa.texto} maxLength={60} placeholder={t('pedido.notaExtra')} onChange={e => setPrevia(v => ({ ...v, texto: e.target.value }))} />
            <div className="barra" style={{ margin: 0 }}>
              <button type="button" className="success" onClick={confirmarPrevia}>{t('pedido.agregarConNota')}</button>
              <button type="button" className="ghost" onClick={() => { d({ t: 'item+', cuentaId: c.id, p: previa.p }); setPrevia(null) }}>{t('pedido.sinNota')}</button>
              <button type="button" className="ghost" onClick={() => setPrevia(null)}>{t('comun.cancelar')}</button>
            </div>
          </div>
        </div>
      )}
    </Ventana>
  )
}
