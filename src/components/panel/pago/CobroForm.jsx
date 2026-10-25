import { useEffect, useMemo, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { useStore } from '../../../context/StoreContext.jsx'
import { MONEDA } from '../../../services/config'
import { formatearMonto } from '../../../services/money.js'
import { round2, limpiarMonto, numMonto } from '../../../services/format.js'
import { cargarTrabajadores, trabajadoresEnCache } from '../../../services/trabajadores.js'
import { precalcularCambio } from '../../printing/Ticket.jsx'
import { etiquetaFiscal, pideDatosFiscales } from '../../../services/fiscal.js'
import ComprobanteQr from './ComprobanteQr.jsx'
import PagoQrCard from './PagoQrCard.jsx'
import './ComprobanteQr.css'
import '../quicksale/QuickSalePage.css'

// Reparte lo recibido sobre el total: lo que sobra en efectivo es cambio. Lo usan Salón, Caja y Venta directa.
export function imputarPagos(lineas, total) {
  let saldo = round2(total)
  const pagos = []
  let cambio = 0
  ;(lineas || []).forEach(l => {
    const n = round2(numMonto(l.monto))
    if (n <= 0) return
    const aplica = round2(Math.min(n, saldo))
    const devuelto = l.metodo === 'efectivo' ? round2(n - aplica) : 0
    if (aplica > 0) pagos.push({ metodo: l.metodo, monto: aplica, recibido: n, cambio: devuelto, ...(l.metodo === 'qr' && l.comprobante ? { comprobante: l.comprobante } : {}), ...(l.metodo === 'cxc' && l.trabajador_id ? { trabajador_id: l.trabajador_id, trabajador_nombre: l.trabajador_nombre } : {}) })
    cambio = round2(cambio + devuelto)
    saldo = round2(saldo - aplica)
  })
  return { pagos, cambio, saldo }
}

// Formas de pago poco frecuentes: van detrás del botón «⋯».
export const METODOS_EXTRA = ['cheque', 'vale', 'cxc', 'otro']
// Una cuenta por cobrar siempre se asigna a un trabajador registrado: sin él no se puede cobrar.
export const cobroInvalido = (lineas, tr) => ((lineas || []).some(l => l.metodo === 'cxc' && numMonto(l.monto) > 0 && !l.trabajador_id) ? tr('venta.cxcElegir') : '')

export const cobroNuevo = (extra = {}) => ({ lineas: [{ metodo: 'efectivo', monto: '' }], imprimir: true, comanda: true, fiscal: { nombre: '', numero: '', correo: '' }, ...extra })

// Menú de cobro ÚNICO: el mismo en Salón, Caja y Venta directa.
// El padre guarda `cobro` ({ lineas, imprimir, comanda }) y confirma; esto solo lo dibuja.
export default function CobroForm({ cobro, onChange, total, config, mostrarComanda = false, children }) {
  const { t } = useIdioma()
  const { s: tienda, modo, sesion } = useStore()
  const moneda = config?.moneda || MONEDA
  const m = n => formatearMonto(n, moneda)
  const [masAbierto, setMasAbierto] = useState(-1)
  const [remotos, setRemotos] = useState(trabajadoresEnCache)
  const [errTrab, setErrTrab] = useState('')
  const [intento, setIntento] = useState(0)
  const hayCxc = cobro.lineas.some(l => l.metodo === 'cxc')
  useEffect(() => {
    if (!hayCxc || modo !== 'supabase') return undefined
    let vivo = true
    setErrTrab('')
    cargarTrabajadores().then(v => { if (vivo) setRemotos(v) }).catch(e => { if (vivo) setErrTrab(String(e?.message || e)) })
    return () => { vivo = false }
  }, [hayCxc, modo, intento])
  // Siempre sale al menos quien está dentro del sistema, aunque la lista del servidor tarde o falle.
  const trabajadores = useMemo(() => {
    const base = modo === 'supabase'
      ? remotos
      : [
        ...(tienda?.usuariosDemo || []).map(u => ({ id: u.usuario, nombre: u.nombre || u.usuario, rol: u.rol, acceso: true })),
        ...(tienda?.personalDemo || []).map(p => ({ id: p.id, nombre: p.nombre, rol: p.cargo || 'personal', acceso: false })),
      ]
    const yoId = modo === 'supabase' ? sesion?.usuarioId : sesion?.usuario
    if (!yoId || base.some(w => w.id === yoId)) return base
    return [{ id: yoId, nombre: sesion?.nombre || sesion?.usuario || '', rol: sesion?.rol || '', acceso: true }, ...base]
  }, [modo, remotos, tienda?.usuariosDemo, tienda?.personalDemo, sesion?.usuarioId, sesion?.usuario, sesion?.nombre, sesion?.rol])
  const esYo = w => w.id === (modo === 'supabase' ? sesion?.usuarioId : sesion?.usuario)
  const setLinea = (i, cambios) => onChange({ ...cobro, lineas: cobro.lineas.map((l, j) => (j === i ? { ...l, ...cambios } : l)) })
  // Por defecto el monto es el total de la cuenta, para cobrar rápido en efectivo; si el cliente da otro
  // monto se corrige a mano. Se mantiene al día si el total cambia, mientras nadie lo haya tocado.
  const primera = cobro.lineas[0]
  useEffect(() => {
    if (cobro.lineas.length !== 1 || !primera || primera.tocado || !(total > 0)) return
    const v = String(round2(total))
    if (primera.monto !== v) onChange({ ...cobro, lineas: [{ ...primera, monto: v }] })
  }, [total, cobro.lineas.length, primera?.tocado, primera?.monto])
  const agregarLinea = () => {
    if (cobro.lineas.length >= 2) return
    // Con dos pagos el monto de la primera línea lo decide quien cobra: se vacía el valor por defecto.
    const lineas = cobro.lineas.map((l, j) => (j === 0 && !l.tocado ? { ...l, monto: '', tocado: true } : l))
    const aplicado = lineas.reduce((acc, l) => acc + (numMonto(l.monto) || 0), 0)
    onChange({ ...cobro, lineas: [...lineas, { metodo: 'qr', monto: String(Math.max(0, round2(total - aplicado))) }] })
  }
  const cambioPreview = precalcularCambio(cobro.lineas.map(l => ({ ...l, monto: numMonto(l.monto) })), total)
  const pagadoPreview = round2(cobro.lineas.reduce((acc, l) => acc + (numMonto(l.monto) || 0), 0))
  const falta = round2(total - Math.min(pagadoPreview, total))
  const fiscal = cobro.fiscal || { nombre: '', numero: '', correo: '' }
  const setFiscal = (k, v) => onChange({ ...cobro, fiscal: { ...fiscal, [k]: v } })

  return (
    <div className="vd-pagos">
      <div className="vd-total"><span>{t('venta.total')}</span><b>{m(total)}</b></div>
      {children}
      {cobro.lineas.map((l, i) => (
        <div className="vd-pago" key={i}>
          <div className="vd-metodos">
            {[['efectivo', t('venta.metodoEfectivo')], ['qr', t('venta.metodoQr')], ['tarjeta', t('venta.metodoTarjeta')]].map(([met, label]) => (
              <button key={met} type="button" className={l.metodo === met ? 'vd-metodo on' : 'vd-metodo'}
                onClick={() => { setMasAbierto(-1); setLinea(i, { metodo: met }) }}>{label}</button>
            ))}
            <button type="button" className={METODOS_EXTRA.includes(l.metodo) ? 'vd-metodo on' : 'vd-metodo'} aria-expanded={masAbierto === i}
              title={t('venta.metodoMas')} aria-label={t('venta.metodoMas')} onClick={() => setMasAbierto(masAbierto === i ? -1 : i)}>
              {METODOS_EXTRA.includes(l.metodo) ? t('metodo.' + l.metodo) : '⋯'}
            </button>
          </div>
          {masAbierto === i && (
            <div className="vd-mas" role="group" aria-label={t('venta.metodoMas')}>
              {METODOS_EXTRA.map(met => (
                <button key={met} type="button" className={l.metodo === met ? 'vd-metodo on' : 'vd-metodo'}
                  onClick={() => { setMasAbierto(-1); setLinea(i, { metodo: met }) }}>{t('metodo.' + met)}</button>
              ))}
            </div>
          )}
          {l.metodo === 'cxc' && (
            <label className="vd-monto">{t('venta.cxcTrabajador')}
              <select name="cxc-trabajador" value={l.trabajador_id || ''}
                onChange={e => { const x = trabajadores.find(w => w.id === e.target.value); setLinea(i, { trabajador_id: x?.id || '', trabajador_nombre: x?.nombre || '' }) }}>
                <option value="">{t('venta.cxcElegir')}</option>
                {trabajadores.map(w => <option key={w.id} value={w.id}>{w.nombre}{esYo(w) ? ` · ${t('venta.cxcYo')}` : (!w.acceso && w.rol ? ` · ${w.rol}` : '')}</option>)}
              </select>
              {errTrab && <small className="adm-msg warn">{t('venta.cxcErrorLista')} <button type="button" className="ghost" onClick={() => setIntento(n => n + 1)}>{t('venta.cxcReintentar')}</button></small>}
            </label>
          )}
          <label className="vd-monto">{t('venta.recibido')}
            <input name="monto" type="text" inputMode="decimal" autoComplete="off"
              value={l.monto} onChange={e => setLinea(i, { monto: limpiarMonto(e.target.value), tocado: true })} onFocus={e => e.target.select()} placeholder={m(total)} />
          </label>
          {l.metodo === 'qr' && (
            <PagoQrCard config={config} monto={numMonto(l.monto) > 0 ? numMonto(l.monto) : total} empresaNombre={config?.nombre} />
          )}
          {l.metodo === 'qr' && <ComprobanteQr valor={l.comprobante} onCambio={v => setLinea(i, v)} />}
        </div>
      ))}
      {cobro.lineas.length < 2 && <button className="success" type="button" onClick={agregarLinea}>{t('venta.segundoPago')}</button>}
      {cobro.lineas.length >= 2 && <small className="vd-nota-ayuda">{t('venta.maxDosLineas')}</small>}
      <div className="vd-resumen-pago">
        <span>{t('venta.pagadoLabel')} <b>{m(pagadoPreview)}</b></span>
        {cambioPreview > 0 && <span className="vd-cambio">{t('venta.cambioLabel')} {m(cambioPreview)}</span>}
        {falta > 0.009 && <span className="vd-falta">{t('venta.faltaLabel')} {m(round2(total - pagadoPreview))}</span>}
      </div>
      {pideDatosFiscales(config) && (
        <fieldset className="vd-fiscal">
          <legend>{t('fiscal.titulo')}</legend>
          <label>{t('fiscal.nombre')}
            <input name="fiscalNombre" type="text" autoComplete="off" maxLength={80} value={fiscal.nombre} onChange={e => setFiscal('nombre', e.target.value)} />
          </label>
          <label>{etiquetaFiscal(config)}
            <input name="fiscalNumero" type="text" autoComplete="off" inputMode="text" maxLength={30} value={fiscal.numero} onChange={e => setFiscal('numero', e.target.value)} />
          </label>
          <label>{t('fiscal.correo')}
            <input name="fiscalCorreo" type="email" autoComplete="off" inputMode="email" maxLength={120} value={fiscal.correo} onChange={e => setFiscal('correo', e.target.value)} />
          </label>
          <small className="vd-nota-ayuda">{t('fiscal.ayuda')}</small>
        </fieldset>
      )}
      <label className="vd-check">
        <input name="imprimir" type="checkbox" checked={cobro.imprimir} onChange={e => onChange({ ...cobro, imprimir: e.target.checked })} />
        {t('venta.imprimirTicket')}
      </label>
      {mostrarComanda && (
        <label className="vd-check">
          <input name="comanda" type="checkbox" checked={cobro.comanda} onChange={e => onChange({ ...cobro, comanda: e.target.checked })} />
          <span className="vd-check-cuerpo">{t('venta.comandaCheckbox')}<small>{t('venta.comandaAyuda')}</small></span>
        </label>
      )}
    </div>
  )
}
