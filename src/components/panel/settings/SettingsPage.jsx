import { useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import LanguageSelect from '../../login/LanguageSelect.jsx'
import ThemeSelect from '../../login/ThemeSelect.jsx'
import PrintersCard from './PrintersCard.jsx'
import UsersPage from '../users/UsersPage.jsx'
import PlanCard from './PlanCard.jsx'
import ClosingsHistory from '../cash/ClosingsHistory.jsx'
import { calcularResumen } from '../cash/calcularResumen.js'
import { USAR_SUPABASE, MONEDA } from '../../../services/config.js'
import { MONEDAS_COMUNES, MONEDA_MAX, limpiarMoneda, formatearMonto } from '../../../services/money.js'
import { round2, limpiarMonto, numMonto } from '../../../services/format.js'
import '../../../styles/admin.css'
import '../cash/CashPage.css'
import './SettingsPage.css'

export default function SettingsPage({ rol, sesion }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const [form, setForm] = useState({
    nombre: s.config?.nombre ?? '',
    sucursal: s.config?.sucursal ?? '',
    direccion: s.config?.direccion ?? '',
    telefono: s.config?.telefono ?? '',
    nit: s.config?.nit ?? '',
    moneda: s.config?.moneda || MONEDA,
    ivaPct: String(s.config?.ivaPct ?? 0),
    propinaPct: String(s.config?.propinaPct ?? 10),
    propinaIncluida: Boolean(s.config?.propinaIncluida),
    cajaModo: s.config?.cajaModo === 'por_cajero' ? 'por_cajero' : 'compartida',
  })
  const [msg, setMsg] = useState('')

  const [verEquipo, setVerEquipo] = useState(() => {
    try { return localStorage.getItem('pos-admin-equipo-abierto') === '1' } catch { return false }
  })
  const alternarEquipo = () => {
    const nuevo = !verEquipo
    setVerEquipo(nuevo)
    try { localStorage.setItem('pos-admin-equipo-abierto', nuevo ? '1' : '0') } catch {  }
  }

  const cuerpoPreferencias = (
    <div className="pref-fila">
      <LanguageSelect soloSuper={false} esSuper={Boolean(sesion?.es_super)} />
      <ThemeSelect />
    </div>
  )

  if (rol !== 'admin') {
    return (
      <div className="adm-panel">
        <div className="adm-cab"><h2>{t('config.titulo')}</h2></div>
        <Bloque id="preferencias" icono="🌐" titulo={t('config.preferencias')}>{cuerpoPreferencias}</Bloque>
      </div>
    )
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const guardar = e => {
    e.preventDefault()
    const ivaPct = numMonto(form.ivaPct)
    const propinaPct = numMonto(form.propinaPct)
    if (!form.nombre.trim()) { setMsg(t('config.faltaNombre')); return }
    if (!Number.isFinite(ivaPct) || ivaPct < 0 || ivaPct > 100 || !Number.isFinite(propinaPct) || propinaPct < 0 || propinaPct > 100) {
      setMsg(t('config.rangoPct'))
      return
    }
    d({ t: 'cfg~', cambios: {
      nombre: form.nombre.trim(),
      sucursal: form.sucursal.trim(),
      direccion: form.direccion.trim(),
      telefono: form.telefono.trim(),
      nit: form.nit.trim(),
      moneda: limpiarMoneda(form.moneda),
      ivaPct, propinaPct, propinaIncluida: form.propinaIncluida, cajaModo: form.cajaModo,
    } })
    setMsg(t('config.guardado'))
    setTimeout(() => setMsg(''), 2500)
  }

  const moneda = s.config?.moneda || MONEDA

  return (
    <div className="adm-panel">
      <div className="adm-cab"><h2>{t('config.titulo')}</h2></div>

      <Bloque id="preferencias" icono="🌐" titulo={t('config.preferencias')}>{cuerpoPreferencias}</Bloque>

      <Bloque id="negocio" icono="🏪" titulo={tOr('config.datosNegocio', 'Datos del negocio')}>
        <form className="adm-config" onSubmit={guardar}>
          {sesion && <p className="adm-sub">{t('config.sesionLabel')} <b>{sesion.nombre}</b> ({tOr('rol.' + sesion.rol, sesion.rol)}) · {sesion.empresa}</p>}
          <label className="adm-campo">
            <span>{t('config.nombreLabel')}</span>
            <input value={form.nombre} onChange={set('nombre')} placeholder={t('comun.miNegocio')} />
          </label>
          <p className="adm-sub">{t('config.ticketEncabezado')}</p>
          <div className="adm-fila2">
            <label className="adm-campo">
              <span>{t('config.sucursalLabel')}</span>
              <input value={form.sucursal} onChange={set('sucursal')} placeholder={t('config.sucursalPlace')} maxLength={40} />
            </label>
            <label className="adm-campo">
              <span>{t('config.telefonoLabel')}</span>
              <input value={form.telefono} onChange={set('telefono')} maxLength={24} inputMode="tel" />
            </label>
            <label className="adm-campo">
              <span>{t('config.direccionLabel')}</span>
              <input value={form.direccion} onChange={set('direccion')} placeholder={t('config.direccionPlace')} maxLength={80} />
            </label>
            <label className="adm-campo">
              <span>{t('config.nitLabel')}</span>
              <input value={form.nit} onChange={set('nit')} maxLength={20} />
            </label>
          </div>
          <div className="adm-fila2">
            <label className="adm-campo">
              <span>{t('config.monedaLabel')}</span>
              <input value={form.moneda} onChange={set('moneda')} placeholder={MONEDA} maxLength={MONEDA_MAX} list="adm-monedas" />
              <datalist id="adm-monedas">
                {MONEDAS_COMUNES.map(m => <option key={m} value={m} />)}
              </datalist>
            </label>
            <label className="adm-campo">
              <span>{t('config.ivaLabel')}</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={form.ivaPct}
                onChange={e => setForm(f => ({ ...f, ivaPct: limpiarMonto(e.target.value) }))}
                onBlur={() => setForm(f => ({ ...f, ivaPct: f.ivaPct !== '' ? numMonto(f.ivaPct).toFixed(2) : '' }))}
                onFocus={e => e.target.select()} placeholder="0.00" />
            </label>
            <label className="adm-campo">
              <span>{t('config.propinaLabel')}</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={form.propinaPct}
                onChange={e => setForm(f => ({ ...f, propinaPct: limpiarMonto(e.target.value) }))}
                onBlur={() => setForm(f => ({ ...f, propinaPct: f.propinaPct !== '' ? numMonto(f.propinaPct).toFixed(2) : '' }))}
                onFocus={e => e.target.select()} placeholder="0.00" />
            </label>
            <label className="adm-check">
              <input type="checkbox" checked={form.propinaIncluida} onChange={e => setForm(f => ({ ...f, propinaIncluida: e.target.checked }))} />
              <span><b>{t('config.propinaIncluir')}</b><small>{t('config.propinaIncluirAyuda')}</small></span>
            </label>
          </div>
          <fieldset className="adm-caja-modo" disabled={Boolean(s.caja?.turno) || (s.caja?.otros || []).length > 0}>
            <legend>{t('config.cajaModo')}</legend>
            {['compartida', 'por_cajero'].map(m => (
              <label key={m} className={'adm-check' + (form.cajaModo === m ? ' on' : '')}>
                <input type="radio" name="cajaModo" value={m} checked={form.cajaModo === m} onChange={() => setForm(f => ({ ...f, cajaModo: m }))} />
                <span><b>{t(m === 'compartida' ? 'config.cajaCompartida' : 'config.cajaPorCajero')}</b>
                  <small>{t(m === 'compartida' ? 'config.cajaCompartidaAyuda' : 'config.cajaPorCajeroAyuda')}</small></span>
              </label>
            ))}
            {(s.caja?.turno || (s.caja?.otros || []).length > 0) && <small className="adm-msg warn">{t('config.cajaModoBloqueado')}</small>}
          </fieldset>
          <div className="adm-fila">
            <button type="submit" className="primary big">{t('config.guardarCambios')}</button>
            {msg && <span className={'adm-msg' + (msg.startsWith('✅') ? ' ok' : ' warn')}>{msg}</span>}
          </div>
        </form>
      </Bloque>

      <Bloque
        id="impresoras"
        icono="🖨️"
        titulo={t('config.impresoras')}
        chip={s.config?.impresion === 'silenciosa' ? <span className="adm-chip">{t('config.modoSilenciosoActivo')}</span> : null}
      >
        <PrintersCard rol={rol} sesion={sesion} />
      </Bloque>

      {(sesion ? sesion.rol === 'admin' : rol === 'admin') && (
        <UsersPage rol={rol} sesion={sesion} abierto={verEquipo} onToggleAbierto={alternarEquipo} />
      )}

      <Bloque id="cierres" icono="🧾" titulo={t('cierres.titulo')}>
        {sesion?.supabase
          ? <ClosingsHistory moneda={moneda} />
          : <CierresDemo historial={s.caja?.historial || []} cuentas={s.cuentas} moneda={moneda} />}
      </Bloque>

      {USAR_SUPABASE && sesion?.supabase && (
        <Bloque id="plan" icono="📦" titulo={t('plan.titulo')}><PlanCard sesion={sesion} /></Bloque>
      )}
    </div>
  )
}

// Bloque colapsado: arranca cerrado y se abre al tocar (mismo patrón que el equipo).
function Bloque({ id, icono, titulo, chip = null, children }) {
  const [abierto, setAbierto] = useState(() => {
    try { return localStorage.getItem('pos-cfg-' + id) === '1' } catch { return false }
  })
  const alternar = () => setAbierto(v => {
    const n = !v
    try { localStorage.setItem('pos-cfg-' + id, n ? '1' : '0') } catch { /* noop */ }
    return n
  })
  if (!abierto) {
    return (
      <div className="adm-fila cfg-collapsed">
        <button type="button" className="ghost eq-toggle" aria-expanded="false" onClick={alternar}>▸ {icono} {titulo}</button>
        {chip}
      </div>
    )
  }
  return (
    <div className="adm-card cfg-bloque">
      <div className="adm-card-cab">
        <button type="button" className="ghost eq-toggle" aria-expanded="true" aria-label={titulo} onClick={alternar}>▾</button>
        <h3>{icono} {titulo}</h3>
        {chip}
      </div>
      {children}
    </div>
  )
}

// Historial de cierres en modo demo (localStorage): lista simple, sin cerrar nada.
function CierresDemo({ historial, cuentas, moneda }) {
  const { t } = useIdioma()
  const m = n => formatearMonto(n, moneda)
  if (!historial.length) return <p className="caja-nota">{t('cierres.vacio')}</p>
  return (
    <ul className="caja-lista">
      {historial.map((h, i) => {
        const r = calcularResumen(h, cuentas)
        const dif = round2((Number(h.contado) || 0) - r.esperado)
        return (
          <li key={h.id}>
            <b>{t('caja.turnoNumero', { n: historial.length - i })}</b>
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
  )
}
