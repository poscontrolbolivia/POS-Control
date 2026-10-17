import { useEffect, useRef, useState } from 'react'
import { useStore, cuentaActiva, totalCuenta, totalFinal, pagadoCuenta } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { MONEDA } from '../../config'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../services/imagenProducto.js'
import { useIdioma } from '../../i18n/index.jsx'
import { imprimirCuenta, imprimirComandas } from '../ticket/Ticket.jsx'
import './PedidoPanel.css'

const money = n => `${MONEDA} ${(Number(n) || 0).toFixed(2)}`

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
  const avisoTimer = useRef(null)
  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])

  if (!mesa && !cuenta) return null
  if (bloqueado) return null

  const c = cuenta ?? cuentaActiva(s, mesa.id)
  const titulo = c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : (mesa?.nombre ?? t('pedido.cuenta'))
  const reset = () => { setMarcados([]); setDestino(''); setCanje(''); setPagos(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setApertura(null); setSinTurno(null); setBorrando(null); setNota(null) }
  const cerrar = () => { reset(); onClose() }
  const toggle = id => { setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setCanje('') }
  const nombreMesa = id => s.mesas.find(m => m.id === id)?.nombre ?? t('pedido.mesaCorta')

  // ---------- mesa libre: abrir cuenta con comensales ----------
  if (!c) return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <h3 className="pm-titulo">{titulo}</h3>
      <p>{t('pedido.mesaLibre', { cap: mesa?.cap })}</p>
      {puede(rol, 'abrir_mesa') && (apertura ? (
        <div className="barra" style={{ alignItems: 'flex-end' }}>
          <label className="pm-campo pm-campo-pax">{t('pedido.comensales')}
            <input type="number" min="1" value={apertura.comensales} style={{ width: 90 }} autoFocus
              onChange={e => setApertura({ ...apertura, comensales: e.target.value })} />
          </label>
          <button className="success" onClick={() => {
            d({ t: 'abrir', mesaId: mesa.id, comensales: Math.max(1, Number(apertura.comensales) || 1), usuario })
            setApertura(null)
          }}>{t('comun.confirmar')}</button>
          <button className="ghost" onClick={() => setApertura(null)}>{t('comun.cancelar')}</button>
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
  const cuentaDestino = destino ? cuentaActiva(s, destino) : null
  const itemsDestino = (cuentaDestino?.items || []).filter(i => i.estado !== 'anulado')
  const mover = () => {
    if (!destino || !marcados.length) return
    d({ t: 'mover', cuentaId: c.id, itemIds: marcados, mesaDestino: destino, usuario })
    setMarcados([]); setDestino(''); setCanje('')
    avisar(t('pedido.movidoOk', { mesa: nombreMesa(destino) }))
  }
  const intercambiar = () => {
    if (!cuentaDestino || marcados.length !== 1 || !canje) return
    d({ t: 'intercambiar', cuentaA: c.id, itemA: marcados[0], cuentaB: cuentaDestino.id, itemB: canje, usuario })
    setMarcados([]); setDestino(''); setCanje('')
    avisar(t('pedido.intercambiadoOk', { mesa: nombreMesa(destino) }))
  }

  // ---------- borrar producto (con motivo) ----------
  const pedirBorrar = i => {
    const enviado = i.estado === 'enviado'
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
    if (i.estado === 'enviado' && !motivo) return avisar(t('pedido.motivoOblig'))
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
    const r = await imprimirCuenta({ cuenta: c, config: s.config, titulo: t('pedido.ticketTitulo', { titulo }), fallbackDialog: true })
    if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
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
  const hayPendientes = c.items.some(i => i.estado === 'pendiente')

  // ---------- render ----------
  return (
    <Ventana titulo={titulo} onClose={cerrar}>
      <div className="fila pm-cab">
        <h3 className="pm-titulo">{titulo}</h3>
        <span className={'tag ' + c.estado}>{estadoVisto}</span>
      </div>
      <div className="pm-sub fila" style={{ gap: 10, flexWrap: 'wrap' }}>
        {c.tipo === 'mesa' && editable && puede(rol, 'abrir_mesa') ? (
          <span className="pm-pax">{t('pedido.comensales')}
            <button type="button" className="x" disabled={(c.comensales || 1) <= 1} aria-label="−" onClick={() => d({ t: 'comensales~', cuentaId: c.id, comensales: Math.max(1, (c.comensales || 1) - 1) })}>−</button>
            <b>{c.comensales || 1}</b>
            <button type="button" className="x" disabled={(c.comensales || 1) >= 99} aria-label="+" onClick={() => d({ t: 'comensales~', cuentaId: c.id, comensales: Math.min(99, (c.comensales || 1) + 1) })}>+</button>
          </span>
        ) : (c.comensales ? <span className="pm-pax-info">{t('pedido.comensalesInfo', { comensales: c.comensales })}</span> : null)}
        {c.abiertaPor ? <span>{t('pedido.abrio', { usuario: c.abiertaPor })}</span> : null}
      </div>
      {aviso && <div className="pm-aviso" role="status">{aviso}<button type="button" className="ico" onClick={() => setAviso('')} aria-label={t('comun.cancelar')}>✕</button></div>}

      {/* mesas unidas: chips con separar */}
      {c.mesaIds.length > 0 && (
        <div className="barra" style={{ gap: 6 }}>
          {c.mesaIds.map(id => (
            <span key={id} className="pm-chip">
              {nombreMesa(id)}
              {c.mesaIds.length > 1 && puedeUnir && (
                <button className="x" style={{ minWidth: 0, minHeight: 0, padding: '0 6px', border: 'none', background: 'none', color: '#c0392b' }}
                  title={t('pedido.separarTitle', { mesa: nombreMesa(id) })} onClick={() => d({ t: 'separar', cuentaId: c.id, mesaId: id, usuario })}>✕</button>
              )}
            </span>
          ))}
          {puedeUnir && !uniendo && c.mesaIds.length < s.mesas.length && (
            <button className="ghost" style={chico} onClick={() => setUniendo(true)}>{t('pedido.unirMesas')}</button>
          )}
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
                <button key={p.id} className="prod" onClick={() => d({ t: 'item+', cuentaId: c.id, p })}>
                  <Thumb producto={p} />
                  {p.nombre}<small>{money(p.precio)}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── columna derecha: cuenta ── */}
        <section className="pm-cuenta">
          {puedeMover && editable && vivos.length > 0 && <p className="pm-hint">☑ {t('pedido.marcaHint')}</p>}
          <ul className="items">
            {c.items.map(i => (
              <li key={i.id} className={i.estado + ' pm-item'}>
                <Thumb producto={s.productos.find(x => x.id === i.productoId)} nombreFallback={i.nombre} />
                {puedeMover && editable && i.estado !== 'anulado' && <input type="checkbox" checked={marcados.includes(i.id)} onChange={() => toggle(i.id)} aria-label={t('pedido.moverTitle')} />}
                <span className="n">{i.nombre}{i.estado === 'anulado' && t('pedido.anuladoTag')}{i.nota && <em> · {i.nota}</em>}{i.motivo && i.estado === 'anulado' && <em> · {i.motivo}</em>}</span>
                {editable && i.estado === 'pendiente' ? (
                  <span className="qty"><button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: -1 })}>−</button>{i.qty}<button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: 1 })}>+</button></span>
                ) : <span>×{i.qty}</span>}
                <span className="pr">{money(i.precio * i.qty)}</span>
                {editable && i.estado !== 'anulado' && <button className="x danger solid" title={t('pedido.borrarProducto')} aria-label={t('pedido.borrarProducto')} onClick={() => pedirBorrar(i)}>🗑</button>}
                {editable && i.estado === 'pendiente' && <button className="x" title={t('pedido.notaTitle')} onClick={() => setNota(n => (n?.id === i.id ? null : { id: i.id, texto: i.nota || '' }))}>✎</button>}

                {nota?.id === i.id && (
                  <form className="pm-sub-fila" onSubmit={e => { e.preventDefault(); d({ t: 'nota', cuentaId: c.id, itemId: i.id, nota: nota.texto }); setNota(null) }}>
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
                    <input value={borrando.texto} maxLength={80} placeholder={i.estado === 'enviado' ? t('pedido.motivoEscribe') : t('pedido.motivoOpcional')}
                      onChange={e => setBorrando({ ...borrando, texto: e.target.value })} />
                    <div className="barra" style={{ margin: 0 }}>
                      <button type="button" className="danger solid" onClick={() => confirmarBorrar(i)}>{t('pedido.confirmarBorrar')}</button>
                      <button type="button" className="ghost" onClick={() => setBorrando(null)}>{t('comun.cancelar')}</button>
                      {i.estado === 'enviado' && <small style={{ color: 'var(--mut)' }}>{t('pedido.motivoOblig')}</small>}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {!c.items.length && <li className="vacio">{t('pedido.sinItems')}</li>}
          </ul>

          {/* mover / intercambiar con otra mesa */}
          {puedeMover && editable && marcados.length > 0 && (
            <div className="pm-caja pm-mover">
              <b>{t('pedido.moverTitulo')}</b>
              <label className="pm-campo">{t('pedido.destino')}
                <select value={destino} onChange={e => { setDestino(e.target.value); setCanje('') }}>
                  <option value="">{t('pedido.elegirMesa')}</option>
                  {s.mesas.filter(m => !c.mesaIds.includes(m.id)).map(m => {
                    const mc = cuentaActiva(s, m.id)
                    return <option key={m.id} value={m.id}>{m.nombre} · {mc ? money(totalCuenta(mc)) : t('pedido.libre')}</option>
                  })}
                </select>
              </label>
              <div className="barra" style={{ margin: 0 }}>
                <button className="teal" disabled={!destino} onClick={mover}>{t('pedido.moverN', { n: marcados.length })}</button>
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
    </Ventana>
  )
}
