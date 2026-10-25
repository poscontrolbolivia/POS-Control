import { Suspense, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import CabeceraPagina from '../../ui/CabeceraPagina.jsx'
import LanguageSelect from '../../login/LanguageSelect.jsx'
import ThemeSelect from '../../login/ThemeSelect.jsx'
import PrintersCard from './PrintersCard.jsx'
import { lazyRetry } from '../../../services/lazyRetry.js'
const StationPage = lazyRetry(() => import('../station/StationPage.jsx'))
import UsersPage from '../users/UsersPage.jsx'
import PlanCard from './PlanCard.jsx'
import ClosingsHistory from '../cash/ClosingsHistory.jsx'
import { calcularResumen } from '../cash/calcularResumen.js'
import { USAR_SUPABASE, MONEDA } from '../../../services/config.js'
import { MONEDAS_COMUNES, MONEDA_MAX, limpiarMoneda, formatearMonto } from '../../../services/money.js'
import { round2, limpiarMonto, numMonto } from '../../../services/format.js'
import { sb } from '../../../services/supabaseClient.js'
import { puede } from '../../../services/permissions.js'
import { urlImagenNegocio, procesarImagenNegocio, borrarImagen } from '../../../services/imageUpload.js'
import '../../../styles/admin.css'
import '../cash/CashPage.css'
import './SettingsPage.css'

// Tecla única del acordeón de Configuración (un solo bloque abierto a la vez).
const CLAVE_ABIERTO = 'pos-cfg-abierto'
const IDS_BLOQUES = ['preferencias', 'negocio', 'caja', 'impresoras', 'equipo', 'plan']
// «Cierres» pasó a llamarse «Caja y cierres»: la preferencia guardada con el id viejo se conserva.
const ID_VIEJO = { cierres: 'caja' }

// Cuál viene abierto: la tecla única; si no existe, la preferencia vieja por bloque (migración).
function leerAbierto() {
  try {
    if (typeof window !== 'undefined' && window.location?.hash === '#estacion') return 'impresoras'
    const nuevo = localStorage.getItem(CLAVE_ABIERTO)
    if (nuevo !== null) { const id = ID_VIEJO[nuevo] || nuevo; return IDS_BLOQUES.includes(id) ? id : null }
    // Impresoras manda en la migración porque es el destino del enlace viejo #estacion.
    const abiertaAntes = ['impresoras', ...IDS_BLOQUES].find(id => localStorage.getItem('pos-cfg-' + id) === '1')
    if (abiertaAntes) return abiertaAntes
    if (localStorage.getItem('pos-admin-equipo-abierto') === '1') return 'equipo'
  } catch { /* noop */ }
  return null
}

export default function SettingsPage({ rol, sesion }) {
  const { s, d, modo } = useStore()
  const { t, tOr } = useIdioma()
  const [form, setForm] = useState({
    nombre: s.config?.nombre ?? '',
    sucursal: s.config?.sucursal ?? '',
    direccion: s.config?.direccion ?? '',
    telefono: s.config?.telefono ?? '',
    nit: s.config?.nit ?? '',
    fiscalEtiqueta: s.config?.fiscalEtiqueta ?? '',
    datosFiscales: s.config?.datosFiscales !== false,
    moneda: s.config?.moneda || MONEDA,
    ivaPct: String(s.config?.ivaPct ?? 0),
    propinaPct: String(s.config?.propinaPct ?? 10),
    propinaIncluida: Boolean(s.config?.propinaIncluida),
    propinaMostrar: s.config?.propinaMostrar !== false,
    cajaModo: s.config?.cajaModo === 'por_cajero' ? 'por_cajero' : 'compartida',
  })
  const [msg, setMsg] = useState('')

  // Acordeón EXCLUSIVO: un solo bloque abierto (la preferencia vive en pos-cfg-abierto).
  const [abierto, setAbierto] = useState(() => leerAbierto())
  const alternar = id => setAbierto(v => (v === id ? null : id))
  // Con un bloque abierto, los demás desaparecen (ni arriba ni abajo) hasta minimizarlo.
  const props = id => ({ abierto: abierto === id, oculto: Boolean(abierto) && abierto !== id, onToggle: () => alternar(id) })
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ABIERTO, abierto ?? '')
    } catch { /* noop */ }
  }, [abierto])
  // El enlace viejo «#estacion» (PC de impresión) sigue aterrizando en Impresoras ya desplegado.
  useEffect(() => {
    const alCambiar = () => { if (window.location.hash === '#estacion') setAbierto('impresoras') }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  // Misma cabecera y mismo texto de ayuda para todos los roles.
  const ayuda = tOr('config.ayuda', 'Aquí ajustas cómo se ve y cómo trabaja tu negocio: idioma y tema, datos, caja y cierres, impresoras, equipo y plan. Se abre un bloque a la vez y su título queda fijo mientras bajas.')
  const cabecera = (
    <>
      <CabeceraPagina titulo={t('config.titulo')} />
      <p className="adm-sub">{ayuda}</p>
      {sesion && (
        <p className="adm-sub cfg-sesion">{t('config.sesionLabel')} <b>{sesion.nombre}</b> ({tOr('rol.' + sesion.rol, sesion.rol)}) · {sesion.empresa}</p>
      )}
    </>
  )

  const cuerpoPreferencias = (
    <div className="pref-fila">
      <LanguageSelect soloSuper={false} esSuper={Boolean(sesion?.es_super)} />
      <ThemeSelect />
    </div>
  )

  if (rol !== 'admin') {
    const conImpresoras = rol === 'cajero' && sesion?.supabase
    return (
      <div className="adm-panel">
        {cabecera}
        <Bloque id="preferencias" icono="🌐" titulo={t('config.preferencias')} {...props('preferencias')}>{cuerpoPreferencias}</Bloque>
        {conImpresoras && (
          <Bloque id="impresoras" icono="🖨️" titulo={t('config.impresoras')} {...props('impresoras')}>
            <Suspense fallback={null}><StationPage embebida rol={rol} sesion={sesion} /></Suspense>
          </Bloque>
        )}
      </div>
    )
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })
  // La plaquita de propina guardona al instante, sin esperar el botón Guardar (OrderPanel la lee de s.config).
  const alternarPropinaMostrar = () => {
    const nuevo = !form.propinaMostrar
    setForm(f => ({ ...f, propinaMostrar: nuevo }))
    d({ t: 'cfg~', cambios: { propinaMostrar: nuevo } })
  }
  // El modo de caja se guarda al instante (vive en «Caja y cierres», fuera del formulario de datos).
  const cambiarCajaModo = m => {
    setForm(f => ({ ...f, cajaModo: m }))
    d({ t: 'cfg~', cambios: { cajaModo: m } })
  }
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
      fiscalEtiqueta: form.fiscalEtiqueta.trim(),
      datosFiscales: form.datosFiscales,
      moneda: limpiarMoneda(form.moneda),
      ivaPct, propinaPct, propinaIncluida: form.propinaIncluida,
    } })
    setMsg(t('config.guardado'))
    setTimeout(() => setMsg(''), 2500)
  }

  const moneda = s.config?.moneda || MONEDA
  const turnoAbierto = Boolean(s.caja?.turno) || (s.caja?.otros || []).length > 0
  // Atajos a las pantallas de trabajo diario: usan el mismo hash que ya entiende PanelPage.
  const ir = hash => { window.location.hash = hash }

  return (
    <div className="adm-panel">
      {cabecera}

      <Bloque id="preferencias" icono="🌐" titulo={t('config.preferencias')} {...props('preferencias')}>{cuerpoPreferencias}</Bloque>

      <Bloque id="negocio" icono="🏪" titulo={tOr('config.datosNegocio', 'Datos del negocio')} {...props('negocio')}>
        <form className="adm-config" onSubmit={guardar}>
          <label className="adm-campo">
            <span>{t('config.nombreLabel')}</span>
            <input name="mi-negocio" value={form.nombre} onChange={set('nombre')} placeholder={t('comun.miNegocio')} />
          </label>
          <p className="adm-sub">{t('config.ticketEncabezado')}</p>
          <div className="adm-fila2">
            <label className="adm-campo">
              <span>{t('config.sucursalLabel')}</span>
              <input name="sucursal" value={form.sucursal} onChange={set('sucursal')} placeholder={t('config.sucursalPlace')} maxLength={40} />
            </label>
            <label className="adm-campo">
              <span>{t('config.telefonoLabel')}</span>
              <input name="telefono" value={form.telefono} onChange={set('telefono')} maxLength={24} inputMode="tel" />
            </label>
            <label className="adm-campo">
              <span>{t('config.direccionLabel')}</span>
              <input name="direccion" value={form.direccion} onChange={set('direccion')} placeholder={t('config.direccionPlace')} maxLength={80} />
            </label>
            <label className="adm-campo">
              <span>{t('config.nitLabel')}</span>
              <input name="nit" value={form.nit} onChange={set('nit')} maxLength={20} />
            </label>
            <label className="adm-campo">
              <span>{t('config.fiscalEtiqueta')}</span>
              <input name="fiscalEtiqueta" value={form.fiscalEtiqueta} onChange={set('fiscalEtiqueta')} placeholder="NIT" maxLength={12} />
              <small style={{ color: 'var(--mut)', fontWeight: 400 }}>{t('config.fiscalEtiquetaAyuda')}</small>
            </label>
            <label className="adm-check">
              <input name="datosFiscales" type="checkbox" checked={form.datosFiscales} onChange={e => setForm({ ...form, datosFiscales: e.target.checked })} />
              <span>{t('config.datosFiscales')}<small>{t('config.datosFiscalesAyuda')}</small></span>
            </label>
          </div>
          <div className="adm-fila2">
            <label className="adm-campo">
              <span>{t('config.monedaLabel')}</span>
              <input name="moneda" value={form.moneda} onChange={set('moneda')} placeholder={MONEDA} maxLength={MONEDA_MAX} list="adm-monedas" />
              <datalist id="adm-monedas">
                {MONEDAS_COMUNES.map(m => <option key={m} value={m} />)}
              </datalist>
            </label>
            <label className="adm-campo">
              <span>{t('config.ivaLabel')}</span>
              <input name="iva-pct" type="text" inputMode="decimal" autoComplete="off" value={form.ivaPct}
                onChange={e => setForm(f => ({ ...f, ivaPct: limpiarMonto(e.target.value) }))}
                onBlur={() => setForm(f => ({ ...f, ivaPct: f.ivaPct !== '' ? numMonto(f.ivaPct).toFixed(2) : '' }))}
                onFocus={e => e.target.select()} placeholder="0.00" />
            </label>
            <label className="adm-campo">
              <span>{t('config.propinaLabel')}</span>
              <input name="propina-pct" type="text" inputMode="decimal" autoComplete="off" value={form.propinaPct}
                onChange={e => setForm(f => ({ ...f, propinaPct: limpiarMonto(e.target.value) }))}
                onBlur={() => setForm(f => ({ ...f, propinaPct: f.propinaPct !== '' ? numMonto(f.propinaPct).toFixed(2) : '' }))}
                onFocus={e => e.target.select()} placeholder="0.00" />
            </label>
            <label className="adm-check">
              <input name="propina-incluida" type="checkbox" checked={form.propinaIncluida} onChange={e => setForm(f => ({ ...f, propinaIncluida: e.target.checked }))} />
              <span><b>{t('config.propinaIncluir')}</b><small>{t('config.propinaIncluirAyuda')}</small></span>
            </label>
            <div className="adm-check cfg-switch-fila">
              <button type="button" role="switch" aria-checked={form.propinaMostrar}
                aria-label={tOr('config.propinaMostrar', 'Mostrar la propina sugerida en la cuenta')}
                className={'cfg-switch' + (form.propinaMostrar ? ' on' : '')}
                onClick={alternarPropinaMostrar}>
                <span className="cfg-switch-pista"><span className="cfg-switch-nudo" /></span>
              </button>
              <span><b>{tOr('config.propinaMostrar', 'Mostrar la propina sugerida en la cuenta')}</b>
                <small>{tOr('config.propinaMostrarAyuda', 'Apagado: al cobrar no se ofrece propina al cliente; el porcentaje configurado se sigue usando si alguien la escribe a mano.')}</small></span>
            </div>
          </div>
          <div className="adm-fila">
            <button type="submit" className="primary big">{t('config.guardarCambios')}</button>
            {msg && <span className={'adm-msg' + (msg.startsWith('✅') ? ' ok' : ' warn')}>{msg}</span>}
          </div>
        </form>

        {/* Subidas independientes: logo del negocio y foto del QR de pago (se guardan solas, sin el botón Guardar) */}
        <div className="cfg-imagenes">
          <CfgImagen
            tipo="logo"
            titulo={tOr('config.imgLogoTitulo', 'Logo del negocio')}
            ayuda={tOr('config.imgLogoAyuda', 'Cuadrado o rectangular, máx 8 MB. Se optimiza automáticamente y aparece junto al nombre en el comprobante y el cobro.')}
            config={s.config}
            modo={modo}
            empresaId={s._empresaId}
            onCambios={cambios => d({ t: 'cfg~', cambios })}
          />
          <CfgImagen
            tipo="qr"
            titulo={tOr('config.imgQrTitulo', 'QR de pago')}
            ayuda={tOr('config.imgQrAyuda', 'Foto del QR bancario / QRIS / plin que el cliente escanea para pagar. Cuadrada o rectangular, máx 8 MB; no se recorta para que siga escaneando.')}
            config={s.config}
            modo={modo}
            empresaId={s._empresaId}
            onCambios={cambios => d({ t: 'cfg~', cambios })}
          />
        </div>
      </Bloque>

      <Bloque id="caja" icono="💰" titulo={tOr('config.cajaYCierres', 'Caja y cierres')} {...props('caja')}>
        <p className="adm-sub">{tOr('config.cajaYCierresAyuda', 'Todo lo de caja en un solo lugar: cómo se maneja la gaveta, el historial de cierres y el acceso a Caja y Reportes.')}</p>
        <div className="cfg-atajos">
          <button type="button" className="ghost" onClick={() => ir('#caja')}>💵 {tOr('config.irCaja', 'Abrir Caja')}</button>
          {puede(rol, 'ver_reportes') && <button type="button" className="ghost" onClick={() => ir('#reportes')}>📊 {tOr('config.irReportes', 'Abrir Reportes')}</button>}
        </div>
        <fieldset className="adm-caja-modo" disabled={turnoAbierto}>
          <legend>{t('config.cajaModo')}</legend>
          {['compartida', 'por_cajero'].map(m => (
            <label key={m} className={'adm-check' + (form.cajaModo === m ? ' on' : '')}>
              <input type="radio" name="cajaModo" value={m} checked={form.cajaModo === m} onChange={() => cambiarCajaModo(m)} />
              <span><b>{t(m === 'compartida' ? 'config.cajaCompartida' : 'config.cajaPorCajero')}</b>
                <small>{t(m === 'compartida' ? 'config.cajaCompartidaAyuda' : 'config.cajaPorCajeroAyuda')}</small></span>
            </label>
          ))}
          {turnoAbierto && <small className="adm-msg warn">{t('config.cajaModoBloqueado')}</small>}
        </fieldset>
        <h3 className="cfg-seccion">{t('cierres.titulo')}</h3>
        {sesion?.supabase
          ? <ClosingsHistory moneda={moneda} />
          : <CierresDemo historial={s.caja?.historial || []} cuentas={s.cuentas} moneda={moneda} />}
      </Bloque>

      <Bloque
        id="impresoras"
        icono="🖨️"
        titulo={t('config.impresoras')}
        chip={s.config?.impresion === 'silenciosa' ? <span className="adm-chip">{t('config.modoSilenciosoActivo')}</span> : null}
        {...props('impresoras')}
        cuerpoClase="cfg-cuerpo-plano"
      >
        {/* PrintersCard arma sus submenús y carga la estación solo cuando toca: así el estado del
            agente y la salida de cada grupo se muestran una sola vez. */}
        <PrintersCard rol={rol} sesion={sesion} />
      </Bloque>

      {(sesion ? sesion.rol === 'admin' : rol === 'admin') && (
        <Bloque id="equipo" icono="👥" titulo={tOr('equipo.titulo', 'Equipo')} {...props('equipo')} cuerpoClase="cfg-cuerpo-plano">
          <UsersPage rol={rol} sesion={sesion} abierto onToggleAbierto={() => alternar('equipo')} />
        </Bloque>
      )}

      {USAR_SUPABASE && sesion?.supabase && (
        <Bloque id="plan" icono="📦" titulo={t('plan.titulo')} {...props('plan')}><PlanCard sesion={sesion} /></Bloque>
      )}
    </div>
  )
}

// Bloque de Configuración (nivel 1): es el MENÚ y el contenido a la vez — la misma píldora
// siempre, abierta o cerrada, y el abierto se queda pegado bajo la barra mientras se baja.
// El acordeón es exclusivo: quién está abierto vive en SettingsPage, así que abrir uno cierra los demás.
function Bloque({ id, icono, titulo, chip = null, abierto = false, oculto = false, onToggle, cuerpoClase = '', children }) {
  if (oculto) return null
  return (
    <section className={'cfg-bloque' + (abierto ? ' abierto' : '')}>
      <button type="button" className="cfg-cab" onClick={onToggle} aria-expanded={abierto} aria-controls={'cfg-cuerpo-' + id}>
        <span className="cfg-cab-icono" aria-hidden="true">{icono}</span>
        <span className="cfg-cab-titulo">{titulo}</span>
        {chip && <span className="cfg-cab-chip">{chip}</span>}
        <span className="cfg-cab-flecha" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
      </button>
      {abierto && <div className={'cfg-cuerpo' + (cuerpoClase ? ' ' + cuerpoClase : '')} id={'cfg-cuerpo-' + id}>{children}</div>}
    </section>
  )
}

// Subida de una imagen del negocio (logo o QR de pago) dentro de Datos del negocio.
// Previsualiza la guardada, permite reemplazarla y quitarla en dos pasos (Sí/No con temporizador,
// nunca confirm() nativo). Los avisos van en línea, sin alert().
function CfgImagen({ tipo, titulo, ayuda, config, modo, empresaId, onCambios }) {
  const { tOr } = useIdioma()
  const input = useRef(null)
  const [ocupada, setOcupada] = useState(false)
  const [aviso, setAviso] = useState(null)        // { ok: true|false, msg }
  const [preguntando, setPreguntando] = useState(false)
  const timerPregunta = useRef(null)
  const claves = tipo === 'qr' ? { path: 'qrPath', data: 'qrDataUrl' } : { path: 'logoPath', data: 'logoDataUrl' }
  const url = urlImagenNegocio(config, tipo)

  useEffect(() => () => clearTimeout(timerPregunta.current), [])

  const elegir = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setOcupada(true); setAviso(null); setPreguntando(false)
    try {
      const { path, dataUrl } = await procesarImagenNegocio({ sb, modo, empresaId, carpeta: tipo === 'qr' ? 'qr' : 'logos', file })
      onCambios({ [claves.path]: path, [claves.data]: dataUrl })
      setAviso({ ok: true, msg: tOr('config.imgGuardada', 'Imagen guardada.') })
    } catch (err) {
      setAviso({ ok: false, msg: err?.message || tOr('config.imgError', 'No se pudo guardar la imagen.') })
    } finally { setOcupada(false) }
  }

  const pulsarBorrar = () => {
    clearTimeout(timerPregunta.current)
    setPreguntando(true)
    timerPregunta.current = setTimeout(() => setPreguntando(false), 4000)
  }
  const confirmarBorrar = async () => {
    clearTimeout(timerPregunta.current)
    setPreguntando(false); setOcupada(true); setAviso(null)
    try {
      if (modo === 'supabase' && config?.[claves.path]) await borrarImagen(sb, config[claves.path])
      onCambios({ [claves.path]: null, [claves.data]: null })
      setAviso({ ok: true, msg: tOr('config.imgBorrada', 'Imagen quitada.') })
    } catch (err) {
      setAviso({ ok: false, msg: err?.message || tOr('config.imgErrorBorrar', 'No se pudo quitar la imagen.') })
    } finally { setOcupada(false) }
  }

  return (
    <div className={'cfg-img' + (tipo === 'qr' ? ' cfg-img-qr' : '')}>
      <div className="cfg-img-vista">
        {url
          ? <img src={url} alt={titulo} />
          : <span className="cfg-img-vacio" aria-hidden="true">🖼️</span>}
      </div>
      <div className="cfg-img-datos">
        <b>{titulo}</b>
        <small className="cfg-img-ayuda">{ayuda}</small>
        <input name="file" ref={input} type="file" accept="image/*" hidden onChange={elegir} />
        <div className="cfg-img-botones">
          <button type="button" className={url ? 'ghost' : 'primary'} onClick={() => input.current?.click()} disabled={ocupada}>
            {ocupada
              ? tOr('config.imgProcesando', 'Procesando…')
              : url
                ? tOr('config.imgReemplazar', 'Reemplazar')
                : tOr('config.imgSubir', 'Subir imagen')}
          </button>
          {url && (preguntando ? (
            <>
              <span className="cfg-img-conf">{tOr('config.imgSeguro', '¿Seguro?')}</span>
              <button type="button" className="danger solid" onClick={confirmarBorrar} disabled={ocupada}>{tOr('config.imgSisi', 'Sí')}</button>
              <button type="button" className="ghost" onClick={() => { clearTimeout(timerPregunta.current); setPreguntando(false) }} disabled={ocupada}>{tOr('config.imgNo', 'No')}</button>
            </>
          ) : (
            <button type="button" className="danger" onClick={pulsarBorrar} disabled={ocupada}>{tOr('config.imgQuitar', 'Quitar')}</button>
          ))}
        </div>
        {aviso && <small className={'adm-msg ' + (aviso.ok ? 'ok' : 'warn')} role="status">{aviso.msg}</small>}
      </div>
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
