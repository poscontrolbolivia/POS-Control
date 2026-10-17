import { useState } from 'react'
import { MONEDA } from '../../config.js'
import { ajustarCuota, cambiarPlan, verCuota } from '../../services/super/superApi.js'
import { mensajeError } from '../../services/super/cliente.js'
import { useIdioma } from '../../i18n/index.jsx'
import './super.css'

// Tabla de empresas del listado global (super_listar_empresas).
// Props: { empresas, cargando, error, ocupado, onExportar(empresa), onEntrar(empresa), onRefrescar }
// "Entrar" se confirma en pantalla (sin diálogos nativos) porque cambia la empresa con la que
// opera TODA la app, no solo este panel.
// El bloque "Cuota" (solo visible aquí, en el panel de super) limita los artículos que el
// comercio puede tener a la venta: Básico = 20 artículos y 3 personas, Premium = sin límite.
export default function EmpresasTabla({ empresas = [], cargando = false, error = '', ocupado = false, onExportar, onEntrar, onRefrescar }) {
  const { tOr } = useIdioma()
  const [confirmando, setConfirmando] = useState(null)

  // Estado del editor de cuota (una empresa abierta a la vez).
  const [cuotaEmpresa, setCuotaEmpresa] = useState(null)
  const [cuota, setCuota] = useState(null)          // { max_productos, plan, productos_actuales }
  const [form, setForm] = useState({ max: '', maxM: '', plan: 'gratis', notas: '' })
  const [cuotaCargando, setCuotaCargando] = useState(false)
  const [cuotaGuardando, setCuotaGuardando] = useState(false)
  const [cuotaError, setCuotaError] = useState('')
  const [cuotaOk, setCuotaOk] = useState('')

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
        notas: '', // la nota privada no la devuelve super_ver_cuota: la reescribe quien la conozca
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

  // Un clic: Básico ⇄ Premium con los valores por defecto del plan (recarga la cuota después).
  const alternarPlan = async () => {
    if (!cuotaEmpresa || !cuota) return
    setCuotaError(''); setCuotaOk(''); setCuotaGuardando(true)
    try {
      await cambiarPlan(cuotaEmpresa.id, cuota.plan === 'pago' ? 'gratis' : 'pago')
      const datos = await verCuota(cuotaEmpresa.id)
      setCuota(datos)
      setForm(f => ({
        ...f,
        max: datos.max_productos == null ? '' : String(datos.max_productos),
        maxM: datos.max_miembros == null ? '' : String(datos.max_miembros),
        plan: datos.plan === 'pago' ? 'pago' : 'gratis',
      }))
      setCuotaOk(tOr('super.cuota.planCambiado', 'Plan cambiado.'))
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
                      <td>{e.codigo || <span className="super-chip">{tOr('super.tabla.sinCodigo', 'sin código')}</span>}</td>
                      <td>{e.moneda || MONEDA}</td>
                      <td className="super-num">{Number(e.usuarios || 0)}</td>
                      <td className="super-num">{Number(e.mesas || 0)}</td>
                      <td className="super-num">{Number(e.productos || 0)}</td>
                      <td className="super-num">{Number(e.cuentas || 0)}</td>
                      <td>{fecha(e.creada_en)}</td>
                      <td>
                        <div className="super-acciones">
                          <button type="button" disabled={ocupado} onClick={() => onExportar?.(e)}>{tOr('super.tabla.exportar', 'Exportar')}</button>
                          <button type="button" className="primary" disabled={ocupado} onClick={() => setConfirmando(e)}>{tOr('super.tabla.entrar', 'Entrar')}</button>
                          <button type="button" className="super-ghost" disabled={ocupadoCuota && cuotaEmpresa?.id !== e.id}
                            onClick={() => abrirCuota(e)}>
                            {cuotaEmpresa?.id === e.id ? tOr('super.tabla.cuotaCerrar', 'Cuota ✕') : tOr('super.tabla.cuota', 'Cuota')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {/* Editor de cuota: máximo de artículos a la venta + plan + nota privada */}
      {cuotaEmpresa && (
        <div className="super-bloque super-cuota-caja">
          <div className="super-titulo-bloque">
            <b>{tOr('super.cuota.titulo', 'Plan y cuotas')} — {cuotaEmpresa.nombre}</b>
            <span className="sp" />
            {cuota && <span className="super-chip">{tOr('super.cuota.plan', 'plan')}: {cuota.plan}</span>}
            {cuota && <span className="super-chip">{cuota.productos_actuales} / {limiteVisto} {tOr('super.cuota.uso', 'artículos en venta')}</span>}
            {cuota && <span className="super-chip">{cuota.miembros_actuales} / {limiteEquipo} {tOr('super.cuota.usoEquipo', 'personas en el equipo')}</span>}
            {cuota && (
              <button type="button" className="primary" disabled={ocupadoCuota} onClick={alternarPlan}>
                {cuota.plan === 'pago' ? tOr('super.cuota.aBasico', 'Volver a Básico') : tOr('super.cuota.aPremium', 'Pasar a Premium')}
              </button>
            )}
          </div>

          {cuotaCargando && <div className="super-cargando" role="status">{tOr('super.cuota.cargando', 'Consultando la cuota…')}</div>}

          {!cuotaCargando && (
            <>
              <div className="super-dos">
                <label className="super-campo">
                  <span>{tOr('super.cuota.max', 'Máximo de artículos a la venta (vacío = sin límite)')}</span>
                  <input
                    type="number" min="1" step="1" inputMode="numeric" value={form.max}
                    disabled={ocupadoCuota || form.plan === 'pago'}
                    placeholder={form.plan === 'pago' ? tOr('super.cuota.noAplicaPago', 'no aplica: plan de pago') : tOr('super.cuota.ejemplo30', 'p. ej. 20')}
                    onChange={ev => { setForm(f => ({ ...f, max: ev.target.value })); setCuotaOk('') }}
                  />
                </label>
                <label className="super-campo">
                  <span>{tOr('super.cuota.maxMiembros', 'Máximo de personas en el equipo (vacío = sin límite)')}</span>
                  <input
                    type="number" min="1" step="1" inputMode="numeric" value={form.maxM}
                    disabled={ocupadoCuota || form.plan === 'pago'}
                    placeholder={form.plan === 'pago' ? tOr('super.cuota.noAplicaPago', 'no aplica: plan de pago') : tOr('super.cuota.ejemplo3', 'p. ej. 3')}
                    onChange={ev => { setForm(f => ({ ...f, maxM: ev.target.value })); setCuotaOk('') }}
                  />
                </label>
                <label className="super-campo">
                  <span>{tOr('super.cuota.planLabel', 'Plan del comercio')}</span>
                  <select
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
                <input value={form.notas} disabled={ocupadoCuota}
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

// '2026-10-16T13:52:00Z' → '16/10/2026'. Fechas raras o vacías → '—'.
function fecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
