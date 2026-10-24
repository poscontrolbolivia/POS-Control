import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, totalFinal, pagadoCuenta, saldoCuenta } from '../../../context/StoreContext.jsx'
import { puede } from '../../../services/permissions'
import { MONEDA } from '../../../services/config'
import { useIdioma } from '../../../i18n/index.jsx'
import { imprimirCuenta } from '../../printing/Ticket.jsx'
import MesasResumen from '../hall/MesasResumen.jsx'
import OrderPanel from '../order/OrderPanel.jsx'
import { VerComprobante } from '../pago/ComprobanteQr.jsx'
import '../pago/ComprobanteQr.css'
import { sb } from '../../../services/supabaseClient.js'
import { armarReporte, descargarPdfCierre } from '../../../services/reporteCierre.js'
import { calcularResumen } from './calcularResumen.js'
import './CashPage.css'
import { round2, hora, limpiarMonto, numMonto } from '../../../services/format.js'
import { formatearMonto } from '../../../services/money.js'

export default function CashPage({ rol, sesion, onAbrirMesa }) {
  const { s, d, modo } = useStore()
  const { t, tOr } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol || '—'
  const moneda = s.config?.moneda || MONEDA
  const m = n => formatearMonto(n, moneda)
  const turno = s.caja.turno
  const numeroActual = s.caja.historial.length + 1

  const devDe = tu => (s.devoluciones || []).filter(x => (tu?.id && x.turnoId === tu.id) || (!x.turnoId && tu && x.pedidaEn >= tu.abiertoEn && (!tu.cerradoEn || x.pedidaEn <= tu.cerradoEn)))
  const devEstado = x => (x.confirmadaEn ? t('caja.devConfirmada', { quien: x.confirmadaPor || '—', hora: hora(x.confirmadaEn) }) : t('caja.devSinConfirmar'))
  const SeccionDev = ({ filas }) => (filas.length === 0 ? null : (
    <section className="caja-card caja-dev">
      <div className="caja-head"><h2>{t('caja.devSeccion')}</h2><span className="sp" /><b>{t('caja.devTotal', { monto: m(filas.reduce((a, x) => a + x.monto, 0)) })}</b></div>
      <ul className="caja-lista">
        {filas.map(x => (
          <li key={x.id} className={x.confirmadaEn ? '' : 'caja-dev-sin'}>
            <b>{x.qty}× {x.nombre}</b> · {x.mesa} · {m(x.monto)} · {x.area}
            <br /><small>{t('caja.devAnulo', { quien: x.pedidaPor || '—', hora: hora(x.pedidaEn) })} · {t('caja.devMotivo')}: {x.motivo}</small>
            <br /><small><b>{devEstado(x)}</b>{x.nota ? ` · ${x.nota}` : ''}</small>
          </li>
        ))}
      </ul>
    </section>
  ))

  // El nombre de la mesa ya viene completo («Mesa 2»); envolverlo en «Mesa {mesa}» duplicaba la palabra.
  const nombreCorto = c => c.canal === 'llevar'
    ? t('caja.llevarNumero', { n: c.numero ?? '—' }) + (c.clienteNombre ? ' · ' + c.clienteNombre : '')
    : c.tipo === 'directa'
    ? t('caja.ventaNumero', { n: c.numero ?? '—' })
    : (c.mesaTexto || (c.mesaIds || []).map(id => (s.mesas || []).find(m => m.id === id)?.nombre || id).join(', ') || '—')

  // Un pedido «para llevar» no tiene mesa, así que el mapa de MesasResumen nunca lo lista.
  // Sin esta lista la única forma de cobrarlo era pasarlo a una mesa, que no tiene sentido.
  const llevar = s.cuentas.filter(c => c.canal === 'llevar' && c.estado !== 'cerrada')
    .sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const estadoLlevar = c => (c.estado === 'precuenta' ? 'porcobrar' : (c.items || []).some(i => i.estado === 'enviado') ? 'enviada' : 'ocupada')
  // Mismo formato que la lista de mesas: dos tarjetas iguales, una por pedido, para no aprender dos vistas.
  const SeccionLlevar = ({ filas, onCobrar }) => (
    <section className="caja-card mr-bloque" aria-label={tOr('caja.llevarTitulo', 'Pedidos para llevar')}>
      <div className="caja-head mr-cab">
        <h2>🥡 {tOr('caja.llevarTitulo', 'Pedidos para llevar')}</h2>
        <span className="caja-hora">{filas.length}</span>
        <span className="sp" />
        <b>{m(filas.reduce((a, c) => a + saldoCuenta(c), 0))}</b>
      </div>
      <p className="caja-nota mr-ayuda">{tOr('caja.llevarAyuda', 'Aquí se cobran, sin pasarlos por una mesa. Toca uno para cobrarlo.')}</p>
      {filas.length ? (
        <div className="mr-lista">
          {filas.map(c => {
            const pagado = pagadoCuenta(c)
            return (
              <button type="button" key={c.id} className={'mr-item ' + estadoLlevar(c)} onClick={() => onCobrar(c)}>
                <b className="mr-nombre">{nombreCorto(c)}</b>
                <span className="mr-est">{tOr('estado.' + c.estado, c.estado)}</span>
                <small className="mr-importe">{m(saldoCuenta(c))}{pagado > 0.009 && <em className="abonado" title={tOr('salon.totalAbonado', 'Abonado')}>✓ {m(pagado)}</em>}</small>
                <small className="mr-quien">{t('caja.abrevItems', { n: (c.items || []).filter(i => i.estado !== 'anulado').reduce((a, i) => a + i.qty, 0) })}</small>
                <span className="mr-zona">{tOr('caja.llevarCobrar', 'Cobrar ›')}</span>
              </button>
            )
          })}
        </div>
      ) : <p className="caja-nota mr-vacio">{tOr('caja.llevarVacio', 'No hay pedidos para llevar abiertos; se toman en Salón → 🥡 Para llevar.')}</p>}
    </section>
  )

  const [fondo, setFondo] = useState('')
  const [mov, setMov] = useState(null)
  const [cierre, setCierre] = useState(null)
  const [pre, setPre] = useState(null)
  const [aviso, setAviso] = useState('')
  const avisoTimer = useRef(null)

  // Tocar una mesa o un pedido para llevar abre su cuenta en modo cobro AQUÍ MISMO, dentro de Caja:
  // al cobrar o volver, el cajero sigue en Caja sin pasar por el Salón.
  const [cobrando, setCobrando] = useState(null)
  const irSalon = (mesa, subcuenta) => { if (mesa?.id) setCobrando({ mesaId: mesa.id, subId: subcuenta?.id }); else window.location.hash = '#salon' }
  const irLlevar = c => { if (c?.id) setCobrando({ cuentaId: c.id }); else window.location.hash = '#salon' }
  const mesaCobro = cobrando?.mesaId ? s.mesas.find(x => x.id === cobrando.mesaId) : undefined
  const cuentaCobro = cobrando?.cuentaId ? s.cuentas.find(x => x.id === cobrando.cuentaId) : undefined
  // Tocar el chip de «2b» en la lista de mesas abre esa cuenta ya seleccionada, no la primera de la mesa.
  const subCobro = cobrando?.subId && s.cuentas.some(x => x.id === cobrando.subId && x.estado !== 'cerrada') ? cobrando.subId : undefined

  const avisar = msg => { setAviso(msg); clearTimeout(avisoTimer.current); avisoTimer.current = setTimeout(() => setAviso(''), 6000) }
  useEffect(() => () => clearTimeout(avisoTimer.current), [])

  const abiertas = s.cuentas.filter(c => c.estado !== 'cerrada')
  const heredadas = (turno?.heredadas || []).filter(id => abiertas.some(c => c.id === id)).length
  const resumen = useMemo(() => (turno ? calcularResumen(turno, s.cuentas) : null), [turno, s.cuentas])

  // Mesas y Para llevar son dos menús: antes salían apilados y, con la lista de llevar debajo,
  // el selector de salón del mapa quedaba fuera de la pantalla.
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem('pos-caja-panel') === 'llevar' ? 'llevar' : 'mesas' } catch { return 'mesas' } })
  const cambiarPanel = p => { setPanel(p); try { localStorage.setItem('pos-caja-panel', p) } catch { /* noop */ } }
  const paneles = (
    <>
      <div className="caja-pan" role="tablist" aria-label={tOr('caja.paneles', 'Qué se está cobrando')}>
        <button type="button" role="tab" aria-selected={panel === 'mesas'} className={'tab' + (panel === 'mesas' ? ' on' : '')} onClick={() => cambiarPanel('mesas')}>🪑 {tOr('caja.mesasTitulo', 'Mesas')}</button>
        <button type="button" role="tab" aria-selected={panel === 'llevar'} className={'tab' + (panel === 'llevar' ? ' on' : '')} onClick={() => cambiarPanel('llevar')}>🥡 {tOr('caja.llevarTab', 'Para llevar')} <b>{llevar.length}</b></button>
      </div>
      {panel === 'mesas'
        ? <MesasResumen mesas={s.mesas} zonas={s.zonas} cuentas={s.cuentas} onOpen={irSalon} />
        : <SeccionLlevar filas={llevar} onCobrar={irLlevar} />}
    </>
  )

  // Con el turno cerrado la vista de cobro también tiene que abrirse: si no, tocar una mesa o un
  // pedido para llevar no hacía nada y el cajero no llegaba ni a la cuenta ni al aviso de abrir el turno.
  const vistaCobro = cobrando && (
    <OrderPanel rol={rol} sesion={sesion} mesa={mesaCobro} cuenta={cuentaCobro} cuentaInicial={subCobro} cobro
      onEdicion={() => { const f = cobrando; setCobrando(null); onAbrirMesa?.(f) }}
      onClose={() => setCobrando(null)} />
  )

  const msgCierre = contado => {
    const dif = round2(contado - resumen.esperado)
    const base = Math.abs(dif) < 0.005
      ? t('caja.cierreCuadrado')
      : t('caja.cierreDiferencia', { tipo: dif > 0 ? t('caja.sobra') : t('caja.falta'), monto: m(Math.abs(dif)) })
    const sinConf = devDe(turno).filter(x => !x.confirmadaEn).length
    return sinConf ? `${t('caja.devAvisoCierre', { n: sinConf })} ${base}` : base
  }

  const abrirTurno = e => {
    e.preventDefault()
    d({ t: 'turno+', fondo: round2(numMonto(fondo)), usuario })
    setFondo('')
  }

  const agregarMov = e => {
    e.preventDefault()
    const monto = numMonto(mov.monto)
    if (!(monto > 0)) return avisar(t('caja.montoPositivo'))
    if (!mov.motivo.trim()) return avisar(t('caja.motivoObligatorio'))

    if (mov.tipo === 'egreso' && monto > resumen.esperado && !mov.alto) return setMov({ ...mov, alto: true })
    d({ t: 'caja-mov+', tipo: mov.tipo, monto: round2(monto), motivo: mov.motivo.trim() })
    setMov(null)
  }

  const cerrarTurno = e => {
    e.preventDefault()
    const contado = numMonto(cierre.contado)

    if (!cierre.pedirConf) return setCierre({ ...cierre, pedirConf: true })
    // El reporte se arma ANTES de cerrar (después el turno ya no está abierto) y se descarga al cerrar.
    const reporte = armarReporte({ turno, resumen, config: s.config, productos: s.productos, devoluciones: s.devoluciones || [], contado: round2(contado), cerradoPor: usuario, etiquetaCuenta: nombreCorto })
    d({ t: 'turno-', contado: round2(contado), usuario })
    setCierre(null)
    descargarPdf(reporte)
  }
  const descargarPdf = async reporte => {
    try { await descargarPdfCierre(reporte, { t, m, sb: modo === 'supabase' ? sb : null }) } catch { avisar(t('cierrePdf.error')) }
  }
  const pdfDelTurno = () => descargarPdf(armarReporte({ turno, resumen, config: s.config, productos: s.productos, devoluciones: s.devoluciones || [], contado: null, cerradoPor: usuario, etiquetaCuenta: nombreCorto }))

  const imprimirResumen = async () => {
    const { tickets, ventas } = resumen
    const cuentaSintetica = {
      tipo: 'directa', numero: numeroActual, mesaIds: [], estado: 'cerrada',
      abiertaPor: turno.abiertoPor, abiertaEn: turno.abiertoEn, cerradaEn: Date.now(),
      propina: 0, descuento: 0,
      items: tickets.map(c => ({
        nombre: `${nombreCorto(c)} ${t('caja.abrevItems', { n: (c.items || []).filter(i => i.estado !== 'anulado').reduce((acc, i) => acc + i.qty, 0) })}`,
        precio: round2(totalFinal(c)), qty: 1, estado: 'pendiente',
      })),
      pagos: Object.entries(ventas).filter(([, v]) => v > 0).map(([metodo, monto]) => ({ metodo, monto })),
    }
    const r = await imprimirCuenta({ cuenta: cuentaSintetica, config: s.config, titulo: t('caja.arqueoTitulo', { n: numeroActual }) })
    if (r === 'sin-impresora') avisar(t('caja.avisoSinImpresora'))
    else if (r === 'error') avisar(t('caja.avisoFalloImpresora'))
    const dv = devDe(turno)
    if (dv.length) {
      await imprimirCuenta({
        config: s.config, titulo: t('caja.devTitulo', { n: numeroActual }),
        cuenta: {
          tipo: 'directa', numero: numeroActual, mesaIds: [], estado: 'cerrada', abiertaPor: turno.abiertoPor, abiertaEn: turno.abiertoEn, cerradaEn: Date.now(), propina: 0, descuento: 0, pagos: [],
          items: dv.map(x => ({ nombre: `${x.qty}x ${x.nombre} · ${x.mesa} · ${x.confirmadaEn ? t('caja.devOk', { quien: x.confirmadaPor || '—' }) : t('caja.devSinConfirmar')}`, precio: round2(x.monto), qty: 1, estado: 'pendiente' })),
        },
      })
    }
  }

  if (!turno) {
    return (
      <div className="caja">
        {aviso && <div className="caja-aviso" role="status">{aviso}<button type="button" className="caja-aviso-x" onClick={() => setAviso('')} aria-label={t('comun.cancelar')}>✕</button></div>}
        {paneles}
        {vistaCobro}
        <section className="caja-card">
          <div className="caja-head"><h2>{t('caja.titulo')}</h2><span className="caja-num cerrado">{t('caja.cerrado')}</span></div>
          {puede(rol, 'abrir_turno') ? (
            <form className="caja-form" onSubmit={abrirTurno}>
              <label>{t('caja.fondoLabel')}
                <input name="fondo" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00"
                  value={fondo} onChange={e => setFondo(limpiarMonto(e.target.value))}
                  onBlur={() => fondo !== '' && setFondo(numMonto(fondo).toFixed(2))} onFocus={e => e.target.select()} />
              </label>
              <button className="success" type="submit">{t('caja.abrirTurno')}</button>
            </form>
          ) : <p className="caja-nota">{t('caja.sinPermisoAbrir', { rol })}</p>}
        </section>

        {s.caja.historial.map(h => <SeccionDev key={'dev' + h.id} filas={devDe(h)} />)}
      </div>
    )
  }

  const dif = round2((Number(cierre?.contado) || 0) - resumen.esperado)
  const difPre = round2((Number(pre?.contado) || 0) - resumen.esperado)
  return (
    <div className="caja">
      {aviso && <div className="caja-aviso" role="status">{aviso}<button type="button" className="caja-aviso-x" onClick={() => setAviso('')} aria-label={t('comun.cancelar')}>✕</button></div>}
      {s.caja.otros?.length > 0 && (
        <p className="caja-nota">{t('caja.otrosTurnos', { lista: s.caja.otros.map(x => `${x.abiertoPor} (${new Date(x.abiertoEn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`).join(', ') })}</p>
      )}
      {paneles}
      {vistaCobro}
      <section className="caja-card caja-turno">
        <div className="caja-head">
          <h2>{t('caja.turnoNumero', { n: numeroActual })}</h2>
          <span className="caja-num abierto">{t('caja.abierto')}</span>
          <span className="sp" />
          <span className="caja-hora">{t('caja.desdeInfo', { fecha: new Date(turno.abiertoEn).toLocaleString(), usuario: turno.abiertoPor })}</span>
        </div>
        <p className="caja-nota">{tOr('caja.turnoAyuda', 'Turno = el tiempo que la gaveta está abierta: fondo + cobrado + ingresos − egresos = Esperado.')}</p>
        <div className="caja-stats">
          <div className="caja-stat"><span>{t('caja.stFondo')}</span><b>{m(turno.fondo)}</b></div>
          <div className="caja-stat"><span>{t('caja.vendido')}</span><b>{m(resumen.vendido)}</b></div>
          <div className="caja-stat"><span>{t('caja.stEfectivo')}</span><b>{m(resumen.ventas.efectivo)}</b></div>
          <div className="caja-stat"><span>{t('caja.stQr')}</span><b>{m(resumen.ventas.qr)}</b></div>
          <div className="caja-stat"><span>{t('caja.stTarjeta')}</span><b>{m(resumen.ventas.tarjeta)}</b></div>
          {resumen.ventas.otros > 0 && <div className="caja-stat"><span>{t('caja.stOtros')}</span><b>{m(resumen.ventas.otros)}</b></div>}
          <div className="caja-stat"><span>{t('caja.stIngresos')}</span><b>{m(resumen.ingresos)}</b></div>
          <div className="caja-stat"><span>{t('caja.stEgresos')}</span><b>{m(resumen.egresos)}</b></div>
          <div className="caja-stat esperado"><span>{t('caja.stEsperado')}</span><b>{m(resumen.esperado)}</b></div>
        </div>
        {heredadas > 0 && <p className="caja-nota">↩ {t('caja.heredadas', { n: heredadas })}</p>}
        {Object.keys(resumen.porUsuario).length > 0 && (
          <div className="caja-usuarios">
            <b>{t('caja.porUsuario')}</b>
            {Object.entries(resumen.porUsuario).map(([u, x]) => (
              <span key={u} className="caja-user-chip">{u} · {x.n} · <b>{m(x.total)}</b></span>
            ))}
          </div>
        )}
      </section>

      <div className="caja-dos">
        <section className="caja-card">
          <div className="caja-head"><h2>{t('caja.movimientos')}</h2><span className="sp" />
            {puede(rol, 'movimiento_caja') && !mov && <>
              <button className="success" onClick={() => setMov({ tipo: 'ingreso', monto: '', motivo: '' })}>{t('caja.masIngreso')}</button>
              <button className="danger solid" onClick={() => setMov({ tipo: 'egreso', monto: '', motivo: '' })}>{t('caja.masEgreso')}</button>
            </>}
          </div>
          <p className="caja-nota">{tOr('caja.movimientosAyuda', 'Dinero que entra o sale sin ser venta (compras, retiros); cuenta en el arqueo.')}</p>
          {mov && (
            <form className="caja-form" onSubmit={agregarMov}>
              <span className={'caja-mov ' + mov.tipo}>{mov.tipo === 'ingreso' ? t('caja.ingreso') : t('caja.egreso')}</span>
              <label>{t('comun.monto')}
                <input name="monto" type="text" inputMode="decimal" autoComplete="off" autoFocus placeholder="0.00"
                  value={mov.monto} onChange={e => setMov({ ...mov, monto: limpiarMonto(e.target.value), alto: false })}
                  onBlur={() => mov.monto !== '' && setMov({ ...mov, monto: numMonto(mov.monto).toFixed(2) })} onFocus={e => e.target.select()} />
              </label>
              <label>{t('caja.motivo')}
                <input name="motivo-ejemplo" maxLength={60} placeholder={t('caja.motivoEjemplo')}
                  value={mov.motivo} onChange={e => setMov({ ...mov, motivo: e.target.value })} />
              </label>
              {mov.alto ? (
                <div className="caja-conf" role="status">
                  <span>{t('caja.egresoAlto', { monto: m(Number(mov.monto)), esperado: m(resumen.esperado) })}</span>
                  <button className="danger solid" type="submit">{t('comun.confirmar')}</button>
                  <button className="danger" type="button" onClick={() => setMov({ ...mov, alto: false })}>{t('comun.cancelar')}</button>
                </div>
              ) : (
                <>
                  <button className="primary" type="submit">{t('comun.guardar')}</button>
                  <button className="danger" type="button" onClick={() => setMov(null)}>{t('comun.cancelar')}</button>
                </>
              )}
            </form>
          )}
          <ul className="caja-lista">
            {(turno.movimientos || []).map(x => (
              <li key={x.id}>
                <span className={'caja-mov ' + x.t}>{x.t === 'ingreso' ? '+' : '−'} {x.t === 'ingreso' ? t('caja.ingreso') : t('caja.egreso')}</span>
                <span className="caja-motivo">{x.motivo}</span>
                <span className="sp" /><b>{m(x.monto)}</b>
              </li>
            ))}
            {!(turno.movimientos || []).length && !mov && <li className="caja-vacio">{t('caja.sinMovs')}</li>}
          </ul>
        </section>

        <section className="caja-card">
          <div className="caja-head"><h2>{t('caja.ticketsTurno')}</h2><span className="sp" />
            <button className="ghost" onClick={pdfDelTurno} disabled={!resumen.tickets.length}>📄 {t('cierrePdf.boton')}</button>
            <button className="primary" onClick={imprimirResumen} disabled={!resumen.tickets.length}>{t('caja.imprimirResumen')}</button>
          </div>
          <p className="caja-nota">{tOr('caja.ticketsAyuda', 'Cuentas ya cobradas en este turno, de mesas y de mostrador.')}</p>
          <ul className="caja-lista">
            {resumen.tickets.map(c => (
              <li key={c.id}>
                <b>{nombreCorto(c)}</b>
                <span className="caja-hora">{new Date(c.cerradaEn).toLocaleTimeString()}</span>
                <span className="sp" />
                <span className="caja-pagos">{(c.pagos || []).map(p => nombreMetodoCorto(p.metodo, t)).join(' + ')}</span>
                {(c.pagos || []).map((p, k) => <VerComprobante key={k} valor={p.comprobante} />)}
                <b>{m(totalFinal(c))}</b>
              </li>
            ))}
            {!resumen.tickets.length && <li className="caja-vacio">{t('caja.sinTickets')}</li>}
          </ul>
        </section>
      </div>

      <section className="caja-card caja-prearqueo">
        <div className="caja-head">
          <h2>{tOr('caja.preArqueo', 'Pre-arqueo')}</h2>
          <span className="sp" />
          {!pre && <button className="primary" type="button" onClick={() => setPre({ contado: '' })}>{tOr('caja.preArqueo', 'Pre-arqueo')}</button>}
        </div>
        {!pre ? (
          <p className="caja-nota">{tOr('caja.preArqueoAyuda', 'Cuenta la caja sin cerrar el turno: compara lo contado con lo esperado.')}</p>
        ) : (
          <div className="caja-form">
            <p className="caja-nota">{t('caja.esperadoA')} <b>{m(resumen.esperado)}</b> {t('caja.esperadoB')}</p>
            <label>{t('caja.contadoLabel')}
              <input name="contado" type="text" inputMode="decimal" autoComplete="off" autoFocus placeholder="0.00"
                value={pre.contado} onChange={e => setPre({ ...pre, contado: limpiarMonto(e.target.value) })}
                onBlur={() => pre.contado !== '' && setPre({ ...pre, contado: numMonto(pre.contado).toFixed(2) })} onFocus={e => e.target.select()} />
            </label>
            <span className={'caja-diff grande ' + (pre.contado === '' ? '' : Math.abs(difPre) < 0.005 ? 'ok' : difPre > 0 ? 'sobra' : 'falta')}>
              {pre.contado === '' ? '…' : Math.abs(difPre) < 0.005 ? t('caja.cuadrado') : difPre > 0 ? t('caja.sobraM', { monto: m(difPre) }) : t('caja.faltaM', { monto: m(-difPre) })}
            </span>
            <button className="primary" type="button" onClick={imprimirResumen} disabled={!resumen.tickets.length}>{t('caja.imprimirResumen')}</button>
            <button className="danger" type="button" onClick={() => setPre(null)}>{t('comun.cancelar')}</button>
          </div>
        )}
      </section>

      <section className="caja-card caja-cierre">
        <div className="caja-head"><h2>{t('caja.cierreTitulo')}</h2></div>
        {puede(rol, 'cerrar_turno') && <p className="caja-nota">{tOr('caja.cierreAyuda', 'Cuenta lo que hay en la gaveta y compáralo con el Esperado; al confirmar se descarga el reporte PDF.')}</p>}
        {!puede(rol, 'cerrar_turno') ? <p className="caja-nota">{t('caja.sinPermisoCerrar', { rol })}</p>
          : !cierre
            ? <>
              <div className="caja-traspaso">
                <b>{abiertas.length ? t('caja.traspasoTitulo', { n: abiertas.length }) : t('caja.sinTraspaso')}</b>
                {abiertas.length > 0 && <>
                  <ul>{abiertas.map(c => <li key={c.id}>{nombreCorto(c)} <b>{m(saldoCuenta(c))}</b>{pagadoCuenta(c) > 0.009 && <em className="caja-abonado">{t('caja.abonado', { monto: m(pagadoCuenta(c)) })}</em>}</li>)}</ul>
                  <small>{t('caja.traspasoNota')}</small>
                </>}
              </div>
              <p className="caja-nota">{t('caja.esperadoA')} <b>{m(resumen.esperado)}</b> {t('caja.esperadoB')}</p>
              <button className="danger solid" onClick={() => setCierre({ contado: '' })}>{t('caja.cerrarTurno')}</button>
            </>
            : (
              <form className="caja-form" onSubmit={cerrarTurno}>
                <label>{t('caja.contadoLabel')}
                  <input name="contado" type="text" inputMode="decimal" autoComplete="off" autoFocus placeholder="0.00"
                    value={cierre.contado} onChange={e => setCierre({ ...cierre, contado: limpiarMonto(e.target.value), pedirConf: false })}
                    onBlur={() => cierre.contado !== '' && setCierre({ ...cierre, contado: numMonto(cierre.contado).toFixed(2) })} onFocus={e => e.target.select()} />
                </label>
                <span className={'caja-diff grande ' + (Math.abs(dif) < 0.005 ? 'ok' : dif > 0 ? 'sobra' : 'falta')}>
                  {cierre.contado === '' ? '…' : Math.abs(dif) < 0.005 ? t('caja.cuadrado') : dif > 0 ? t('caja.sobraM', { monto: m(dif) }) : t('caja.faltaM', { monto: m(-dif) })}
                </span>
                {cierre.pedirConf ? (
                  <div className="caja-conf" role="status">
                    <span>{msgCierre(numMonto(cierre.contado))}</span>
                    <button className="danger solid" type="submit">{t('comun.confirmar')}</button>
                    <button className="danger" type="button" onClick={() => setCierre({ ...cierre, pedirConf: false })}>{t('comun.cancelar')}</button>
                  </div>
                ) : (
                  <>
                    <button className="danger solid" type="submit">{t('caja.confirmarCierre')}</button>
                    <button className="danger" type="button" onClick={() => setCierre(null)}>{t('comun.cancelar')}</button>
                  </>
                )}
              </form>
            )}
      </section>
    </div>
  )
}

const nombreMetodoCorto = (met, t) => (
  { efectivo: t('caja.cortoEfectivo'), qr: t('caja.cortoQr'), tarjeta: t('caja.cortoTarjeta') }[met] || met || '?'
)
