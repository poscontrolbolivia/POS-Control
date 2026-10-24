import { Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useStore, leerSesionSup, guardarSesionSup } from './context/StoreContext.jsx'
import { USAR_SUPABASE } from './services/config.js'
import { sb, fijarEmpresa, fijarEmpresaSesion, rpc } from './services/supabaseClient.js'
import { salirDeEmpresa } from './services/super/superApi.js'
import { iniciarGuardiaSesion } from './services/session.js'
import PwaBanners from './components/PwaBanners.jsx'
import { lazyRetry } from './services/lazyRetry.js'
import LoginPage from './pages/LoginPage.jsx'

// El login sale primero y liviano; el panel (y las páginas legales) se descargan aparte. Mientras la
// persona escribe su usuario, el panel se baja en segundo plano, así al entrar ya está listo.
const cargarPanel = () => import('./pages/PanelPage.jsx')
const PanelPage = lazyRetry(cargarPanel)
const TerminosPage = lazyRetry(() => import('./pages/TerminosPage.jsx'))
const PrivacidadPage = lazyRetry(() => import('./pages/PrivacidadPage.jsx'))
const enReposo = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 800))
if (typeof window !== 'undefined') enReposo(() => { cargarPanel().catch(() => {}) })

export default function App() {
  return (
    <BrowserRouter>
      <Rutas />
    </BrowserRouter>
  )
}

function Rutas() {
  const { s, error } = useStore()
  const navegar = useNavigate()
  const { hash } = useLocation()

  const [sesion, setSesion] = useState(() => {
    const sSup = leerSesionSup()
    return sSup && USAR_SUPABASE ? sSup : null
  })

  const entrar = u => setSesion(u)

  useEffect(() => {
    const refrescar = () => setSesion(USAR_SUPABASE ? leerSesionSup() : null)
    window.addEventListener('pos-sesion', refrescar)
    return () => window.removeEventListener('pos-sesion', refrescar)
  }, [])

  useEffect(() => {
    if (sesion?.supabase && sesion?.operando && sesion?.empresaId) {
      fijarEmpresaSesion(sesion.empresaId).catch(() => {  })
    }
  }, [sesion?.supabase, sesion?.operando, sesion?.empresaId])

  useEffect(() => {
    if (!USAR_SUPABASE) return undefined
    return iniciarGuardiaSesion(() => {
      guardarSesionSup(null)
      fijarEmpresa(null)
      try { sb?.auth.signOut({ scope: 'local' }) } catch {  }
      setSesion(null)
      navegar('/')
    })
  }, [])

  const volverDeEmpresa = async () => {

    try { await salirDeEmpresa() } catch {  }
    window.location.reload()
  }

  const salir = async () => {
    if (sesion?.operando) salirDeEmpresa().catch(() => {  })
    if (sesion?.supabase) {
      // La salida se anota ANTES de tirar el token y de limpiar la empresa: sin sesión no hay quién
      // firme la fila y el turno quedaría abierto para siempre en la bitácora.
      try {
        await Promise.race([rpc('registrar_salida', {}, { conEmpresa: false }), new Promise(r => setTimeout(r, 1200))])
      } catch {  }
      guardarSesionSup(null)
      fijarEmpresa(null)
      try { sb?.auth.signOut() } catch {  }
    }
    setSesion(null)
    navegar('/')
  }

  return (
    <>
    <PwaBanners />
    <Suspense fallback={<div className="auth-aviso" role="status" aria-live="polite" style={{ padding: '8px 16px' }}>…</div>}>
    <Routes>
      <Route path="/terminos" element={<TerminosPage />} />
      <Route path="/privacidad" element={<PrivacidadPage />} />
      <Route path="/" element={sesion ? <Navigate to={'/panel' + hash} replace /> : <LoginPage onEntrar={entrar} />} />
      <Route
        path="/panel"
        element={sesion
          ? <PanelPage sesion={{ ...sesion, empresa: sesion.empresa || s.config?.nombre }} onSalir={salir} onVolver={volverDeEmpresa} aviso={error} />
          : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  )
}
