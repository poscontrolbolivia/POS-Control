import { useState } from 'react'
import { MONEDA } from '../../../services/config.js'
import { ajustarCuota, cambiarPlan, verCuota } from '../../../services/super/superApi.js'
import { mensajeError } from '../../../services/super/client.js'
import { useIdioma } from '../../../i18n/index.jsx'
import './SuperPage.css'

export default function CompaniesTable({ empresas = [], cargando = false, error = '', ocupado = false, onExportar, onExportarZip, onEntrar, onRefrescar }) {
  const { tOr } = useIdioma()
  const [confirmando, setConfirmando] = useState(null)

  const [cuotaEmpresa, setCuotaEmpresa] = useState(null)
  const [cuota, setCuota] = useState(null)
  const [form, setForm] = useState({ max: '', maxM: '', plan: 'gratis', notas: '' })
  const [cuotaCargando, setCuotaCargando] = useState(false)
  const [cuotaGuardando, setCuotaGuardando] = useState(false)
  const [cuotaError, setCuotaError] = useState('')
  const [cuotaOk, setCuotaOk] = useState('')
  const [diasCustom, setDiasCustom] = useState('')

  const abrirCuota = async e => {
    if (cuotaEmpresa?.id === e.id) { cerrarCuota(); return }
    setCuotaEmpresa(e); setCuota(null); setCuotaError(''); setCuotaOk('')
    setCuotaCargando(true)
    try {
      const datos = await verCuota(e.id)
      setCuota(datos)
      setForm({
        max: datos.max_productos === null || datos.max_productos === undefined ? '' : String(datos.max_productos),
        maxM: datos.max_miembros === null || datos.max_miembros === undefined ? '' : String(datos.max_miembros),
        plan: datos.plan === 'pago' ? 'pago' : 'gratis',
        notas: '',
      })
    } catch (err) { setCuotaError(mensajeError(err)) } finally { setCuotaCargando(false) }
  }

  const cerrarCuota = () => { setCuotaEmpresa(null); setCuota(null); setCuotaError(''); setCuotaOk('') }

  const guardarCuota = async () => {
    if (!cuotaEmpresa) return
    setCuotaError(''); setCuotaOk(''); setCuotaGuardando(true)
    try {
      await ajustarCuota(cuotaEmpresa.id, { maxProductos: form.max.trim(), maxMiembros: form.maxM.trim(), plan: form.plan, notas: form.notas })
      const nuevos = {
        max: form.max.trim() === '' || form.plan === 'pago' ? null : Number(form.max),
        maxM: form.maxM.trim() === '' || form.plan === 'pago' ? null : Number(form.maxM),
        plan: form.plan,
      }
      setCuota(c => (c ? { ...c, max_productos: nuevos.max, max_miembros: nuevos.maxM, plan: nuevos.plan } : c))
      setCuotaOk(tOr('super.cuota.guardado', 'Cuota guardada en la base.'))
    } catch (err) { setCuotaError(mensajeError(err)) } finally { setCuotaGuardando(false) }
  }

  const aplicarPlan = async (plan, dias = null) => {
    if (!cuotaEmpresa || !cuota) return
    setCuotaError(''); setCuotaOk(''); setCuotaGuardando(true)
    try {
      await cambiarPlan(cuotaEmpresa.id, plan, dias)
      const datos = await verCuota(cuotaEmpresa.id)
      setCuota(datos)
      setForm(f => ({
        ...f,
        max: datos.max_productos == null ? '' : String(datos.max_productos),
        maxM: datos.max_miembros == null ? '' : String(datos.max_miembros),
        plan: datos.plan === 'pago' ? 'pago' : 'gratis',
      }))
      setDiasCustom('')
      setCuotaOk(tOr('super.cuota.planCambiado', 'Plan cambiado.'))
      onRefrescar?.()
    } catch (err) { setCuotaError(mensajeError(err)) } finally { setCuotaGuardando(false) }
  }

  const ocupadoCuota = cuotaCargando || cuotaGuardando || ocupado
  const sinLim = tOr('super.cuota.sinLimite', 'sin límite')
  const limiteVisto = cuota && (cuota.plan === 'pago' || cuota.max_productos == null) ? sinLim : cuota ? `${cuota.max_productos}` : null
  const limiteEquipo = cuota && (cuota.plan === 'pago' || cuota.max_miembros == null) ? sinLim : cuota ? `${cuota.max_miembros}` : null

  return (
    <section className="panel super-bloque">
      <div className="super-titulo-bloque">
        <h3>{tOr('super.tabla.titulo', 'Empresas de la plataforma')}</h3>
        <span className="super-chip">{empresas.length} {empresas.length === 1 ? tOr('super.tabla.una', 'empresa') : tOr('super.tabla.varias', 'empresas')}</span>
        <span className="sp" />
        <button type="button" className="super-ghost" disabled={cargando || ocupado} onClick={() => { setConfirmando(null); onRefrescar?.() }}>
          {cargando ? tOr('super.tabla.cargando', 'Cargando…') : tOr('super.tabla.actualizar', 'Actualizar')}
        </button>
      </div>

      {error && <div className="super-error" role="alert">⚠️ {error}</div>}

      {cargando && !empresas.length
        ? <div className="super-cargando" role="status">{tOr('super.tabla.consultando', 'Consultando Supabase…')}</div>
        : !empresas.length && !error
          ? <div className="super-vacio">{tOr('super.tabla.vacia', 'No hay empresas en esta base. Importa un respaldo para crear la primera.')}</div>
          : (
            <div className="super-tabla-envoltura">
              <table className="super-tabla">
                <thead>
                  <tr>
                    <th>{tOr('super.tabla.colEmpresa', 'Empresa')}</th>
                    <th>{tOr('super.tabla.colCodigo', 'Código')}</th>
                    <th>{tOr('super.tabla.colPlan', 'Plan')}</th>
                    <th>{tOr('super.tabla.colMoneda', 'Moneda')}</th>
                    <th className="super-num">{tOr('super.tabla.colUsuarios', 'Usuarios')}</th>
                    <th className="super-num">{tOr('super.tabla.colMesas', 'Mesas')}</th>
                    <th className="super-num">{tOr('super.tabla.colProductos', 'Productos')}</th>
                    <th className="super-num">{tOr('super.tabla.colCuentas', 'Cuentas')}</th>
                    <th>{tOr('super.tabla.colCreada', 'Creada')}</th>
                    <th>{tOr('super.tabla.colAcciones', 'Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {empresas.map(e => (
                    <tr key={e.id}>
                      <td className="super-nombre">{e.nombre}</td>
                      <td data-label={tOr('super.tabla.colCodigo', 'Código')}>{e.codigo || <span className="super-chip">{tOr('super.tabla.sinCodigo', 'sin código')}</span>}</td>
                      <td data-label={tOr('super.tabla.colPlan', 'Plan')}>
                        <span className={'super-chip ' + (e.plan === 'pago' ? 'plan-premium' : 'plan-basico')}>
                          {e.plan === 'pago'
                            ? (e.premium_hasta ? `Premium · ${tOr('super.plan.hasta', 'hasta')} ${fecha(e.premium_hasta)}` : `Premium · ${tOr('super.plan.indefinido', 'indefinido')}`)
                            : tOr('super.plan.basico', 'Básico')}
                        </span>
                      </td>
                      <td data-label={tOr('super.tabla.colMoneda', 'Moneda')}>{e.moneda || MONEDA}</td>
                      <td className="super-num" data-label={tOr('super.tabla.colUsuarios', 'Usuarios')}>{Number(e.usuarios || 0)}</td>
                      <td className="super-num" data-label={tOr('super.tabla.colMesas', 'Mesas')}>{Number(e.mesas || 0)}</td>
                      <td className="super-num" data-label={tOr('super.tabla.colProductos', 'Productos')}>{Number(e.productos || 0)}</td>
                      <td className="super-num" data-label={tOr('super.tabla.colCuentas', 'Cuentas')}>{Number(e.cuentas || 0)}</td>
                      <td data-label={tOr('super.tabla.colCreada', 'Creada')}>{fecha(e.creada_en)}</td>
                      <td>
                        <div className="super-acciones">
                          <button type="button" disabled={ocupado} onClick={() => onExportar?.(e)}>{tOr('super.tabla.exportar', 'Exportar')}</button>
                          <button type="button" disabled={ocupado} title={tOr('super.tabla.exportarZipTitulo', 'Descarga todo: datos, inventario, devoluciones y las fotos reales')} onClick={() => onExportarZip?.(e)}>{tOr('super.tabla.exportarZip', 'Completo (.zip)')}</button>
                          <button type="button" className="primary" disabled={ocupado} onClick={() => setConfirmando(e)}>{tOr('super.tabla.entrar', 'Entrar')}</button>
                          <button type="button" className="super-ghost" disabled={ocupadoCuota && cuotaEmpresa?.id !== e.id}
                            onClick={() => abrirCuota(e)}>
                            {cuotaEmpresa?.id === e.id ? tOr('super.tabla.cuotaCerrar', 'Plan ✕') : tOr('super.tabla.planCuota', 'Plan / Premium')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {cuotaEmpresa && (
        <div className="super-bloque super-cuota-caja">
          <div className="super-titulo-bloque">
            <b>{tOr('super.cuota.titulo', 'Plan y cuotas')} — {cuotaEmpresa.nombre}</b>
            <span className="sp" />
            {cuota && <span className="super-chip">{tOr('super.cuota.plan', 'plan')}: {cuota.plan}</span>}
            {cuota && <span className="super-chip">{cuota.productos_actuales} / {limiteVisto} {tOr('super.cuota.uso', 'artículos en venta')}</span>}
            {cuota && <span className="super-chip">{cuota.miembros_actuales} / {limiteEquipo} {tOr('super.cuota.usoEquipo', 'personas en el equipo')}</span>}
          </div>

          {cuotaCargando && <div className="super-cargando" role="status">{tOr('super.cuota.cargando', 'Consultando la cuota…')}</div>}

          {!cuotaCargando && cuota && (
            <div className="super-plan-caja">
              <div className="super-plan-estado">
                <b>{tOr('super.plan.actual', 'Plan actual')}:</b>{' '}
                {cuota.plan === 'pago'
                  ? (cuota.premium_hasta
                    ? `Premium · ${tOr('super.plan.vence', 'vence el')} ${fecha(cuota.premium_hasta)} (${diasRestantes(cuota.premium_hasta)} ${tOr('super.plan.diasRestan', 'días restantes')})`
                    : `Premium · ${tOr('super.plan.indefinido', 'indefinido')}`)
                  : tOr('super.plan.basico', 'Básico')}
              </div>
              <span className="super-ayuda">{tOr('super.plan.ayuda', 'Los días se SUMAN a los que ya tenga vigentes. Al vencer, la empresa vuelve sola a Básico.')}</span>
              <div className="super-plan-btns">
                {[30, 90, 365].map(n => (
                  <button key={n} type="button" className="success" disabled={ocupadoCuota} onClick={() => aplicarPlan('pago', n)}>+{n} {tOr('super.plan.dias', 'días')}</button>
                ))}
                <span className="super-plan-custom">
                  <input name="dias-placeholder" type="number" min="1" max="3650" step="1" inputMode="numeric" value={diasCustom} disabled={ocupadoCuota}
                    placeholder={tOr('super.plan.diasPlaceholder', 'N días')} onChange={ev => setDiasCustom(ev.target.value)} />
                  <button type="button" className="info" disabled={ocupadoCuota || !diasCustom} onClick={() => aplicarPlan('pago', diasCustom)}>{tOr('super.plan.sumar', 'Sumar días')}</button>
                </span>
                <button type="button" className="primary" disabled={ocupadoCuota} onClick={() => aplicarPlan('pago', null)}>{tOr('super.plan.premiumIndef', 'Premium indefinido')}</button>
                <button type="button" className="orange" disabled={ocupadoCuota || cuota.plan !== 'pago'} onClick={() => aplicarPlan('gratis', null)}>{tOr('super.cuota.aBasico', 'Volver a Básico')}</button>
              </div>
            </div>
          )}

          {!cuotaCargando && (
            <>
              <div className="super-dos">
                <label className="super-campo">
                  <span>{tOr('super.cuota.max', 'Máximo de artículos a la venta (vacío = sin límite)')}</span>
                  <input name="max-articulos"
                    type="number" min="1" step="1" inputMode="numeric" value={form.max}
                    disabled={ocupadoCuota || form.plan === 'pago'}
                    placeholder={form.plan === 'pago' ? tOr('super.cuota.noAplicaPago', 'no aplica: plan de pago') : tOr('super.cuota.ejemplo30', 'p. ej. 20')}
                    onChange={ev => { setForm(f => ({ ...f, max: ev.target.value })); setCuotaOk('') }}
                  />
                </label>
                <label className="super-campo">
                  <span>{tOr('super.cuota.maxMiembros', 'Máximo de personas en el equipo (vacío = sin límite)')}</span>
                  <input name="max-m"
                    type="number" min="1" step="1" inputMode="numeric" value={form.maxM}
                    disabled={ocupadoCuota || form.plan === 'pago'}
                    placeholder={form.plan === 'pago' ? tOr('super.cuota.noAplicaPago', 'no aplica: plan de pago') : tOr('super.cuota.ejemplo3', 'p. ej. 3')}
                    onChange={ev => { setForm(f => ({ ...f, maxM: ev.target.value })); setCuotaOk('') }}
                  />
                </label>
                <label className="super-campo">
                  <span>{tOr('super.cuota.planLabel', 'Plan del comercio')}</span>
                  <select name="plan"
                    value={form.plan} disabled={ocupadoCuota}
                    onChange={ev => { setForm(f => ({ ...f, plan: ev.target.value })); setCuotaOk('') }}
                  >
                    <option value="gratis">{tOr('super.cuota.planGratis', 'gratis (limitado)')}</option>
                    <option value="pago">{tOr('super.cuota.planPago', 'pago (sin límite)')}</option>
                  </select>
                </label>
              </div>
              <label className="super-campo">
                <span>{tOr('super.cuota.nota', 'Nota interna (solo la ve el super)')}</span>
                <input name="nota-ejemplo" value={form.notas} disabled={ocupadoCuota}
                  placeholder={tOr('super.cuota.notaEjemplo', 'p. ej. negocia suscripción desde octubre')}
                  onChange={ev => setForm(f => ({ ...f, notas: ev.target.value }))} />
                <span className="super-ayuda">{tOr('super.cuota.notaAviso', 'Aviso: la RPC de lectura no devuelve la nota guardada; al guardar, lo que escribas aquí la reemplaza (vacío = nota vacía).')}</span>
              </label>

              <p className="super-ayuda">
                {tOr('super.cuota.explicacion', 'El comercio NUNCA ve este número: al llegar al máximo la app simplemente le impide añadir más artículos y le sugiere pasarse al plan de pago. Deja el campo vacío (o el plan en «pago») para no limitar. Guarda p. ej. 30 para el plan gratuito.')}
              </p>

              {cuotaError && <div className="super-error" role="alert">⚠️ {cuotaError}</div>}
              {cuotaOk && <div className="super-ok">✅ {cuotaOk}</div>}

              <div className="super-centro" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="super-ghost" disabled={ocupadoCuota} onClick={cerrarCuota}>{tOr('super.cuota.cerrar', 'Cerrar')}</button>
                <button type="button" className="primary" disabled={ocupadoCuota} onClick={guardarCuota}>
                  {cuotaGuardando ? tOr('super.cuota.guardando', 'Guardando…') : tOr('super.cuota.guardar', 'Guardar cuota')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {confirmando && (
        <div className="super-bloque" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--libre)' }}>
          <b>{tOr('super.entrar.pregunta', '¿Entrar en «{empresa}»?').replace('{empresa}', confirmando.nombre)}</b>
          <p className="super-ayuda">
            {tOr('super.entrar.detalleAntes', 'La app dejará de trabajar con tus datos y pasará a operar con los de')} <b>{confirmando.nombre}</b>{' '}
            ({Number(confirmando.mesas || 0)} {tOr('super.entrar.mesas', 'mesas')}, {Number(confirmando.productos || 0)}{' '}
            {tOr('super.entrar.productos', 'productos')}, {Number(confirmando.cuentas || 0)} {tOr('super.entrar.cuentas', 'cuentas')}).{' '}
            {tOr('super.entrar.detalleDespues', 'Verás su salón, su caja y sus tickets como si fueras equipo de esa empresa, con el límite de artículos que definas abajo. Tus datos quedan guardados y recuperas tu empresa con «volver a mi empresa».')}
          </p>
          <div className="super-centro" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="super-ghost" disabled={ocupado} onClick={() => setConfirmando(null)}>{tOr('super.entrar.cancelar', 'Cancelar')}</button>
            <button type="button" className="primary" disabled={ocupado} onClick={() => { const e = confirmando; setConfirmando(null); onEntrar?.(e) }}>
              {ocupado ? tOr('super.entrar.entrando', 'Entrando…') : tOr('super.entrar.confirmar', 'Sí, entrar en esa empresa')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function fecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function diasRestantes(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 86400000))
}
