import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, guardarSesionSup } from '../services/store.jsx'
import { USAR_SUPABASE } from '../config.js'
import { sb, rpc, fijarEmpresa, mensajeError } from '../services/supabase.js'
import { esSuper } from '../services/super/superApi.js'
import { useIdioma } from '../i18n/index.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import '../styles/auth.css'

// Login en 2 pasos.
//  · Supabase: 1) CÓDIGO de empresa (RPC public.empresa_por_codigo) 2) email+clave
//    (signInWithPassword) → membresías: si tiene 1 empresa entra directo, si tiene
//    varias elige. Guarda la sesión en localStorage 'pos-sesion' (StoreProvider la lee).
//    Escribir el código "demo" cae al flujo demo de siempre.
//  · Demo (o USAR_SUPABASE=false): cualquier nombre de empresa + usuariosDemo.
// Los textos visibles pasan por t(): el idioma se elige desde el Topbar y se guarda en
// 'pos-idioma-app'. El código 'demo' NO se traduce: es un valor técnico.
// Props: { onEntrar } — onEntrar({ usuario, rol, nombre, empresa, ... })
export default function LoginPage({ onEntrar }) {
  const { s } = useStore()
  const { t, tOr } = useIdioma()
  const [paso, setPaso] = useState(1)
  const [empresa, setEmpresa] = useState(s.config?.nombre || t('comun.miNegocio'))
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Flujo Supabase:
  const [sup, setSup] = useState(false)          // true: el código de empresa resolvió a una empresa real
  const [empresaSup, setEmpresaSup] = useState(null) // {id, nombre, moneda}
  const [empresasUsuario, setEmpresasUsuario] = useState([]) // membresías tras login (si >1 se muestra picker)
  const [userRef, setUserRef] = useState(null)               // auth.user tras signInWithPassword (paso 3)

  const esDemo = codigo => codigo.trim().toLowerCase() === 'demo'

  // El sandbox local necesita un acceso propio: si una empresa real de la base usa el código
  // "demo", escribirlo entra en Supabase (su dueño debe poder entrar), así que el modo sin
  // cuenta no puede depender de esa palabra.
  const irDemo = () => {
    setError('')
    guardarSesionSup(null)
    fijarEmpresa(null)
    setEmpresa('demo'); setSup(false); setPaso(2)
  }

  const continuar = async e => {
    e.preventDefault()
    const codigo = empresa.trim()
    if (!codigo) { setError(t('login.faltaCodigo')); return }
    if (!USAR_SUPABASE) { // sin base configurada: paso 2 con los usuariosDemo locales
      setError(''); setSup(false); setPaso(2)
      return
    }
    setError(''); setBusy(true)
    try {
      // Primero siempre se pregunta a Supabase: un negocio real puede llamarse "demo"
      // y su dueño debe poder entrar con su código. El modo de prueba local solo se
      // usa cuando el código NO existe en la base (y escribe "demo").
      const filas = await rpc('empresa_por_codigo', { p_codigo: codigo }, { conEmpresa: false })
      if (filas && filas.length) { setEmpresaSup(filas[0]); setSup(true); setPaso(2); return }
      if (esDemo(codigo)) { setError(''); setSup(false); setPaso(2); return }
      setError(t('login.codigoNoEncontrado'))
    } catch (err) {
      if (esDemo(codigo)) { setError(''); setSup(false); setPaso(2); return } // sin base: prueba local
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
      const user = data.user
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
      setPaso(3) // multiempresa: elegir
    } catch (err) {
      setError(mensajeError(err))
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

  return (
    <div className="auth-pantalla">
      <form className="auth-tarjeta" onSubmit={paso === 1 ? continuar : entrar}>
        <div className="auth-marca">
          <BrandMark className="auth-logo" />
          <h1>POS Control</h1>
        </div>

        {paso === 1 ? (
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
            {USAR_SUPABASE && <button className="auth-enlace" type="button" onClick={irDemo}>{t('login.probarDemo')}</button>}
            <p className="auth-legal">
              <Link to="/terminos">{t('legal.terms.title')}</Link> · <Link to="/privacidad">{t('legal.privacy.title')}</Link>
            </p>
          </>
        ) : paso === 2 ? (
          <>
            <h2>{t('login.titulo2')}</h2>
            <p className="auth-sub">
              {t('login.empresa')} <b>{sup ? empresaSup?.nombre : empresa}</b>{' '}
              <button className="auth-enlace" type="button" onClick={() => { setError(''); setSup(false); setPaso(1) }}>{t('login.cambiar')}</button>
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
            {!sup && (
              <p className="auth-demo">
                {t('login.demoPrefijo')} {['admin', 'cajero', 'mesero'].map(u => <code key={u}>{u}/1234</code>)}
              </p>
            )}
          </>
        ) : (
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
            <button className="auth-enlace" type="button" onClick={() => { setError(''); setPaso(1) }}>{t('login.cambiarUsuario')}</button>
          </>
        )}
      </form>
    </div>
  )
}
