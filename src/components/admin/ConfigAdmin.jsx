import { useState } from 'react'
import { useStore } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import SelectorIdioma from '../../i18n/SelectorIdioma.jsx'
import ThemeSelect from '../login/ThemeSelect.jsx'
import ImpresorasAdmin from './ImpresorasAdmin.jsx'
import EquipoAdmin from './EquipoAdmin.jsx'
import './admin.css'

// Configuración del negocio (solo rol admin): nombre, moneda, IVA y propina sugerida.
// Props: { rol, sesion }
export default function ConfigAdmin({ rol, sesion }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const [form, setForm] = useState({
    nombre: s.config?.nombre ?? '',
    moneda: s.config?.moneda ?? 'Bs',
    ivaPct: String(s.config?.ivaPct ?? 0),
    propinaPct: String(s.config?.propinaPct ?? 10),
  })
  const [msg, setMsg] = useState('')
  const [verImpresoras, setVerImpresoras] = useState(false)

  const preferencias = (
    <div className="adm-card">
      <div className="adm-card-cab"><h3>{t('config.preferencias')}</h3></div>
      <div className="pref-fila">
        <SelectorIdioma soloSuper={false} esSuper={Boolean(sesion?.es_super)} />
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
    d({ t: 'cfg~', cambios: { nombre: form.nombre.trim(), moneda: form.moneda.trim() || 'Bs', ivaPct, propinaPct } })
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
            <input value={form.moneda} onChange={set('moneda')} placeholder="Bs" list="adm-monedas" />
            <datalist id="adm-monedas">
              <option value="Bs" /><option value="$" /><option value="Q" /><option value="L" /><option value="C$" />
            </datalist>
          </label>
          <label className="adm-campo">
            <span>{t('config.ivaLabel')}</span>
            <input type="number" min="0" max="100" step="0.5" value={form.ivaPct} onChange={set('ivaPct')} />
          </label>
          <label className="adm-campo">
            <span>{t('config.propinaLabel')}</span>
            <input type="number" min="0" max="100" step="1" value={form.propinaPct} onChange={set('propinaPct')} />
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
      {verImpresoras && <ImpresorasAdmin rol={rol} sesion={sesion} />}
      {/* El equipo solo se muestra al rol admin de la sesión (la base valida el permiso igual,
          pero un cajero no tiene nada que hacer aquí). */}
      {(sesion ? sesion.rol === 'admin' : rol === 'admin') && <EquipoAdmin rol={rol} sesion={sesion} />}
    </div>
  )
}
