import { useEffect, useRef, useState } from 'react'
import { useStore, cuentaActiva, cuentasDeMesa, totalCuenta, totalFinal, pagadoCuenta } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { useMoneda } from '../../services/moneda.js'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../services/imagenProducto.js'
import { useIdioma } from '../../i18n/index.jsx'
import { imprimirCuenta, imprimirComandas } from '../ticket/Ticket.jsx'
import { nombreDeArea } from '../../services/impresion.js'
import './PedidoPanel.css'

const cap = x => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '')
// Etiqueta legible de un área de impresión (chips en la fila del ítem).
const nombreArea = (id, tOr, config) => nombreDeArea(config, id, tOr('areas.' + id, cap(id)))

// Miniato 45×45 (hueco siempre reservado con la inicial → ninguna fila/til se desplaza
// cuando falta la imagen). Estilos en línea: styles.css está fuera del alcance de este carril.
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
// 'efectivo' | 'qr' | 'tarjeta' | 'otro' son los valores que se guardan en la base: no se cambian.
const METODOS = ['efectivo', 'qr', 'tarjeta', 'otro']
const PIN_ADMIN_DEMO = '1234'
// Motivos rápidos para borrar un producto (clave i18n → se guarda el texto traducido en `motivo`).
const MOTIVOS = ['error', 'cambio', 'agotado', 'demora', 'cortesia', 'otro']

// Ventana en primer plano: fondo oscuro, Esc y clic fuera la cierran, el scroll de la página se bloquea.
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

export default function PedidoPanel({ rol, sesion, mesa, cuenta, onClose, bloqueado }) {
  const { s, d } = useStore()
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol
  const secciones = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const [sec, setSec] = useState(secciones[0]?.id)
  // Con Supabase el panel se monta ANTES de que lleguen las secciones (estado aún vacío),
  // así que `sec` queda undefined y la carta saldría "Sin artículos": se cae a la primera
  // sección en cuanto existen.
  const secActiva = secciones.some(x => x.id === sec) ? sec : secciones[0]?.id
  const [marcados, setMarcados] = useState([])
  const [destino, setDestino] = useState('')
  const [canje, setCanje] = useState('')            // ítem de la mesa destino a intercambiar
  const [apertura, setApertura] = useState(null)    // {comensales} mientras se abre la cuenta
  const [uniendo, setUniendo] = useState(false)     // panel de multi-seleccion de mesas
  const [aUnir, setAUnir] = useState([])
  const [desc, setDesc] = useState(null)            // {modo:'monto'|'pct', valor, pin}
  const [prop, setProp] = useState(null)            // porcentaje personalizado
  const [pagos, setPagos] = useState(null)          // lineas de cobro mixto
  const [sinTurno, setSinTurno] = useState(null)    // {fondo} si se quiere cobrar sin turno abierto
  const [borrando, setBorrando] = useState(null)    // {id, motivo, texto} borrar producto con motivo
  const [nota, setNota] = useState(null)            // {id, texto} nota inline
  const [aviso, setAviso] = useState('')            // aviso breve dentro de la ventana
  const [cuentaSelId, setCuentaSelId] = useState(null) // subcuenta elegida cuando la mesa está dividida (2a/2b)
  const [menu, setMenu] = useState(false)             // menú «⋯» de la mesa
  const [modo, setModo] = useState(null)              // null | 'eliminar' | 'mover' (herramienta activa)
  const [previa, setPrevia] = useState(null)          // {p, sel, texto}: opciones rápidas antes de agregar
  const avisoTimer = useRef(null)
  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])
  useEffect(() => { setCuentaSelId(null); setModo(null); setMenu(false); setPrevia(null) }, [mesa?.id])

  if (!mesa && !cuenta) return null
  if (bloqueado) return null

  const hermanas = mesa ? cuentasDeMesa(s, mesa.id) : []   // 1 cuenta normal; 2+ si la mesa se dividió
  const c = cuenta ?? hermanas.find(x => x.id === cuentaSelId) ?? hermanas[0]
  const sufijo = c?.tipo === 'mesa' && hermanas.length > 1 && c.etiqueta ? c.etiqueta : '' // «Mesa 2» + «a»
  const titulo = c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : ((mesa?.nombre ?? t('pedido.cuenta')) + sufijo)
  const reset = () => { setMarcados([]); setDestino(''); setCanje(''); setPagos(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setApertura(null); setSinTurno(null); setBorrando(null); setNota(null); setModo(null); setMenu(false); setPrevia(null) }
  const cerrar = () => { reset(); onClose() }
  const toggle = id => { setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setCanje('') }
  const nombreMesa = id => s.mesas.find(m => m.id === id)?.nombre ?? t('pedido.mesaCorta')

  // ---------- mesa libre: abrir cuenta con comensales ----------
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

  // ---------- mover / intercambiar con otra mesa ----------
  // Destinos: cualquier OTRA cuenta de mesa abierta (incluida la hermana 2b) o una mesa libre.
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

  // ---------- borrar producto (con motivo) ----------
  // 'enviado' Y 'listo' (ya salió en la impresora) exigen el permiso fuerte anular_enviado:
  // admin/cajero. Cocina/barra NO borran aquí: piden anulación en su pantalla (pedir_anulacion).
  const pedirBorrar = i => {
    const enviado = i.estado === 'enviado' || i.estado === 'listo'
    if (!puede(rol, enviado ? 'anular_enviado' : 'anular_pendiente')) return avisar(enviado ? t('pedido.needAdmin') : t('pedido.sinPermisoAnular'))
    if (!enviado && !puedeBorrar) { // mesero: quita un pendiente sin papeleo
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

  // ---------- extras ----------
  const aplicarDescuento = () => {
    const v = Number(desc?.valor)
    if (!(v > 0)) return avisar(t('pedido.valorNoValido'))
    if (!puedeDescuento && (desc.pin || '') !== PIN_ADMIN_DEMO) return avisar(t('pedido.pinIncorrecto')) // cajero: PIN de admin (demo)
    const monto = desc.modo === 'pct' ? Math.min(subtotal, subtotal * v / 100) : Math.min(subtotal, v)
    d({ t: 'extras', cuentaId: c.id, descuento: Math.round(monto * 100) / 100 })
    setDesc(null)
  }
  const aplicarPropina = pct => {
    const base = subtotal - (c.descuento || 0)
    const monto = Math.round(base * pct * 100) / 100
    d({ t: 'extras', cuentaId: c.id, propina: monto })
    setProp(null)
  }

  // ---------- cobro ----------
  const iniciarCobro = () => {
    if (!s.caja?.turno) { setSinTurno({ fondo: '' }); return } // sin turno: se ofrece abrirlo aquí mismo
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

  // ---------- impresión ----------
  const imprimirTicketCuenta = async () => {
    if (!c.items.length) return avisar(t('pedido.cuentaVacia'))
    const r = await imprimirCuenta({ cuenta: c, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }) })
    if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
    else if (r === 'sin-impresora') avisar(t('pedido.avisoSinImpresoraTicket'))
    else if (r === 'encolado') avisar(t('pedido.ticketEnviadoEstacion'))
  }
  // Resumen del envío por grupo: "Cocina ✔ · Barra: sin impresora conectada".
  const resumenEnvio = salida => salida.map(({ grupo, resultado, n }) => (
    resultado === 'silencioso' || resultado === 'encolado' ? `${grupo.nombre} (${n}) ✔`
      : resultado === 'sin-impresora' ? t('pedido.sinImpresoraGrupo', { grupo: grupo.nombre })
        : t('pedido.errorImpresoraGrupo', { grupo: grupo.nombre })
  )).join(' · ')
  // Enviar: pasa a "enviado" y SALE cada parte a la impresora de su grupo (bebida → Barra, comida →
  // Cocina), sin diálogo ni selector de impresora.
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
  // Notas rápidas: una nota es una lista «término medio, inglés» separada por comas.
  const tokens = txt => String(txt || '').split(',').map(x => x.trim()).filter(Boolean)
  const alternarToken = (txt, o) => { const t0 = tokens(txt); return (t0.includes(o) ? t0.filter(x => x !== o) : [...t0, o]).join(', ') }
  const agregarProd = p => ((p.opciones || []).length ? setPrevia({ p, sel: [], texto: '' }) : d({ t: 'item+', cuentaId: c.id, p }))
  const confirmarPrevia = () => {
    const nota = [...previa.sel, previa.texto.trim()].filter(Boolean).join(', ').slice(0, 120)
    d({ t: 'item+', cuentaId: c.id, p: previa.p, ...(nota ? { nota } : {}) })
    setPrevia(null)
  }
  const hayPendientes = c.items.some(i => i.estado === 'pendiente')

  // ---------- render ----------
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

      {/* mesas unidas: solo informativo; separar y unir viven en el menú ⋯ */}
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
        {/* ── columna izquierda: carta por secciones ── */}
        {editable && (
          <section className="pm-carta">
            <div className="barra pm-tabs">{secciones.map(x => <button key={x.id} className={x.id === secActiva ? 'tab on' : 'tab'} onClick={() => setSec(x.id)}>{x.nombre}</button>)}</div>
            <div className="grid">
              {s.productos.filter(p => p.activo && p.seccionId === secActiva).map(p => (
                <button key={p.id} className="prod" onClick={() => agregarProd(p)}>
                  <Thumb producto={p} />
                  {p.nombre}<small>{money(p.precio)}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── columna derecha: cuenta ── */}
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
                  {/* Áreas del ítem (snapshot cuenta_items.areas): combo → Cocina + Barra a la vez. */}
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

          {/* mover / intercambiar con otra mesa */}
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

          {/* propina */}
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

          {/* descuento */}
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
          <div className="total" style={{ borderTop: '2px solid var(--line-fuerte)', paddingTop: 8 }}><span>{t('pedido.totalPagar')}</span><b>{money(final)}</b></div>

          {/* sin turno abierto: se ofrece abrirlo aquí para que la venta no se detenga */}
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

          {/* cobro con pagos mixtos */}
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
