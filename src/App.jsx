import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useStore, leerSesionSup, guardarSesionSup } from './context/StoreContext.jsx'
import { USAR_SUPABASE } from './services/config.js'
import { sb, fijarEmpresa, fijarEmpresaSesion } from './services/supabaseClient.js'
import { salirDeEmpresa } from './services/super/superApi.js'
import { iniciarGuardiaSesion } from './services/session.js'
import PwaBanners from './components/PwaBanners.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PanelPage from './pages/PanelPage.jsx'
import TerminosPage from './pages/TerminosPage.jsx'
import PrivacidadPage from './pages/PrivacidadPage.jsx'

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

  const salir = () => {
    if (sesion?.operando) salirDeEmpresa().catch(() => {  })
    if (sesion?.supabase) {
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
    </>
  )
}
