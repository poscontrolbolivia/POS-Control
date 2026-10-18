import { useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import LanguageSelect from '../../login/LanguageSelect.jsx'
import ThemeSelect from '../../login/ThemeSelect.jsx'
import PrintersCard from './PrintersCard.jsx'
import UsersPage from '../users/UsersPage.jsx'
import PlanCard from './PlanCard.jsx'
import { USAR_SUPABASE, MONEDA } from '../../../services/config.js'
import { MONEDAS_COMUNES, MONEDA_MAX, limpiarMoneda } from '../../../services/money.js'
import '../../../styles/admin.css'

export default function SettingsPage({ rol, sesion }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const [form, setForm] = useState({
    nombre: s.config?.nombre ?? '',
    moneda: s.config?.moneda || MONEDA,
    ivaPct: String(s.config?.ivaPct ?? 0),
    propinaPct: String(s.config?.propinaPct ?? 10),
    propinaIncluida: Boolean(s.config?.propinaIncluida),
  })
  const [msg, setMsg] = useState('')
  const [verImpresoras, setVerImpresoras] = useState(false)

  const [verEquipo, setVerEquipo] = useState(() => {
    try { return localStorage.getItem('pos-admin-equipo-abierto') === '1' } catch { return false }
  })
  const alternarEquipo = () => {
    const nuevo = !verEquipo
    setVerEquipo(nuevo)
    try { localStorage.setItem('pos-admin-equipo-abierto', nuevo ? '1' : '0') } catch {  }
  }

  const preferencias = (
    <div className="adm-card">
      <div className="adm-card-cab"><h3>{t('config.preferencias')}</h3></div>
      <div className="pref-fila">
        <LanguageSelect soloSuper={false} esSuper={Boolean(sesion?.es_super)} />
        <ThemeSelect />
      </div>
    </div>
  )

  if (rol !== 'admin') {
    return (
      <div className="adm-panel">
        <div className="adm-cab"><h2>{t('config.titulo')}</h2></div>
        {preferencias}
      </div>
    )
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const guardar = e => {
    e.preventDefault()
    const ivaPct = Number(form.ivaPct)
    const propinaPct = Number(form.propinaPct)
    if (!form.nombre.trim()) { setMsg(t('config.faltaNombre')); return }
    if (!Number.isFinite(ivaPct) || ivaPct < 0 || ivaPct > 100 || !Number.isFinite(propinaPct) || propinaPct < 0 || propinaPct > 100) {
      setMsg(t('config.rangoPct'))
      return
    }
    d({ t: 'cfg~', cambios: { nombre: form.nombre.trim(), moneda: limpiarMoneda(form.moneda), ivaPct, propinaPct, propinaIncluida: form.propinaIncluida } })
    setMsg(t('config.guardado'))
    setTimeout(() => setMsg(''), 2500)
  }

  return (
    <div className="adm-panel">
      <div className="adm-cab"><h2>{t('config.titulo')}</h2></div>
      {preferencias}
      <form className="adm-card adm-config" onSubmit={guardar}>
        {sesion && <p className="adm-sub">{t('config.sesionLabel')} <b>{sesion.nombre}</b> ({tOr('rol.' + sesion.rol, sesion.rol)}) · {sesion.empresa}</p>}
        <label className="adm-campo">
          <span>{t('config.nombreLabel')}</span>
          <input value={form.nombre} onChange={set('nombre')} placeholder={t('comun.miNegocio')} />
        </label>
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
            <input type="number" min="0" max="100" step="0.01" value={form.ivaPct} onChange={set('ivaPct')} />
          </label>
          <label className="adm-campo">
            <span>{t('config.propinaLabel')}</span>
            <input type="number" min="0" max="100" step="0.1" value={form.propinaPct} onChange={set('propinaPct')} />
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={form.propinaIncluida} onChange={e => setForm(f => ({ ...f, propinaIncluida: e.target.checked }))} />
            <span><b>{t('config.propinaIncluir')}</b><small>{t('config.propinaIncluirAyuda')}</small></span>
          </label>
        </div>
        <div className="adm-fila">
          <button type="submit" className="primary big">{t('config.guardarCambios')}</button>
          {msg && <span className={'adm-msg' + (msg.startsWith('✅') ? ' ok' : ' warn')}>{msg}</span>}
        </div>
      </form>
      <div className="adm-fila">
        <button type="button" className="ghost" onClick={() => setVerImpresoras(v => !v)}>
          🖨️ {verImpresoras ? t('config.impresorasOcultar') : t('config.impresorasConfigurar')} {t('config.impresoras')}
        </button>
        {s.config?.impresion === 'silenciosa' && !verImpresoras && <span className="adm-chip">{t('config.modoSilenciosoActivo')}</span>}
      </div>
      {verImpresoras && <PrintersCard rol={rol} sesion={sesion} />}
      {(sesion ? sesion.rol === 'admin' : rol === 'admin') && (
        <UsersPage rol={rol} sesion={sesion} abierto={verEquipo} onToggleAbierto={alternarEquipo} />
      )}
      {USAR_SUPABASE && sesion?.supabase && <PlanCard sesion={sesion} />}
    </div>
  )
}
