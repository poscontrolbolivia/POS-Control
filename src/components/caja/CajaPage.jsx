// Caja: apertura/cierre de turno, arqueo e ingresos/egresos (IA-2b).
import { useMemo, useState } from 'react'
import { useStore, totalFinal } from '../../services/store.jsx'
import { puede } from '../../services/permisos'
import { MONEDA } from '../../config'
import { useIdioma } from '../../i18n/index.jsx'
import { imprimirTicket } from '../ticket/Ticket.jsx'
import './CajaPage.css'

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

// Ventas y esperado de un turno a partir de las cuentas cerradas dentro de su rango.
// Convención de pagos: {metodo, monto} con monto = importe aplicado a la cuenta (el cambio va en p.cambio).
function calcularResumen(turno, cuentas) {
  const fin = turno.cerradoEn ?? Date.now()
  const tickets = cuentas.filter(c => c.estado === 'cerrada' && (c.pagos || []).length > 0 && (c.cerradaEn || 0) >= turno.abiertoEn && (c.cerradaEn || 0) <= fin)
  const ventas = { efectivo: 0, qr: 0, tarjeta: 0, otros: 0 }
  tickets.forEach(c => (c.pagos || []).forEach(p => {
    const k = ['efectivo', 'qr', 'tarjeta'].includes(p.metodo) ? p.metodo : 'otros'
    ventas[k] = round2(ventas[k] + (Number(p.monto) || 0))
  }))
  const movs = turno.movimientos || []
  const ingresos = round2(movs.filter(x => x.t === 'ingreso').reduce((acc, x) => acc + (Number(x.monto) || 0), 0))
  const egresos = round2(movs.filter(x => x.t === 'egreso').reduce((acc, x) => acc + (Number(x.monto) || 0), 0))
  const esperado = round2((Number(turno.fondo) || 0) + ventas.efectivo + ingresos - egresos)
  const vendido = round2(tickets.reduce((acc, c) => acc + totalFinal(c), 0))
  const porUsuario = {}
  tickets.forEach(c => { const u = c.cerradaPor || '—'; const x = porUsuario[u] || { n: 0, total: 0 }; porUsuario[u] = { n: x.n + 1, total: round2(x.total + totalFinal(c)) } })
  return { tickets, ventas, ingresos, egresos, esperado, vendido, porUsuario }
}

export default function CajaPage({ rol, sesion }) {
  const { s, d } = useStore()
  const { t } = useIdioma()
  const usuario = sesion?.usuario || sesion?.nombre || rol || '—'
  const moneda = s.config?.moneda || MONEDA
  const m = n => `${moneda} ${round2(n).toFixed(2)}`
  const turno = s.caja.turno
  const numeroActual = s.caja.historial.length + 1

  // Nombre corto de una cuenta para las listas y para el ticket de arqueo (va al papel,
  // así que también se traduce).
  const nombreCorto = c => c.tipo === 'directa'
    ? t('caja.ventaNumero', { n: c.numero ?? '—' })
    : t('caja.mesaNumero', { mesa: c.mesaTexto || (c.mesaIds || []).join(', ') || '—' })

  const [fondo, setFondo] = useState('')
  const [mov, setMov] = useState(null)      // {tipo, monto, motivo}
  const [cierre, setCierre] = useState(null) // {contado}

  const abiertas = s.cuentas.filter(c => c.estado !== 'cerrada') // pasan al turno siguiente al cerrar
  const heredadas = (turno?.heredadas || []).filter(id => abiertas.some(c => c.id === id)).length
  const resumen = useMemo(() => (turno ? calcularResumen(turno, s.cuentas) : null), [turno, s.cuentas])

  const abrirTurno = e => {
    e.preventDefault()
    const f = Number(fondo)
    if (!Number.isFinite(f) || f < 0) return alert(t('caja.fondoInvalido'))
    d({ t: 'turno+', fondo: round2(f), usuario })
    setFondo('')
  }

  const agregarMov = e => {
    e.preventDefault()
    const monto = Number(mov.monto)
    if (!(monto > 0)) return alert(t('caja.montoPositivo'))
    if (!mov.motivo.trim()) return alert(t('caja.motivoObligatorio'))
    if (mov.tipo === 'egreso' && monto > resumen.esperado) {
      if (!confirm(t('caja.egresoAlto', { monto: m(monto), esperado: m(resumen.esperado) }))) return
    }
    d({ t: 'caja-mov+', tipo: mov.tipo, monto: round2(monto), motivo: mov.motivo.trim() })
    setMov(null)
  }

  const cerrarTurno = e => {
    e.preventDefault()
    const contado = Number(cierre.contado)
    if (!Number.isFinite(contado) || contado < 0) return alert(t('caja.contadoInvalido'))
    const dif = round2(contado - resumen.esperado)
    const msg = Math.abs(dif) < 0.005
      ? t('caja.cierreCuadrado')
      : t('caja.cierreDiferencia', { tipo: dif > 0 ? t('caja.sobra') : t('caja.falta'), monto: m(Math.abs(dif)) })
    if (!confirm(msg)) return
    d({ t: 'turno-', contado: round2(contado), usuario }) // el reducer usa la clave `contado`
    setCierre(null)
  }

  const imprimirResumen = () => {
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
    imprimirTicket({ cuenta: cuentaSintetica, config: s.config, titulo: t('caja.arqueoTitulo', { n: numeroActual }) })
  }

  // ── Sin turno abierto: tarjeta de apertura + historial breve ──────────────
  if (!turno) {
    return (
      <div className="caja">
        <section className="caja-card">
          <div className="caja-head"><h2>{t('caja.titulo')}</h2><span className="caja-num cerrado">{t('caja.cerrado')}</span></div>
          {puede(rol, 'abrir_turno') ? (
            <form className="caja-form" onSubmit={abrirTurno}>
              <label>{t('caja.fondoLabel')}
                <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                  value={fondo} onChange={e => setFondo(e.target.value)} />
              </label>
              <button className="success" type="submit">{t('caja.abrirTurno')}</button>
            </form>
          ) : <p className="caja-nota">{t('caja.sinPermisoAbrir', { rol })}</p>}
        </section>

        {s.caja.historial.length > 0 && (
          <section className="caja-card">
            <div className="caja-head"><h2>{t('caja.historial')}</h2></div>
            <ul className="caja-lista">
              {s.caja.historial.map((h, i) => {
                const r = calcularResumen(h, s.cuentas)
                const dif = round2((Number(h.contado) || 0) - r.esperado)
                return (
                  <li key={h.id}>
                    <b>{t('caja.turnoNumero', { n: s.caja.historial.length - i })}</b>
                    <span className="caja-hora">{new Date(h.cerradoEn || h.abiertoEn).toLocaleString()}</span>
                    <span className="sp" />
                    {h.traspaso?.length > 0 && <span className="caja-hora">{t('caja.traspasoHist', { n: h.traspaso.length })}</span>}
                    <span>{t('caja.vendidoM', { monto: m(r.vendido) })}</span>
                    <span className={'caja-diff ' + (Math.abs(dif) < 0.005 ? 'ok' : dif > 0 ? 'sobra' : 'falta')}>
                      {Math.abs(dif) < 0.005 ? t('caja.cuadrado') : dif > 0 ? t('caja.sobraM', { monto: m(dif) }) : t('caja.faltaM', { monto: m(-dif) })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    )
  }

  // ── Turno abierto ─────────────────────────────────────────────────────────
  const dif = round2((Number(cierre?.contado) || 0) - resumen.esperado)
  return (
    <div className="caja">
      <section className="caja-card caja-turno">
        <div className="caja-head">
          <h2>{t('caja.turnoNumero', { n: numeroActual })}</h2>
          <span className="caja-num abierto">{t('caja.abierto')}</span>
          <span className="sp" />
          <span className="caja-hora">{t('caja.desdeInfo', { fecha: new Date(turno.abiertoEn).toLocaleString(), usuario: turno.abiertoPor })}</span>
        </div>
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
              <button className="orange" onClick={() => setMov({ tipo: 'egreso', monto: '', motivo: '' })}>{t('caja.masEgreso')}</button>
            </>}
          </div>
          {mov && (
            <form className="caja-form" onSubmit={agregarMov}>
              <span className={'caja-mov ' + mov.tipo}>{mov.tipo === 'ingreso' ? t('caja.ingreso') : t('caja.egreso')}</span>
              <label>{t('comun.monto')}
                <input type="number" min="0.01" step="0.01" inputMode="decimal" autoFocus
                  value={mov.monto} onChange={e => setMov({ ...mov, monto: e.target.value })} />
              </label>
              <label>{t('caja.motivo')}
                <input maxLength={60} placeholder={t('caja.motivoEjemplo')}
                  value={mov.motivo} onChange={e => setMov({ ...mov, motivo: e.target.value })} />
              </label>
              <button className="primary" type="submit">{t('comun.guardar')}</button>
              <button className="ghost" type="button" onClick={() => setMov(null)}>{t('comun.cancelar')}</button>
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
            <button className="primary" onClick={imprimirResumen} disabled={!resumen.tickets.length}>{t('caja.imprimirResumen')}</button>
          </div>
          <ul className="caja-lista">
            {resumen.tickets.map(c => (
              <li key={c.id}>
                <b>{nombreCorto(c)}</b>
                <span className="caja-hora">{new Date(c.cerradaEn).toLocaleTimeString()}</span>
                <span className="sp" />
                <span className="caja-pagos">{(c.pagos || []).map(p => nombreMetodoCorto(p.metodo, t)).join(' + ')}</span>
                <b>{m(totalFinal(c))}</b>
              </li>
            ))}
            {!resumen.tickets.length && <li className="caja-vacio">{t('caja.sinTickets')}</li>}
          </ul>
        </section>
      </div>

      <section className="caja-card caja-cierre">
        <div className="caja-head"><h2>{t('caja.cierreTitulo')}</h2></div>
        {!puede(rol, 'cerrar_turno') ? <p className="caja-nota">{t('caja.sinPermisoCerrar', { rol })}</p>
          : !cierre
            ? <>
              <div className="caja-traspaso">
                <b>{abiertas.length ? t('caja.traspasoTitulo', { n: abiertas.length }) : t('caja.sinTraspaso')}</b>
                {abiertas.length > 0 && <>
                  <ul>{abiertas.map(c => <li key={c.id}>{nombreCorto(c)} <b>{m(totalFinal(c))}</b></li>)}</ul>
                  <small>{t('caja.traspasoNota')}</small>
                </>}
              </div>
              <p className="caja-nota">{t('caja.esperadoA')} <b>{m(resumen.esperado)}</b> {t('caja.esperadoB')}</p>
              <button className="danger solid" onClick={() => setCierre({ contado: '' })}>{t('caja.cerrarTurno')}</button>
            </>
            : (
              <form className="caja-form" onSubmit={cerrarTurno}>
                <label>{t('caja.contadoLabel')}
                  <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus placeholder="0.00"
                    value={cierre.contado} onChange={e => setCierre({ ...cierre, contado: e.target.value })} />
                </label>
                <span className={'caja-diff grande ' + (Math.abs(dif) < 0.005 ? 'ok' : dif > 0 ? 'sobra' : 'falta')}>
                  {cierre.contado === '' ? '…' : Math.abs(dif) < 0.005 ? t('caja.cuadrado') : dif > 0 ? t('caja.sobraM', { monto: m(dif) }) : t('caja.faltaM', { monto: m(-dif) })}
                </span>
                <button className="danger solid" type="submit">{t('caja.confirmarCierre')}</button>
                <button className="ghost" type="button" onClick={() => setCierre(null)}>{t('comun.cancelar')}</button>
              </form>
            )}
      </section>
    </div>
  )
}

// Abreviaturas de método para la lista compacta de tickets (caben en una línea).
const nombreMetodoCorto = (met, t) => (
  { efectivo: t('caja.cortoEfectivo'), qr: t('caja.cortoQr'), tarjeta: t('caja.cortoTarjeta') }[met] || met || '?'
)
