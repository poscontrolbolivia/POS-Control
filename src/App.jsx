import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useStore, leerSesionSup, guardarSesionSup } from './services/store.jsx'
import { USAR_SUPABASE } from './config.js'
import { sb, fijarEmpresa, fijarEmpresaSesion } from './services/supabase.js'
import { salirDeEmpresa } from './services/super/superApi.js'
import LoginPage from './pages/LoginPage.jsx'
import PanelPage from './pages/PanelPage.jsx'
import TerminosPage from './pages/TerminosPage.jsx'
import PrivacidadPage from './pages/PrivacidadPage.jsx'

// POS Control es UN solo index.html (una SPA), igual que Catering Control: el login no es
// otra web, es la ruta '/'. Antes, en la versión vanilla de Catering, sí eran archivos .html
// separados (login.html / app.js); hoy son rutas: '/' login · '/panel' la app · '/terminos'
// y '/privacidad' las legales. El service worker responde cualquier ruta con /index.html, así
// que /panel se puede abrir directo o pegar por enlace.
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
  // Sesión Supabase se reanuda desde localStorage 'pos-sesion' (la lee el StoreProvider);
  // la sesión demo vive solo en memoria, como siempre.
  const [sesion, setSesion] = useState(() => {
    const sSup = leerSesionSup()
    return sSup && USAR_SUPABASE ? sSup : null
  })

  // Entrar es solo cambiar el estado: la ruta '/' se encarga de mandar al panel. Si además
  // llamáramos navegar('/panel') aquí, React enjuagaría el estado después del cambio de URL,
  // '/panel' montaría aún sin sesión y rebotaría a '/', perdiendo el hash del atajo o aviso.
  const entrar = u => setSesion(u)

  // El panel de super cambia 'pos-sesion' en caliente (Entrar/Salir); el store ya escucha el
  // evento, pero App guarda su propia copia de la sesión: sin esto el banner "estás viendo la
  // empresa X" no aparecería hasta recargar.
  useEffect(() => {
    const refrescar = () => setSesion(USAR_SUPABASE ? leerSesionSup() : null)
    window.addEventListener('pos-sesion', refrescar)
    return () => window.removeEventListener('pos-sesion', refrescar)
  }, [])

  // Tras una recarga con la sesión en modo "operando", el GUC app.empresa_id de la conexión
  // anclada se perdió: volvemos a fijarlo con el cliente compartido (X-Session-Id) para que
  // los SELECT directos del salón/caja sigan viendo la empresa correcta.
  useEffect(() => {
    if (sesion?.supabase && sesion?.operando && sesion?.empresaId) {
      fijarEmpresaSesion(sesion.empresaId).catch(() => { /* sin base o sin permisos: el panel avisa */ })
    }
  }, [sesion?.supabase, sesion?.operando, sesion?.empresaId])

  const volverDeEmpresa = async () => {
    // "volver a mi empresa": restaura la sesión real del super, fija su empresa en la conexión
    // anclada y recarga para que todo el árbol de React arranque con los datos correctos.
    try { await salirDeEmpresa() } catch { /* noop: abajo siempre recargamos */ }
    window.location.reload()
  }

  const salir = () => {
    if (sesion?.operando) salirDeEmpresa().catch(() => { /* noop */ }) // borra 'pos-super-sesion-anterior' y el modo operando
    if (sesion?.supabase) {
      guardarSesionSup(null)
      fijarEmpresa(null)
      try { sb?.auth.signOut() } catch { /* noop */ }
    }
    setSesion(null)
    navegar('/')
  }

  return (
    <Routes>
      <Route path="/terminos" element={<TerminosPage />} />
      <Route path="/privacidad" element={<PrivacidadPage />} />
      {/* El hash se conserva al saltar al panel: es cómo un aviso pulsado o un atajo del ícono
          de la PWA (/#salon, /#cocina, /#caja) abre la vista pedida aunque hiciera falta loguearse. */}
      <Route path="/" element={sesion ? <Navigate to={'/panel' + hash} replace /> : <LoginPage onEntrar={entrar} />} />
      <Route
        path="/panel"
        element={sesion
          ? <PanelPage sesion={{ ...sesion, empresa: sesion.empresa || s.config?.nombre }} onSalir={salir} onVolver={volverDeEmpresa} aviso={error} />
          : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
