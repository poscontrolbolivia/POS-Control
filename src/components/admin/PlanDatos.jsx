import { useEffect, useState } from 'react'
import { rpc, mensajeError } from '../../services/supabase.js'
import { descargarJson } from '../../services/super/superApi.js'
import { useIdioma } from '../../i18n/index.jsx'

// Tarjeta «Plan y datos» (solo admin, solo con Supabase): muestra el plan, cuánto tiempo se
// conservan las ventas (plan gratis = 6 meses; lo más viejo se borra solo cada noche) y deja
// descargar una copia completa de la empresa (respaldo / migración a otro plan o sistema).
export default function PlanDatos({ sesion }) {
  const { t } = useIdioma()
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let vivo = true
    rpc('mi_plan').then(p => { if (vivo) setPlan(p) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  const descargar = async () => {
    setBusy(true); setMsg('')
    try {
      const datos = await rpc('exportar_mi_empresa')
      descargarJson(datos, (sesion?.empresa || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    } catch (e) { setMsg(`${t('plan.error')}: ${mensajeError(e)}`) } finally { setBusy(false) }
  }

  const gratis = !plan || plan.plan === 'gratis'
  return (
    <div className="adm-card">
      <div className="adm-card-cab"><h3>{t('plan.titulo')}</h3><span className="adm-chip">{gratis ? t('plan.gratis') : t('plan.pago')}</span></div>
      <p className="adm-sub">{gratis ? t('plan.retencion', { meses: plan?.retencion_meses ?? 6 }) : t('plan.retencionPago')}</p>
      {plan?.max_productos != null && gratis && <p className="adm-sub">{t('plan.articulos', { max: plan.max_productos })}</p>}
      <p className="adm-sub">{t('plan.consejo')}</p>
      <div className="adm-fila">
        <button type="button" className="ghost" onClick={descargar} disabled={busy}>{busy ? t('plan.preparando') : t('plan.descargar')}</button>
        {msg && <span className="adm-msg warn">{msg}</span>}
      </div>
    </div>
  )
}
