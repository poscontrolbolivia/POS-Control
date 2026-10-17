import { leerAvisoLogin } from '../services/sesionPersistente.js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, guardarSesionSup } from '../services/store.jsx'
import { USAR_SUPABASE, SOPORTE_WHATSAPP } from '../config.js'
import { sb, rpc, fijarEmpresa, mensajeError } from '../services/supabase.js'
import { esSuper } from '../services/super/superApi.js'
import { useIdioma } from '../i18n/index.jsx'
import SelectorIdioma from '../i18n/SelectorIdioma.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import ThemeSelect from '../components/login/ThemeSelect.jsx'
import ShareAppButton from '../components/login/ShareAppButton.jsx'
import AppFooter from '../components/login/AppFooter.jsx'
import '../styles/auth.css'
import '../styles/login.css'

// Login de una sola pantalla (misma apariencia que Catering Control):
//  · EMPRESA: solo se ELIGE (no se escribe) de la lista de empresas creadas (RPC
//    public.empresas_para_login, en setup.sql). "Demo" es la empresa de prueba por defecto:
//    no pide usuario ni clave (se elige con qué rol entrar) y sus datos viven solo en este
//    navegador. Si la lista no carga, queda solo la Demo.
//  · Correo + clave (Supabase Auth). Tras 3 fallos seguidos el botón se bloquea 1 minuto con
//    cuenta regresiva (bloqueo del lado del navegador; Supabase Auth además limita por su lado).
//  · Pasos secundarios: 'empresas' (usuario con varias), 'alta' (crear negocio), 'recupera'.
// Props: { onEntrar }

const CODIGO_OK = /^[a-z0-9][a-z0-9._-]{2,23}$/
const CLAVE_MIN = 6
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEMO = '__demo__'
const MAX_FALLOS = 3
const BLOQUEO_MS = 60000
const LK = 'pos-login-bloqueo'
const LK_EMP = 'pos-ultima-empresa'

const leerBloq = () => { try { return JSON.parse(localStorage.getItem(LK)) || {} } catch { return {} } }
const guardarBloq = o => { try { localStorage.setItem(LK, JSON.stringify(o)) } catch { /* sin almacenamiento */ } }

const Ojo = ({ off }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {off ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a13.5 13.5 0 0 1-3.1 4.1M6.6 6.6C3.6 8.5 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.28 3.7-.75" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
      : <><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>
)

export default function LoginPage({ onEntrar }) {
  const { s } = useStore()
  const { t, tOr } = useIdioma()
  const [paso, setPaso] = useState('login') // 'login' | 'empresas' | 'alta' | 'recupera'
  const [lista, setLista] = useState(undefined) // undefined: cargando · null: sin RPC · []: sin empresas
  const [sel, setSel] = useState(DEMO)          // id de empresa elegida o DEMO (por defecto)
  const [demoRol, setDemoRol] = useState('admin')
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [error, setError] = useState('')
  // Si el guardia detectó que la sesión ya no sirve (token vencido/revocado), se explica aquí.
  useEffect(() => { if (leerAvisoLogin()) setError(t('login.sesionVencida')) }, []) // eslint-disable-line
  const [busy, setBusy] = useState(false)
  const [restante, setRestante] = useState(0)
  const [empresasUsuario, setEmpresasUsuario] = useState([])
  const [userRef, setUserRef] = useState(null)
  const [alta, setAlta] = useState({ negocio: '', codigo: '', nombre: '', correo: '', clave: '' })
  const [correoRecup, setCorreoRecup] = useState('')

  const demo = !USAR_SUPABASE || sel === DEMO
  const empresaElegida = lista?.find(x => x.id === sel) || null
  const nombreEmpresa = demo ? t('comun.miNegocio') : (empresaElegida?.nombre || '')

  // Carga la lista de empresas (solo código y nombre; nada de datos del negocio).
  useEffect(() => {
    if (!USAR_SUPABASE) { setLista(null); setSel(DEMO); return }
    let vivo = true
    rpc('empresas_para_login', {}, { conEmpresa: false })
      .then(f => {
        if (!vivo) return
        const l = Array.isArray(f) ? f : []
        setLista(l)
        let previa = ''
        try { previa = localStorage.getItem(LK_EMP) || '' } catch { /* noop */ }
        setSel(l.find(x => x.id === previa)?.id || DEMO)
      })
      .catch(() => { if (vivo) setLista(null) })
    return () => { vivo = false }
  }, [])

  // Cuenta regresiva del bloqueo por intentos fallidos (clave = empresa + usuario).
  const claveBloq = useMemo(() => `${sel}|${usuario.trim().toLowerCase()}`, [sel, usuario])
  useEffect(() => {
    const tick = () => {
      const hasta = leerBloq()[claveBloq]?.hasta || 0
      setRestante(Math.max(0, Math.ceil((hasta - Date.now()) / 1000)))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [claveBloq])

  // Devuelve cuántos intentos quedan (0 = recién bloqueado).
  const registrarFallo = () => {
    const o = leerBloq()
    const n = (o[claveBloq]?.n || 0) + 1
    if (n >= MAX_FALLOS) { o[claveBloq] = { n: 0, hasta: Date.now() + BLOQUEO_MS }; guardarBloq(o); setRestante(BLOQUEO_MS / 1000); return 0 }
    o[claveBloq] = { n }; guardarBloq(o)
    return MAX_FALLOS - n
  }
  const limpiarFallos = () => { const o = leerBloq(); delete o[claveBloq]; guardarBloq(o) }
  const mensajeFallo = quedan => (quedan > 0
    ? `${t('login.credencialesMal')} ${t('login.intentosRestantes', { n: quedan })}`
    : t('login.demasiadosIntentos', { segundos: BLOQUEO_MS / 1000 }))

  const irLogin = () => { setError(''); setPaso('login') }
  const irAlta = () => { setError(''); setAlta({ negocio: '', codigo: '', nombre: '', correo: '', clave: '' }); setPaso('alta') }
  const irRecupera = () => { setError(''); setCorreoRecup(CORREO_OK.test(usuario.trim()) ? usuario.trim() : ''); setPaso('recupera') }

  const entrar = async e => {
    e.preventDefault()
    if (restante > 0) return
    setError('')
    if (demo) {
      guardarSesionSup(null); fijarEmpresa(null)
      const u = (s.usuariosDemo || []).find(x => x.rol === demoRol) || { usuario: demoRol, rol: demoRol, nombre: tOr('rol.' + demoRol, demoRol) }
      onEntrar({ usuario: u.usuario, rol: u.rol, nombre: u.nombre, empresa: t('comun.miNegocio') })
      return
    }
    const emp = empresaElegida
    if (!emp) { setError(t('login.faltaEmpresa')); return }
    setBusy(true)
    try {
      try { localStorage.setItem(LK_EMP, emp.id) } catch { /* noop */ }
      const { data, error: errSign } = await sb.auth.signInWithPassword({ email: usuario.trim(), password: clave })
      if (errSign) {
        if (errSign.code === 'invalid_credentials' || /invalid login/i.test(errSign.message || '')) { setError(mensajeFallo(registrarFallo())); return }
        throw new Error(errSign.message || t('login.credencialesTecnicas'))
      }
      limpiarFallos()
      await trasLogin(data.user, emp)
    } catch (err) {
      setError(mensajeError(err))
      try { await sb.auth.signOut() } catch { /* noop */ }
    } finally { setBusy(false) }
  }

  // Tras CUALQUIER login de Supabase se resuelven las membresías. Con empresa elegida, el
  // usuario debe pertenecer a ELLA (el super de plataforma entra sin membresía).
  const trasLogin = async (user, elegida) => {
    setUserRef(user)
    const { data: memb, error: errM } = await sb.from('membresias').select('empresa_id, rol').eq('user_id', user.id)
    if (errM) throw new Error(errM.message)
    const ids = new Set((memb || []).map(m => m.empresa_id))
    let filas = []
    if (ids.size) {
      const { data: emps, error: errE } = await sb.from('empresas').select('id, nombre, moneda')
      if (errE) throw new Error(errE.message)
      filas = (emps || []).filter(x => ids.has(x.id))
    }
    const conRol = e2 => (memb || []).find(m => m.empresa_id === e2.id)?.rol || 'mesero'
    if (elegida) {
      const propia = filas.find(x => x.id === elegida.id)
      if (propia) { await listo(propia, conRol(propia), user); return }
      const superUsuario = await esSuper().catch(() => false)
      if (!superUsuario) throw new Error(t('login.noPerteneceEmpresa'))
      await listo(null, 'super', user)
      return
    }
    if (!filas.length) {
      const superUsuario = await esSuper().catch(() => false)
      if (!superUsuario) throw new Error(t('login.sinEmpresa'))
      await listo(null, 'super', user)
      return
    }
    if (filas.length === 1) { await listo(filas[0], conRol(filas[0]), user); return }
    setEmpresasUsuario(filas.map(x => ({ ...x, rol: conRol(x) })))
    setPaso('empresas')
  }

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
        options: { data: { alta_empresa: true, codigo_empresa: codigo, nombre_empresa: negocio, nombre: alta.nombre.trim(), display_name: alta.nombre.trim() } },
      })
      if (errSign) throw new Error(errSign.message || t('alta.fallo'))
      if (!data.user) throw new Error(t('alta.fallo'))
      if (!data.session) { await sb.auth.signOut().catch(() => {}); throw new Error(t('alta.revisaCorreo')) }
      await trasLogin(data.user, null)
    } catch (err) {
      const msg = mensajeError(err)
      setError(msg.includes('alta_codigo_tomado') ? t('alta.codigoTomado') : msg)
      try { await sb.auth.signOut() } catch { /* noop */ }
    } finally { setBusy(false) }
  }

  // listo(): cierra el login. `es_super` solo decide si App pinta el módulo Super; el permiso
  // real lo comprueba la base en cada RPC.
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

  const enlaceSoporte = (texto) => `https://wa.me/${SOPORTE_WHATSAPP}?text=${encodeURIComponent(texto)}`
  const enlaceRecupera = () => enlaceSoporte(t('recupera.mensaje', { empresa: nombreEmpresa || '—', correo: correoRecup.trim() || '—' }))
  const campo = k => e => setAlta(a => ({ ...a, [k]: e.target.value }))
  const ENVIO = { login: entrar, alta: crearNegocio }

  return (
    <main className="lg-page">
      <section className="lg-card">
        <div className="lg-brand">
          <div className="lg-mark"><BrandMark size={72} /></div>
          <div className="lg-info">
            <h1>POS Control</h1>
            <div className="lg-tools"><ThemeSelect /><SelectorIdioma /><ShareAppButton /></div>
          </div>
        </div>

        <form className="lg-form" onSubmit={e => (ENVIO[paso] ? ENVIO[paso](e) : e.preventDefault())}>
          {paso === 'login' && (
            <>
              <label className="lg-campo">
                <span>{t('login.selEmpresa')}</span>
                <select value={sel} onChange={e => { setSel(e.target.value); setError('') }} disabled={lista === undefined}>
                  <option value={DEMO}>{t('login.empresaDemo')}</option>
                  {(lista || []).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
                {USAR_SUPABASE && lista === null && <small className="auth-ayuda">{t('login.listaNoDisponible')}</small>}
              </label>
              {demo ? (
                <>
                  <label className="lg-campo">
                    <span>{t('login.entrarComo')}</span>
                    <select value={demoRol} onChange={e => setDemoRol(e.target.value)}>
                      {['admin', 'cajero', 'mesero'].map(r => <option key={r} value={r}>{tOr('rol.' + r, r)}</option>)}
                    </select>
                  </label>
                  <p className="lg-demo">{t('login.demoAviso')}</p>
                </>
              ) : (
                <>
                  <label className="lg-campo">
                    <span>{t('login.labelCorreo')}</span>
                    <input value={usuario} onChange={e => setUsuario(e.target.value)} placeholder={t('login.placeholderCorreo')} autoComplete="username" required />
                  </label>
                  <label className="lg-campo">
                    <span>{t('login.labelClave')}</span>
                    <div className="lg-clave">
                      <input type={verClave ? 'text' : 'password'} value={clave} onChange={e => setClave(e.target.value)} placeholder="••••" autoComplete="current-password" required />
                      <button type="button" onClick={() => setVerClave(v => !v)} aria-label={verClave ? t('login.ocultarClave') : t('login.mostrarClave')}><Ojo off={verClave} /></button>
                    </div>
                  </label>
                </>
              )}
              {!demo && (restante > 0
                ? <p className="lg-alerta lg-bloqueo" role="alert">{t('login.demasiadosIntentos', { segundos: restante })}</p>
                : error && <p className="lg-alerta" role="alert">{error}</p>)}
              {demo && error && <p className="lg-alerta" role="alert">{error}</p>}
              <button className="cc-btn cc-blue" type="submit" disabled={busy || (!demo && restante > 0)}>
                {busy ? t('login.entrando') : demo ? t('login.entrarDemo') : t('login.entrar')}
              </button>
              {USAR_SUPABASE && <button className="cc-btn cc-yellow" type="button" onClick={irAlta}>{t('login.nuevoAqui')}</button>}
              <a className="cc-btn cc-whatsapp" href={enlaceSoporte(t('login.mensajeSoporte'))} target="_blank" rel="noopener noreferrer">{t('login.soporte')}</a>
              {!demo && <button className="lg-olvido" type="button" onClick={irRecupera}>{t('login.olvidaste')}</button>}
            </>
          )}

          {paso === 'empresas' && (
            <>
              <h2>{t('login.titulo3')}</h2>
              <p className="auth-sub">{t('login.sub3')}</p>
              {empresasUsuario.map(emp => (
                <button key={emp.id} type="button" className="cc-btn cc-blue" onClick={() => listo(emp, emp.rol, userRef)}>
                  {emp.nombre} <small>({tOr('rol.' + emp.rol, emp.rol)})</small>
                </button>
              ))}
              {error && <p className="lg-alerta">{error}</p>}
              <button className="lg-link" type="button" onClick={irLogin}>{t('login.cambiarUsuario')}</button>
            </>
          )}

          {paso === 'alta' && (
            <>
              <h2>{t('alta.titulo')}</h2>
              <p className="auth-sub">{t('alta.sub')}</p>
              <label className="lg-campo"><span>{t('alta.labelNegocio')}</span>
                <input autoFocus value={alta.negocio} onChange={campo('negocio')} placeholder={t('alta.placeholderNegocio')} autoComplete="organization" maxLength={80} />
              </label>
              <label className="lg-campo"><span>{t('alta.labelCodigo')}</span>
                <input value={alta.codigo} onChange={e => setAlta(a => ({ ...a, codigo: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                  placeholder={t('alta.placeholderCodigo')} spellCheck={false} autoComplete="off" maxLength={24} />
                <small className="auth-ayuda">{t('alta.helpCodigo')}</small>
              </label>
              <label className="lg-campo"><span>{t('alta.labelEncargado')}</span>
                <input value={alta.nombre} onChange={campo('nombre')} placeholder={t('alta.placeholderEncargado')} autoComplete="name" />
              </label>
              <label className="lg-campo"><span>{t('alta.labelCorreo')}</span>
                <input type="email" value={alta.correo} onChange={campo('correo')} placeholder={t('login.placeholderCorreo')} autoComplete="email" />
              </label>
              <label className="lg-campo"><span>{t('alta.labelClave')}</span>
                <input type="password" value={alta.clave} onChange={campo('clave')} placeholder="••••••" autoComplete="new-password" />
                <small className="auth-ayuda">{t('alta.helpClave')}</small>
              </label>
              {error && <p className="lg-alerta">{error}</p>}
              <button className="cc-btn cc-green" type="submit" disabled={busy}>{busy ? t('alta.creando') : t('alta.crear')}</button>
              <p className="auth-aviso">{t('alta.aviso')}</p>
              <button className="lg-link" type="button" onClick={irLogin}>{t('alta.volver')}</button>
              <p className="auth-legal"><Link to="/terminos">{t('legal.terms.title')}</Link> · <Link to="/privacidad">{t('legal.privacy.title')}</Link></p>
            </>
          )}

          {paso === 'recupera' && (
            <>
              <h2>{t('recupera.titulo')}</h2>
              <p className="auth-sub">{t('recupera.sub')} <b>{nombreEmpresa}</b></p>
              <label className="lg-campo"><span>{t('recupera.labelCorreo')}</span>
                <input autoFocus type="email" value={correoRecup} onChange={e => setCorreoRecup(e.target.value)} placeholder={t('login.placeholderCorreo')} autoComplete="username" />
              </label>
              <div className="auth-bloque">
                <p className="auth-bloque-titulo">{t('recupera.admin')}</p>
                <p className="auth-ayuda">{t('recupera.adminSub')}</p>
                <a className="cc-btn cc-whatsapp" href={enlaceRecupera()} target="_blank" rel="noopener noreferrer">{t('recupera.whatsapp')}</a>
              </div>
              <div className="auth-bloque">
                <p className="auth-bloque-titulo">{t('recupera.equipo')}</p>
                <p className="auth-ayuda">{t('recupera.equipoSub')}</p>
              </div>
              <button className="lg-link" type="button" onClick={irLogin}>{t('recupera.volver')}</button>
            </>
          )}
        </form>
      </section>
      <AppFooter />
    </main>
  )
}
