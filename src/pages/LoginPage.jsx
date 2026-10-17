import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, guardarSesionSup } from '../services/store.jsx'
import { USAR_SUPABASE, SOPORTE_WHATSAPP } from '../config.js'
import { sb, rpc, fijarEmpresa, mensajeError } from '../services/supabase.js'
import { esSuper } from '../services/super/superApi.js'
import { useIdioma } from '../i18n/index.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import '../styles/auth.css'

// Login en 2 pasos + 2 pantallas de auto-servicio, todo dentro de la misma SPA (ruta '/').
//  · Supabase: 1) CÓDIGO de empresa (RPC public.empresa_por_codigo) 2) email+clave
//    (signInWithPassword) → membresías: si tiene 1 empresa entra directo, si tiene
//    varias elige. Guarda la sesión en localStorage 'pos-sesion' (StoreProvider la lee).
//    Escribir el código "demo" cae al flujo demo de siempre.
//  · 'alta': cualquiera crea su negocio y su primer administrador con auth.signUp(). El
//    trigger private.registrar_empresa_del_registrado() (migración 004_altas.sql) crea la
//    empresa, la membresía 'admin' y un salón de 8 mesas. Sin confirmación de correo:
//    signUp devuelve sesión y se entra al instante.
//  · 'recupera': no hay reset por correo (la clave la administra una persona, no un bot).
//    Administradores → WhatsApp de SOPORTE_WHATSAPP; cajeros/meseros → un administrador de
//    su negocio les da clave nueva desde Configuración → Equipo.
//  · Demo (o USAR_SUPABASE=false): cualquier nombre de empresa + usuariosDemo.
// Los textos visibles pasan por t(): el idioma se elige desde el Topbar y se guarda en
// 'pos-idioma-app'. El código 'demo' NO se traduce: es un valor técnico.
// Props: { onEntrar } — onEntrar({ usuario, rol, nombre, empresa, ... })

// El mismo criterio que valida la base en el trigger de alta (migración 004_altas.sql),
// para que el aviso salga en el formulario y no después de un intento fallido.
const CODIGO_OK = /^[a-z0-9][a-z0-9._-]{2,23}$/
const CLAVE_MIN = 6
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage({ onEntrar }) {
  const { s } = useStore()
  const { t, tOr } = useIdioma()
  const [paso, setPaso] = useState('codigo') // 'codigo' | 'clave' | 'empresas' | 'alta' | 'recupera'
  const [empresa, setEmpresa] = useState(s.config?.nombre || t('comun.miNegocio'))
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Flujo Supabase:
  const [sup, setSup] = useState(false)          // true: el código de empresa resolvió a una empresa real
  const [empresaSup, setEmpresaSup] = useState(null) // {id, nombre, moneda}
  const [empresasUsuario, setEmpresasUsuario] = useState([]) // membresías tras login (si >1 se muestra picker)
  const [userRef, setUserRef] = useState(null)               // auth.user tras signInWithPassword (paso 'empresas')
  // Alta de negocio (paso 'alta'):
  const [alta, setAlta] = useState({ negocio: '', codigo: '', nombre: '', correo: '', clave: '' })
  // Recuperación (paso 'recupera'): el correo con el que se entra al negocio.
  const [correoRecup, setCorreoRecup] = useState('')

  const esDemo = codigo => codigo.trim().toLowerCase() === 'demo'
  const nombreEmpresaActual = () => (sup ? empresaSup?.nombre : empresa).trim()

  // El sandbox local necesita un acceso propio: si una empresa real de la base usa el código
  // "demo", escribirlo entra en Supabase (su dueño debe poder entrar), así que el modo sin
  // cuenta no puede depender de esa palabra.
  const irDemo = () => {
    setError('')
    guardarSesionSup(null)
    fijarEmpresa(null)
    setEmpresa('demo'); setSup(false); setPaso('clave')
  }

  const irAlta = () => { setError(''); setAlta({ negocio: '', codigo: '', nombre: '', correo: '', clave: '' }); setPaso('alta') }
  const irRecupera = () => { setError(''); setCorreoRecup(CORREO_OK.test(usuario.trim()) ? usuario.trim() : ''); setPaso('recupera') }
  const irCodigo = () => { setError(''); setSup(false); setPaso('codigo') }

  const continuar = async e => {
    e.preventDefault()
    const codigo = empresa.trim()
    if (!codigo) { setError(t('login.faltaCodigo')); return }
    if (!USAR_SUPABASE) { // sin base configurada: paso 2 con los usuariosDemo locales
      setError(''); setSup(false); setPaso('clave')
      return
    }
    setError(''); setBusy(true)
    try {
      // Primero siempre se pregunta a Supabase: un negocio real puede llamarse "demo"
      // y su dueño debe poder entrar con su código. El modo de prueba local solo se
      // usa cuando el código NO existe en la base (y escribe "demo").
      const filas = await rpc('empresa_por_codigo', { p_codigo: codigo }, { conEmpresa: false })
      if (filas && filas.length) { setEmpresaSup(filas[0]); setSup(true); setPaso('clave'); return }
      if (esDemo(codigo)) { setError(''); setSup(false); setPaso('clave'); return }
      setError(t('login.codigoNoEncontrado'))
    } catch (err) {
      if (esDemo(codigo)) { setError(''); setSup(false); setPaso('clave'); return } // sin base: prueba local
      setError(mensajeError(err))
    } finally { setBusy(false) }
  }

  const entrar = async e => {
    e.preventDefault()
    if (!sup) { // ── demo ──
      const u = (s.usuariosDemo || []).find(
        u => u.usuario.toLowerCase() === usuario.trim().toLowerCase() && u.clave === clave
      )
      if (!u) { setError(t('login.credencialesMal')); return }
      onEntrar({ usuario: u.usuario, rol: u.rol, nombre: u.nombre, empresa: empresa.trim() })
      return
    }
    // ── Supabase: email + clave ──
    setError(''); setBusy(true)
    try {
      const { data, error: errSign } = await sb.auth.signInWithPassword({ email: usuario.trim(), password: clave })
      if (errSign) throw new Error(errSign.message || t('login.credencialesTecnicas'))
      await trasLogin(data.user)
    } catch (err) {
      setError(mensajeError(err))
      try { await sb.auth.signOut() } catch { /* noop */ }
    } finally { setBusy(false) }
  }

  // Después de CUALQUIER login de Supabase (clave o alta) se resuelven las membresías.
  const trasLogin = async user => {
    setUserRef(user)
    const { data: memb, error: errM } = await sb.from('membresias')
      .select('empresa_id, rol').eq('user_id', user.id)
    if (errM) throw new Error(errM.message)
    const ids = new Set((memb || []).map(m => m.empresa_id))
    let filasEmpresas = []
    if (ids.size) {
      const { data: emps, error: errE } = await sb.from('empresas').select('id, nombre, moneda')
      if (errE) throw new Error(errE.message)
      filasEmpresas = (emps || []).filter(x => ids.has(x.id))
    }
    if (!filasEmpresas.length) {
      // El dueño de la plataforma puede no tener membresías: si la base lo reconoce como
      // super entra igual, y App abre directamente el panel Super (sin empresa).
      const superUsuario = await esSuper().catch(() => false)
      if (!superUsuario) throw new Error(t('login.sinEmpresa'))
      await listo(null, 'super', user)
      return
    }
    const conRol = e2 => (memb || []).find(m => m.empresa_id === e2.id)?.rol || 'mesero'
    if (filasEmpresas.length === 1) { await listo(filasEmpresas[0], conRol(filasEmpresas[0]), user); return }
    setEmpresasUsuario(filasEmpresas.map(x => ({ ...x, rol: conRol(x) })))
    setPaso('empresas') // multiempresa: elegir
  }

  // Alta directa: se crea la cuenta con los datos del negocio en raw_user_meta_data y la
  // base hace el resto. Si el código ya está tomado, el trigger responde con
  // 'alta_codigo_tomado' y se muestra el aviso en el propio formulario.
  const crearNegocio = async e => {
    e.preventDefault()
    const negocio = alta.negocio.trim()
    const codigo = alta.codigo.trim().toLowerCase()
    const correo = alta.correo.trim().toLowerCase()
    if (!negocio) { setError(t('alta.faltaNegocio')); return }
    if (!CODIGO_OK.test(codigo)) { setError(t('alta.codigoMal')); return }
    if (!CORREO_OK.test(correo)) { setError(t('alta.correoMal')); return }
    if (alta.clave.length < CLAVE_MIN) { setError(t('alta.claveCorta')); return }
    setError(''); setBusy(true)
    try {
      const tomadas = await rpc('empresa_por_codigo', { p_codigo: codigo }, { conEmpresa: false })
      if (tomadas && tomadas.length) { setError(t('alta.codigoTomado')); return }
      const { data, error: errSign } = await sb.auth.signUp({
        email: correo,
        password: alta.clave,
        options: {
          // display_name lo consume public.handle_new_user() (schema.sql) para el perfiles;
          // el resto lo consume el trigger private.registrar_empresa_del_registrado().
          data: {
            alta_empresa: true,
            codigo_empresa: codigo,
            nombre_empresa: negocio,
            nombre: alta.nombre.trim(),
            display_name: alta.nombre.trim(),
          },
        },
      })
      if (errSign) throw new Error(errSign.message || t('alta.fallo'))
      if (!data.user) throw new Error(t('alta.fallo'))
      // 'Confirm email' apagado en el dashboard ⇒ signUp trae sesión y se entra derecho.
      // Si algún día se enciende, el usuario queda creado pero sin sesión: hay que avisarlo.
      if (!data.session) { await sb.auth.signOut().catch(() => {}); throw new Error(t('alta.revisaCorreo')) }
      await trasLogin(data.user)
    } catch (err) {
      const msg = mensajeError(err)
      setError(msg.includes('alta_codigo_tomado') ? t('alta.codigoTomado') : msg)
      try { await sb.auth.signOut() } catch { /* noop */ }
    } finally { setBusy(false) }
  }

  // listo(): cierra el login. `es_super` SOLO decide si App pinta el módulo Super: el permiso
  // real lo vuelve a comprobar la base en cada RPC (si alguien edita localStorage, recibe
  // 'requiere super'). Un super sin empresa queda con rol 'super' y entra directo al panel.
  const listo = async (emp, rol, user) => {
    fijarEmpresa(emp?.id ?? null)
    const superUsuario = await esSuper().catch(() => false)
    const sesion = {
      empresaId: emp?.id ?? null, rol: superUsuario && !emp ? 'super' : rol, supabase: true,
      es_super: superUsuario,
      usuario: user ? user.email : usuario.trim(),
      nombre: (user && user.email ? user.email.split('@')[0] : usuario.trim()),
      empresa: emp?.nombre || 'Plataforma',
    }
    guardarSesionSup(sesion)
    onEntrar(sesion)
  }

  // El mensaje ya viene con el negocio y el correo: el soporte solo tiene que responder.
  const enlaceSoporte = () => `https://wa.me/${SOPORTE_WHATSAPP}?text=${encodeURIComponent(t('recupera.mensaje', {
    empresa: nombreEmpresaActual() || '—',
    correo: correoRecup.trim() || '—',
  }))}`

  const campo = k => e => setAlta(a => ({ ...a, [k]: e.target.value }))
  const ENVIO = { codigo: continuar, clave: entrar, alta: crearNegocio }

  return (
    <div className="auth-pantalla">
      <form className="auth-tarjeta" onSubmit={e => (ENVIO[paso] ? ENVIO[paso](e) : e.preventDefault())}>
        <div className="auth-marca">
          <BrandMark className="auth-logo" />
          <h1>POS Control</h1>
        </div>

        {paso === 'codigo' && (
          <>
            <h2>{t('login.titulo1')}</h2>
            <p className="auth-sub">{t('login.sub1')}</p>
            <label className="auth-campo">
              <span>{USAR_SUPABASE ? t('login.labelCodigo') : t('login.labelNombreEmpresa')}</span>
              <input
                autoFocus
                value={empresa}
                onChange={e => setEmpresa(e.target.value)}
                placeholder={USAR_SUPABASE ? t('login.placeholderCodigo') : t('login.placeholderEmpresa')}
              />
            </label>
            {USAR_SUPABASE
              ? <p className="auth-aviso">{t('login.avisoSupa')}</p>
              : <p className="auth-aviso">{t('login.avisoDemo')}</p>}
            {error && <p className="auth-error">{error}</p>}
            <button className="primary big auth-btn" type="submit" disabled={busy}>{busy ? t('login.buscando') : t('login.continuar')}</button>
            {USAR_SUPABASE && (
              <div className="auth-pie">
                <button className="auth-enlace" type="button" onClick={irAlta}>{t('login.crearEmpresa')}</button>
                <button className="auth-enlace" type="button" onClick={irDemo}>{t('login.probarDemo')}</button>
              </div>
            )}
            <p className="auth-legal">
              <Link to="/terminos">{t('legal.terms.title')}</Link> · <Link to="/privacidad">{t('legal.privacy.title')}</Link>
            </p>
          </>
        )}

        {paso === 'clave' && (
          <>
            <h2>{t('login.titulo2')}</h2>
            <p className="auth-sub">
              {t('login.empresa')} <b>{sup ? empresaSup?.nombre : empresa}</b>{' '}
              <button className="auth-enlace" type="button" onClick={irCodigo}>{t('login.cambiar')}</button>
            </p>
            <label className="auth-campo">
              <span>{sup ? t('login.labelCorreo') : t('login.labelUsuario')}</span>
              <input autoFocus value={usuario} onChange={e => setUsuario(e.target.value)}
                placeholder={sup ? t('login.placeholderCorreo') : 'admin'} autoComplete="username" />
            </label>
            <label className="auth-campo">
              <span>{t('login.labelClave')}</span>
              <input type="password" value={clave} onChange={e => setClave(e.target.value)} placeholder="••••" autoComplete="current-password" />
            </label>
            {error && <p className="auth-error">{error}</p>}
            <button className="primary big auth-btn" type="submit" disabled={busy}>{busy ? t('login.entrando') : t('login.entrar')}</button>
            {sup && <button className="auth-enlace" type="button" onClick={irRecupera}>{t('login.olvidaste')}</button>}
            {!sup && (
              <p className="auth-demo">
                {t('login.demoPrefijo')} {['admin', 'cajero', 'mesero'].map(u => <code key={u}>{u}/1234</code>)}
              </p>
            )}
          </>
        )}

        {paso === 'empresas' && (
          <>
            <h2>{t('login.titulo3')}</h2>
            <p className="auth-sub">{t('login.sub3')}</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {empresasUsuario.map(emp => (
                <button key={emp.id} type="button" className="primary big auth-btn"
                  onClick={() => listo(emp, emp.rol, userRef)}>
                  {emp.nombre} <small>({tOr('rol.' + emp.rol, emp.rol)})</small>
                </button>
              ))}
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-enlace" type="button" onClick={irCodigo}>{t('login.cambiarUsuario')}</button>
          </>
        )}

        {paso === 'alta' && (
          <>
            <h2>{t('alta.titulo')}</h2>
            <p className="auth-sub">{t('alta.sub')}</p>
            <label className="auth-campo">
              <span>{t('alta.labelNegocio')}</span>
              <input autoFocus value={alta.negocio} onChange={campo('negocio')}
                placeholder={t('alta.placeholderNegocio')} autoComplete="organization" maxLength={80} />
            </label>
            <label className="auth-campo">
              <span>{t('alta.labelCodigo')}</span>
              <input value={alta.codigo} onChange={e => setAlta(a => ({ ...a, codigo: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                placeholder={t('alta.placeholderCodigo')} spellCheck={false} autoComplete="off" maxLength={24} />
              <small className="auth-ayuda">{t('alta.helpCodigo')}</small>
            </label>
            <label className="auth-campo">
              <span>{t('alta.labelEncargado')}</span>
              <input value={alta.nombre} onChange={campo('nombre')} placeholder={t('alta.placeholderEncargado')} autoComplete="name" />
            </label>
            <label className="auth-campo">
              <span>{t('alta.labelCorreo')}</span>
              <input type="email" value={alta.correo} onChange={campo('correo')}
                placeholder={t('login.placeholderCorreo')} autoComplete="email" />
            </label>
            <label className="auth-campo">
              <span>{t('alta.labelClave')}</span>
              <input type="password" value={alta.clave} onChange={campo('clave')} placeholder="••••••"
                autoComplete="new-password" />
              <small className="auth-ayuda">{t('alta.helpClave')}</small>
            </label>
            {error && <p className="auth-error">{error}</p>}
            <button className="primary big auth-btn" type="submit" disabled={busy}>{busy ? t('alta.creando') : t('alta.crear')}</button>
            <p className="auth-aviso">{t('alta.aviso')}</p>
            <button className="auth-enlace" type="button" onClick={irCodigo}>{t('alta.volver')}</button>
            <p className="auth-legal">
              <Link to="/terminos">{t('legal.terms.title')}</Link> · <Link to="/privacidad">{t('legal.privacy.title')}</Link>
            </p>
          </>
        )}

        {paso === 'recupera' && (
          <>
            <h2>{t('recupera.titulo')}</h2>
            <p className="auth-sub">{t('recupera.sub')} <b>{sup ? empresaSup?.nombre : empresa}</b></p>
            <label className="auth-campo">
              <span>{t('recupera.labelCorreo')}</span>
              <input autoFocus type="email" value={correoRecup} onChange={e => setCorreoRecup(e.target.value)}
                placeholder={t('login.placeholderCorreo')} autoComplete="username" />
            </label>
            <div className="auth-bloque">
              <p className="auth-bloque-titulo">{t('recupera.admin')}</p>
              <p className="auth-ayuda">{t('recupera.adminSub')}</p>
              <a className="auth-btn" href={enlaceSoporte()} target="_blank" rel="noopener noreferrer">{t('recupera.whatsapp')}</a>
            </div>
            <div className="auth-bloque">
              <p className="auth-bloque-titulo">{t('recupera.equipo')}</p>
              <p className="auth-ayuda">{t('recupera.equipoSub')}</p>
            </div>
            <button className="auth-enlace" type="button" onClick={() => setPaso(sup ? 'clave' : 'codigo')}>{t('recupera.volver')}</button>
          </>
        )}
      </form>
    </div>
  )
}
