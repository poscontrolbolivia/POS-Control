import { useEffect, useState } from 'react'
import { useStore, leerSesionSup, guardarSesionSup } from './services/store.jsx'
import { puede } from './services/permisos.js'
import { USAR_SUPABASE } from './config.js'
import { sb, fijarEmpresa, fijarEmpresaSesion } from './services/supabase.js'
import { salirDeEmpresa } from './services/super/superApi.js'
import { useIdioma } from './i18n/index.jsx'
import LoginPage from './components/auth/LoginPage.jsx'
import Topbar from './components/auth/Topbar.jsx'
import SalonPage from './components/salon/SalonPage.jsx'
import CajaPage from './components/caja/CajaPage.jsx'
import VentaDirecta from './components/venta/VentaDirecta.jsx'
import MenuAdmin from './components/admin/MenuAdmin.jsx'
import ConfigAdmin from './components/admin/ConfigAdmin.jsx'
import SuperPage from './components/super/SuperPage.jsx'

export default function App() {
  const { s, error } = useStore()
  const { t, tOr } = useIdioma()
  // Sesión Supabase se reanuda desde localStorage 'pos-sesion' (la lee el StoreProvider);
  // la sesión demo vive solo en memoria, como siempre.
  const [sesion, setSesion] = useState(() => {
    const sSup = leerSesionSup()
    return sSup && USAR_SUPABASE ? sSup : null
  })
  // Un super sin empresa (dueño de la plataforma sin membresías) arranca directo en su panel;
  // un super "operando" otra empresa arranca en el salón de ESA empresa.
  const [modulo, setModulo] = useState(() => {
    const sSup = USAR_SUPABASE ? leerSesionSup() : null
    return sSup?.es_super && !sSup.empresaId ? 'super' : 'salon'
  })

  const entrar = u => { setSesion(u); setModulo(u.es_super && !u.empresaId ? 'super' : 'salon') }

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
  }

  if (!sesion) return <LoginPage onEntrar={entrar} />

  // Los ids de módulo NO se traducen (son el estado de navegación); solo la etiqueta visible.
  const modulos = [{ id: 'salon', nombre: t('app.mod.salon') }, { id: 'caja', nombre: t('app.mod.caja') }, { id: 'venta', nombre: t('app.mod.venta') }]
  if (puede(sesion.rol, 'gestionar_menu')) modulos.push({ id: 'menu', nombre: t('app.mod.menu') })
  if (sesion.rol === 'admin') modulos.push({ id: 'config', nombre: t('app.mod.config') })
  if (sesion.es_super) modulos.push({ id: 'super', nombre: tOr('app.mod.super', 'Super') })

  return (
    <div className="app">
      <Topbar sesion={{ ...sesion, empresa: sesion.empresa || s.config.nombre }} modulo={modulo} modulos={modulos}
        onModulo={setModulo} onSalir={salir} aviso={error || undefined} />
      {/* Aviso permanente mientras el super opera otra empresa: cubre Salón/Caja/Venta, no solo el panel */}
      {sesion.operando && (
        <div className="topbar-rol" style={{ background: '#8a6d1a', color: '#fff', padding: '6px 14px', borderRadius: 0, display: 'block', width: '100%', textAlign: 'center' }}>
          👁️ {tOr('super.banner.viendo', 'Estás viendo la empresa')} <b>{sesion.empresa}</b> —{' '}
          <button className="auth-enlace" type="button" onClick={volverDeEmpresa}>{tOr('super.banner.volver', 'volver a mi empresa')}</button>
        </div>
      )}
      {s._supCargando && <div className="auth-aviso" role="status" style={{ padding: '8px 16px' }}>{t('app.conectando')}</div>}
      {modulo === 'salon' && <SalonPage rol={sesion.rol} sesion={sesion} />}
      {modulo === 'caja' && <CajaPage rol={sesion.rol} sesion={sesion} />}
      {modulo === 'venta' && <VentaDirecta rol={sesion.rol} sesion={sesion} />}
      {modulo === 'menu' && <MenuAdmin rol={sesion.rol} />}
      {modulo === 'config' && <ConfigAdmin rol={sesion.rol} sesion={sesion} />}
      {modulo === 'super' && sesion.es_super && <SuperPage sesion={sesion} />}
    </div>
  )
}
