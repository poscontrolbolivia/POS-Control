import { useEffect, useState } from 'react'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import { descargarJson, cambiarPlan } from '../../../services/super/superApi.js'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'

export default function PlanCard({ sesion }) {
  const { t, tOr } = useIdioma()
  const { s } = useStore()
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // mi_plan ya trae topes y consumo: los mismos números que vigilan los triggers de la base.
  const cargarPlan = () => rpc('mi_plan').then(setPlan).catch(() => {})
  useEffect(() => {
    let vivo = true
    rpc('mi_plan').then(p => { if (vivo) setPlan(p) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  // El super admin cambia el plan de ESTA empresa desde aquí mismo, sin ir a otra pantalla.
  const aplicarPlan = async (nuevo, dias = null) => {
    setBusy(true); setMsg('')
    try {
      await cambiarPlan(sesion?.empresaId, nuevo, dias)
      await cargarPlan()
      setMsg(nuevo === 'pago' ? tOr('plan.activado', 'Listo: la empresa ahora es Premium.') : tOr('plan.vueltaBasico', 'Listo: la empresa volvió al plan Básico.'))
    } catch (e) { setMsg(`${t('plan.error')}: ${mensajeError(e)}`) } finally { setBusy(false) }
  }

  const descargar = async () => {
    setBusy(true); setMsg('')
    try {
      const datos = await rpc('exportar_mi_empresa')
      descargarJson(datos, (sesion?.empresa || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    } catch (e) { setMsg(`${t('plan.error')}: ${mensajeError(e)}`) } finally { setBusy(false) }
  }

  const gratis = !plan || plan.plan === 'gratis'
  const sinLim = tOr('plan.sinLimite', 'sin límite')
  const activos = (s.productos || []).filter(p => p.activo !== false).length
  // null = sin límite (Premium). Que falte la clave es otra cosa: la base todavía tiene el
  // mi_plan viejo y hay que re-pegar el SQL, así que se muestra «—» en lugar de «sin límite».
  const trajoTopes = plan && 'tope_articulos' in plan
  const usoArt = plan?.uso_articulos ?? activos
  const usoPers = plan?.uso_personas
  const tope = v => (v == null ? (trajoTopes ? sinLim : '—') : String(v))
  const lleno = v => (plan?.[`tope_${v}`] != null && plan?.[`uso_${v}`] >= plan[`tope_${v}`])

  return (
    <div className="plan-card">
      {/* (a) En qué plan está */}
      <div className="plan-fila">
        <span className={'plan-chip adm-chip' + (gratis ? '' : ' plan-chip-premium')}>
          {gratis ? tOr('plan.estoyBasico', 'Estoy en el plan Básico (gratis)') : tOr('plan.estoyPremium', 'Estoy en el plan Premium')}
        </span>
        {!gratis && <b className="plan-vigencia">{plan.premium_hasta
          ? t('plan.premiumHasta', { fecha: new Date(plan.premium_hasta).toLocaleDateString() })
          : t('plan.premiumIndef')}</b>}
      </div>
      <p className="adm-sub">{gratis ? t('plan.retencion', { meses: plan?.retencion_meses ?? 6 }) : t('plan.retencionPago')}</p>

      {/* (b) Límites y consumo */}
      <div className="plan-uso">
        <span className={'plan-uso-item' + (lleno('articulos') ? ' plan-uso-lleno' : '')}>
          {tOr('plan.usoArticulos', 'Artículos en venta')}: <b>{usoArt}</b><span className="plan-uso-tope">/ {tope(plan?.tope_articulos)}</span>
        </span>
        <span className={'plan-uso-item' + (lleno('personas') ? ' plan-uso-lleno' : '')}>
          {tOr('plan.usoEquipo', 'Personas en el equipo')}: <b>{usoPers ?? '—'}</b><span className="plan-uso-tope">/ {tope(plan?.tope_personas)}</span>
        </span>
      </div>
      {lleno('articulos') && <p className="adm-sub">{tOr('plan.alTopeArticulos', 'Estás en el tope de artículos del plan Básico. Premium lo quita.')}</p>}
      {lleno('personas') && <p className="adm-sub">{tOr('plan.alTopePersonas', 'Estás en el tope de personas del plan Básico. Premium lo quita.')}</p>}

      {/* (c) Qué trae el Premium */}
      <p className="plan-subtitulo">{tOr('plan.premiumTrae', 'El plan Premium trae:')}</p>
      <ul className="plan-lista">
        <li>{tOr('plan.beneficio1', 'Sin borrado automático de ventas, tickets y movimientos viejos.')}</li>
        <li>{tOr('plan.beneficio2', 'Sin tope de artículos en venta.')}</li>
        <li>{tOr('plan.beneficio3', 'Sin tope de personas en el equipo.')}</li>
      </ul>

      {/* (d) El camino real para subir */}
      <p className="plan-subtitulo">{tOr('plan.comoSubir', '¿Cómo pasar a Premium?')}</p>
      <p className="adm-sub"><b>{sesion?.es_super ? tOr('plan.laActivaAqui', 'Como super admin, la activas aquí mismo (los días se suman a los vigentes):') : tOr('plan.laActivaSuper', 'La activa el dueño de la plataforma (super admin).')}</b></p>
      {sesion?.es_super && sesion?.empresaId ? (
        <div className="adm-fila plan-super">
          {[30, 90, 365].map(n => (
            <button key={n} type="button" className="success" disabled={busy} onClick={() => aplicarPlan('pago', n)}>+{n} {tOr('super.plan.dias', 'días')}</button>
          ))}
          <button type="button" className="primary" disabled={busy} onClick={() => aplicarPlan('pago', null)}>{tOr('super.plan.premiumIndef', 'Premium indefinido')}</button>
          <button type="button" className="danger" disabled={busy || gratis} onClick={() => aplicarPlan('gratis', null)}>{tOr('super.cuota.aBasico', 'Volver a Básico')}</button>
        </div>
      ) : (
        <div className="adm-fila">
          <span className="adm-sub">{tOr('plan.pedirAlSuper', 'Pídesela al dueño de esta plataforma: no hay pago automático dentro de la app.')}</span>
        </div>
      )}

      <p className="adm-sub">{t('plan.consejo')}</p>
      <div className="adm-fila">
        <button type="button" className="ghost" onClick={descargar} disabled={busy}>{busy ? t('plan.preparando') : t('plan.descargar')}</button>
        {msg && <span className="adm-msg warn">{msg}</span>}
      </div>
    </div>
  )
}
