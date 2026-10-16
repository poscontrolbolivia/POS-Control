import { useState } from 'react'
import { useStore, cuentaActiva, totalCuenta, totalFinal, pagadoCuenta } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { MONEDA } from '../../config'
import { LADO_VISUAL_PX, urlImagenProducto } from '../../services/imagenProducto.js'
import { useIdioma } from '../../i18n/index.jsx'
import { imprimirCuenta } from '../ticket/Ticket.jsx'

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
// La etiqueta visible sale de t('metodo.' + valor) vía tOr (ver más abajo).
const METODOS = ['efectivo', 'qr', 'tarjeta', 'otro']
const PIN_ADMIN_DEMO = '1234'

export default function PedidoPanel({ rol, mesa, cuenta, onClose, bloqueado }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const usuario = s.usuariosDemo?.find(u => u.rol === rol)?.usuario
  const secciones = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const [sec, setSec] = useState(secciones[0]?.id)
  const [marcados, setMarcados] = useState([])
  const [destino, setDestino] = useState('')
  const [apertura, setApertura] = useState(null)   // {comensales} mientras se abre la cuenta
  const [uniendo, setUniendo] = useState(false)    // panel de multi-seleccion de mesas
  const [aUnir, setAUnir] = useState([])
  const [desc, setDesc] = useState(null)           // {modo:'monto'|'pct', valor}
  const [prop, setProp] = useState(null)           // porcentaje personalizado
  const [pagos, setPagos] = useState(null)         // lineas de cobro mixto
  const [print, setPrint] = useState(null)         // {comanda, ancho} opciones de impresion
  const [aviso, setAviso] = useState('')           // toast breve (impresora, etc.)
  const avisar = msg => { setAviso(msg); setTimeout(() => setAviso(''), 4500) }

  if (!mesa && !cuenta) return <aside className="panel vacio">{t('pedido.seleccionaMesa')}</aside>
  if (bloqueado) return <aside className="panel vacio">{t('pedido.bloqueadoEdicion')}</aside>

  const c = cuenta ?? cuentaActiva(s, mesa.id)
  const titulo = c?.tipo === 'directa' ? t('pedido.turnoNumero', { n: c.numero }) : (mesa?.nombre ?? t('pedido.cuenta'))
  const reset = () => { setMarcados([]); setDestino(''); setPagos(null); setPrint(null); setDesc(null); setProp(null); setUniendo(false); setAUnir([]); setApertura(null) }
  const cerrar = () => { reset(); onClose() }
  const toggle = id => setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id]))

  // ---------- mesa libre: abrir cuenta con comensales ----------
  if (!c) return (
    <aside className="panel">
      <h3>{titulo}</h3>
      <p>{t('pedido.mesaLibre', { cap: mesa?.cap })}</p>
      {puede(rol, 'abrir_mesa') && (apertura ? (
        <div className="barra" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '.85rem' }}>{t('pedido.comensales')}
            <input type="number" min="1" value={apertura.comensales} style={{ width: 80 }}
              onChange={e => setApertura({ ...apertura, comensales: e.target.value })} />
          </label>
          <button className="primary" onClick={() => {
            d({ t: 'abrir', mesaId: mesa.id, comensales: Math.max(1, Number(apertura.comensales) || 1), usuario })
            setApertura(null)
          }}>{t('comun.confirmar')}</button>
          <button className="ghost" onClick={() => setApertura(null)}>{t('comun.cancelar')}</button>
        </div>
      ) : <button className="primary big" onClick={() => setApertura({ comensales: mesa?.cap ?? 1 })}>{t('pedido.abrirCuenta')}</button>)}
    </aside>
  )

  const editable = c.estado === 'abierta'
  const subtotal = totalCuenta(c)
  const final = totalFinal(c)
  const puedeDescuento = puede(rol, 'descuento')
  const puedeDescuentoPin = puede(rol, 'descuento_pin')
  const puedePropina = puede(rol, 'propina')
  const puedeUnir = puede(rol, 'unir_mesas')
  const nombreMesa = id => s.mesas.find(m => m.id === id)?.nombre ?? t('pedido.mesaCorta')
  const estadoVisto = tOr('estado.' + c.estado, c.estado)

  // ---------- acciones ----------
  const mover = () => {
    if (!destino || !marcados.length) return
    d({ t: 'mover', cuentaId: c.id, itemIds: marcados, mesaDestino: destino, usuario })
    setMarcados([]); setDestino('')
  }
  const anular = i => {
    if (i.estado === 'enviado') {
      if (!puede(rol, 'anular_enviado')) return alert(t('pedido.needAdmin'))
      const motivo = prompt(t('pedido.motivoAnular')); if (!motivo) return
      return d({ t: 'anular', cuentaId: c.id, itemId: i.id, motivo })
    }
    if (!puede(rol, 'anular_pendiente')) return alert(t('pedido.sinPermisoAnular'))
    const motivo = prompt(t('pedido.motivoAnularOpcional'))
    if (motivo === null) return
    d({ t: 'anular', cuentaId: c.id, itemId: i.id, motivo: motivo || 'pendiente' })
    setMarcados(m => m.filter(x => x !== i.id))
  }
  const aplicarDescuento = () => {
    const v = Number(desc?.valor)
    if (!(v > 0)) return alert(t('pedido.valorNoValido'))
    if (!puedeDescuento) { // cajero: requiere PIN de admin (demo)
      const pin = prompt(t('pedido.pinAdmin'))
      if (pin !== PIN_ADMIN_DEMO) return alert(t('pedido.pinIncorrecto'))
    }
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
  const iniciarCobro = () => { setPrint(null); setPagos([{ metodo: 'efectivo', monto: String(final.toFixed(2)) }]) }
  const sumaPagos = (pagos || []).reduce((t2, p) => t2 + (Number(p.monto) || 0), 0)
  const pendiente = Math.max(0, final - sumaPagos)
  const cambio = Math.max(0, sumaPagos - final)
  const confirmarCobro = () => {
    if (sumaPagos < final) return alert(t('pedido.faltaParaCobrar', { faltan: money(pendiente), total: money(final) }))
    const lineas = pagos.filter(p => Number(p.monto) > 0).map(p => ({ metodo: p.metodo, monto: Number(p.monto) }))
    if (!lineas.length) return alert(t('pedido.sinPagos'))
    d({ t: 'cobrar', cuentaId: c.id, pagos: lineas, propina: c.propina || 0, descuento: c.descuento || 0, usuario })
    cerrar()
  }
  const sinImpresora = r => {
    if (r === 'sin-impresora') avisar(t('pedido.avisoSinImpresora'))
    else if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
  }
  const imprimir = async (comanda) => {
    if (!c.items.length) return alert(t('pedido.cuentaVacia'))
    const r = await imprimirCuenta({
      cuenta: c, config: s.config,
      titulo: comanda ? t('pedido.comandaTitulo', { titulo }) : t('pedido.ticketTitulo', { titulo }),
      ancho: Number(print?.ancho) || 0, comanda: Boolean(comanda),
      fallbackDialog: true, // pedido explícito: si falta impresora, abre el diálogo de respaldo
    })
    if (r === 'sin-impresora') avisar(t('pedido.avisoDialogoManual'))
    else if (r === 'error') avisar(t('pedido.avisoFalloImpresora'))
  }
  // Enviar a cocina: en modo silencioso la comanda SALE IMPRESA AUTOMÁTICAMENTE (tipo Soft Restaurant), sin diálogo.
  const enviarCocina = async () => {
    const hayPendientes = c.items.some(i => i.estado === 'pendiente')
    d({ t: 'enviar', cuentaId: c.id })
    if (!hayPendientes) return
    const r = await imprimirCuenta({ cuenta: c, config: s.config, titulo: t('pedido.comandaTitulo', { titulo }), comanda: true, fallbackDialog: false })
    if (r === 'silencioso') avisar(t('pedido.comandaImpresa'))
    else sinImpresora(r)
  }

  // ---------- render ----------
  return (
    <aside className="panel" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
      <div className="fila"><h3>{titulo}</h3><span className="sp" /><span className={'tag ' + c.estado}>{estadoVisto}</span></div>
      {aviso && (
        <div style={{ background: 'var(--libre)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontSize: '.85rem', fontWeight: 600 }}>
          {aviso}
        </div>
      )}
      <p style={{ margin: '2px 0', color: 'var(--mut)', fontSize: '.85rem' }}>
        {c.comensales ? t('pedido.comensalesInfo', { comensales: c.comensales }) + ' ' : ''}{c.abiertaPor ? t('pedido.abrio', { usuario: c.abiertaPor }) : ''}
      </p>

      {/* mesas unidas: chips con separar */}
      {c.mesaIds.length > 0 && (
        <div className="barra" style={{ gap: 6 }}>
          {c.mesaIds.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--libre)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 10px', fontSize: '.8rem' }}>
              {nombreMesa(id)}
              {c.mesaIds.length > 1 && puedeUnir && (
                <button className="x" style={{ minWidth: 0, padding: '0 6px', border: 'none', background: 'none', color: '#c0392b' }}
                  title={t('pedido.separarTitle', { mesa: nombreMesa(id) })} onClick={() => d({ t: 'separar', cuentaId: c.id, mesaId: id, usuario })}>✕</button>
              )}
            </span>
          ))}
          {puedeUnir && !uniendo && c.mesaIds.length < s.mesas.length && (
            <button className="ghost" style={{ fontSize: '.8rem', padding: '4px 10px', minHeight: 32 }} onClick={() => setUniendo(true)}>{t('pedido.unirMesas')}</button>
          )}
        </div>
      )}
      {uniendo && (
        <div className="barra" style={{ flexDirection: 'column', alignItems: 'stretch', background: 'var(--bg)', borderRadius: 10, padding: 8 }}>
          <b style={{ fontSize: '.85rem' }}>{t('pedido.unirNota')}</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
            {s.mesas.filter(m => !c.mesaIds.includes(m.id)).map(m => {
              const mc = cuentaActiva(s, m.id)
              return (
                <label key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', fontSize: '.8rem', cursor: 'pointer', background: aUnir.includes(m.id) ? 'var(--ac)' : 'var(--card)', color: aUnir.includes(m.id) ? '#fff' : undefined }}>
                  <input type="checkbox" checked={aUnir.includes(m.id)} style={{ width: 16, height: 16, pointerEvents: 'auto' }}
                    onChange={() => setAUnir(a => a.includes(m.id) ? a.filter(x => x !== m.id) : [...a, m.id])} />
                  {m.nombre}{mc ? ` · ${money(totalCuenta(mc))}` : ` · ${t('pedido.libre')}`}
                </label>
              )
            })}
          </div>
          <div className="barra">
            <button className="primary" disabled={!aUnir.length} onClick={() => { d({ t: 'unir', cuentaId: c.id, mesaIds: aUnir }); setUniendo(false); setAUnir([]) }}>{t('pedido.unirN', { n: aUnir.length })}</button>
            <button className="ghost" onClick={() => { setUniendo(false); setAUnir([]) }}>{t('comun.cancelar')}</button>
          </div>
        </div>
      )}

      {/* menu por secciones */}
      {editable && (
        <>
          <div className="barra">{secciones.map(x => <button key={x.id} className={x.id === sec ? 'tab on' : 'tab'} onClick={() => setSec(x.id)}>{x.nombre}</button>)}</div>
          <div className="grid">
            {s.productos.filter(p => p.activo && p.seccionId === sec).map(p => (
              <button key={p.id} className="prod" onClick={() => d({ t: 'item+', cuentaId: c.id, p })}>
                <Thumb producto={p} />
                {p.nombre}<small>{money(p.precio)}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {/* items */}
      <ul className="items">
        {c.items.map(i => (
          <li key={i.id} className={i.estado}>
            <Thumb producto={s.productos.find(x => x.id === i.productoId)} nombreFallback={i.nombre} />
            {puede(rol, 'mover_items') && editable && i.estado !== 'anulado' && <input type="checkbox" checked={marcados.includes(i.id)} onChange={() => toggle(i.id)} />}
            <span className="n">{i.nombre}{i.estado === 'anulado' && t('pedido.anuladoTag')}{i.nota && <em> · {i.nota}</em>}{i.motivo && i.estado === 'anulado' && <em> · {i.motivo}</em>}</span>
            {editable && i.estado === 'pendiente' ? (
              <span className="qty"><button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: -1 })}>−</button>{i.qty}<button onClick={() => d({ t: 'qty', cuentaId: c.id, itemId: i.id, d: 1 })}>+</button></span>
            ) : <span>×{i.qty}</span>}
            <span className="pr">{money(i.precio * i.qty)}</span>
            {editable && i.estado !== 'anulado' && <button className="x" title={t('pedido.anularTitle')} onClick={() => anular(i)}>✕</button>}
            {editable && i.estado === 'pendiente' && <button className="x" title={t('pedido.notaTitle')} onClick={() => { const n = prompt(t('pedido.notaPrompt'), i.nota); if (n !== null) d({ t: 'nota', cuentaId: c.id, itemId: i.id, nota: n }) }}>✎</button>}
          </li>
        ))}
        {!c.items.length && <li className="vacio">{t('pedido.sinItems')}</li>}
      </ul>

      {/* mover a otra mesa */}
      {puede(rol, 'mover_items') && marcados.length > 0 && (
        <div className="barra">
          <select value={destino} onChange={e => setDestino(e.target.value)}>
            <option value="">{t('pedido.moverA', { n: marcados.length })}</option>
            {s.mesas.filter(m => !c.mesaIds.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <button className="ghost" disabled={!destino} onClick={mover}>{t('pedido.mover')}</button>
        </div>
      )}

      {/* propina */}
      {puedePropina && editable && (
        <div className="barra" style={{ fontSize: '.85rem' }}>
          <span>{t('pedido.propina')}{c.propina ? `: ${money(c.propina)}` : ''}:</span>
          {s.config.propinaPct > 0 && <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => aplicarPropina(s.config.propinaPct / 100)}>{s.config.propinaPct}% {t('pedido.sugerida')}</button>}
          <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => aplicarPropina(0)}>{t('comun.quitar')}</button>
          {prop === null
            ? <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => setProp('15')}>{t('pedido.otraPct')}</button>
            : <>
              <input type="number" min="0" max="100" value={prop} style={{ width: 64 }} onChange={e => setProp(e.target.value)} />
              <button className="primary" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => { const v = Number(prop); if (v > 0) aplicarPropina(v / 100); else setProp(null) }}>{t('comun.ok')}</button>
              <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => setProp(null)}>✕</button>
            </>}
        </div>
      )}

      {/* descuento */}
      {(puedeDescuento || puedeDescuentoPin) && editable && (
        <div className="barra" style={{ fontSize: '.85rem' }}>
          <span>{t('pedido.descuento')}{c.descuento ? `: ${money(c.descuento)}` : ''}:</span>
          {desc === null ? <>
            <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => setDesc({ modo: 'monto', valor: '' })}>{t('pedido.aplicar')}</button>
            {c.descuento > 0 && <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => d({ t: 'extras', cuentaId: c.id, descuento: 0 })}>{t('comun.quitar')}</button>}
          </> : <>
            <select value={desc.modo} onChange={e => setDesc({ ...desc, modo: e.target.value })}><option value="monto">{t('comun.monto')}</option><option value="pct">{t('pedido.pctSubtotal')}</option></select>
            <input type="number" min="0" value={desc.valor} style={{ width: 80 }} onChange={e => setDesc({ ...desc, valor: e.target.value })} placeholder={desc.modo === 'pct' ? t('pedido.pEjemplo10') : t('pedido.pEjemplo15')} />
            <button className="primary" style={{ minHeight: 30, padding: '2px 8px' }} onClick={aplicarDescuento}>{t('comun.ok')}</button>
            <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => setDesc(null)}>✕</button>
            {!puedeDescuento && <small style={{ color: 'var(--mut)' }}>{t('pedido.avisoCajeroPin')}</small>}
          </>}
        </div>
      )}

      <div className="total"><span>{t('pedido.subtotal')}</span><b>{money(subtotal)}</b></div>
      {c.descuento > 0 && <div className="total"><span>{t('pedido.descuento')}</span><b>−{money(c.descuento)}</b></div>}
      {c.propina > 0 && <div className="total"><span>{t('pedido.propina')}</span><b>{money(c.propina)}</b></div>}
      <div className="total" style={{ borderTop: '2px solid var(--line)' }}><span>{t('pedido.totalPagar')}</span><b>{money(final)}</b></div>

      {/* cobro con pagos mixtos */}
      {pagos ? (
        <div className="barra" style={{ flexDirection: 'column', alignItems: 'stretch', background: 'var(--bg)', borderRadius: 10, padding: 8 }}>
          <b style={{ fontSize: '.85rem' }}>{t('pedido.pagosMixtos', { total: money(final) })}</b>
          {pagos.map((p, i) => (
            <div key={i} className="barra" style={{ margin: 0 }}>
              <select value={p.metodo} onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, metodo: e.target.value } : x))}>{METODOS.map(m => <option key={m} value={m}>{tOr('metodo.' + m, m)}</option>)}</select>
              <input type="number" min="0" step="0.01" value={p.monto} style={{ flex: 1 }} onChange={e => setPagos(ps => ps.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))} placeholder={t('comun.monto')} />
              {pagos.length > 1 && <button className="x" onClick={() => setPagos(ps => ps.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <div className="barra">
            <button className="ghost" style={{ minHeight: 30, padding: '2px 8px' }} onClick={() => setPagos(ps => [...ps, { metodo: 'qr', monto: '' }])}>{t('pedido.agregarLinea')}</button>
            <span className="sp" />
            {pendiente > 0 ? <small>{t('pedido.falta', { monto: money(pendiente) })}</small> : <small>{t('pedido.cambio', { monto: money(cambio) })}</small>}
          </div>
          <div className="barra">
            <button className="primary" disabled={pendiente > 0.009} onClick={confirmarCobro}>{t('pedido.confirmarCobro')}</button>
            <button className="ghost" onClick={() => setPagos(null)}>{t('comun.cancelar')}</button>
            {cambio > 0 && <button className="ghost" onClick={() => imprimir(false)}>{t('pedido.imprimirTicket')}</button>}
          </div>
        </div>
      ) : (
        <div className="barra">
          {editable && c.items.some(i => i.estado === 'pendiente') && <button className="primary" onClick={enviarCocina}>{t('pedido.enviarCocina')}</button>}
          {editable && c.items.length > 0 && <button className="ghost" onClick={() => d({ t: 'precuenta', cuentaId: c.id })}>{t('pedido.precuenta')}</button>}
          {c.estado === 'precuenta' && <button className="ghost" onClick={() => d({ t: 'reabrir', cuentaId: c.id })}>{t('pedido.reabrir')}</button>}
          {puede(rol, 'cobrar') && c.items.length > 0 && <button className="primary" onClick={iniciarCobro}>{t('pedido.cobrar')}</button>}
          {c.items.length > 0 && (print === null
            ? <button className="ghost" onClick={() => setPrint({ comanda: false, ancho: 32 })}>{t('pedido.imprimirTicket')}</button>
            : <>
              <button className="ghost" onClick={() => setPrint(p => ({ ...p, comanda: !p.comanda }))}>{print.comanda ? '☑' : '☐'} {t('pedido.comanda')}</button>
              <label style={{ fontSize: '.8rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{t('pedido.ancho')}
                <input type="number" min="20" max="60" value={print.ancho} style={{ width: 56 }} onChange={e => setPrint({ ...print, ancho: e.target.value })} /></label>
              <button className="primary" onClick={() => imprimir(print.comanda)}>{t('comun.imprimir')}</button>
              <button className="ghost" onClick={() => setPrint(null)}>✕</button>
            </>)}
        </div>
      )}
      <p style={{ color: 'var(--mut)', fontSize: '.8rem', margin: '6px 0 0' }}>{t('pedido.pagadoEstado', { pagado: money(pagadoCuenta(c)), estado: estadoVisto })}</p>
    </aside>
  )
}
