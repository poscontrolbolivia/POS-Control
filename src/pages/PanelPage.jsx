import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useStore } from '../context/StoreContext.jsx'
import { puede } from '../services/permissions.js'
import { suscribirVista } from '../services/notifications.js'
import { useIdioma } from '../i18n/index.jsx'
import Topbar from '../components/panel/Topbar.jsx'
import HallPage from '../components/panel/hall/HallPage.jsx'
import CashPage from '../components/panel/cash/CashPage.jsx'
import QuickSalePage from '../components/panel/quicksale/QuickSalePage.jsx'
import KitchenPage from '../components/panel/kitchen/KitchenPage.jsx'
import MenuPage from '../components/panel/menu/MenuPage.jsx'
import SettingsPage from '../components/panel/settings/SettingsPage.jsx'
import { iniciarEstacion, detenerEstacion, estacionRecordada, actualizarConfig, autoConfigurarAgente } from '../services/station.js'
import { gruposDe } from '../services/printing.js'

const AuditPage = lazy(() => import('../components/panel/audit/AuditPage.jsx'))
const InventoryPage = lazy(() => import('../components/panel/inventory/InventoryPage.jsx'))
const SuperPage = lazy(() => import('../components/panel/super/SuperPage.jsx'))
const StationPage = lazy(() => import('../components/panel/station/StationPage.jsx'))

const VISTAS = { '#salon': 'salon', '#cocina': 'cocina', '#caja': 'caja', '#estacion': 'estacion', '#venta': 'venta', '#menu': 'menu', '#config': 'config', '#auditoria': 'auditoria', '#inventario': 'inventario' }

const EN_PANTALLA = ['cocina', 'barra']

export default function PanelPage({ sesion, onSalir, onVolver, aviso = '' }) {
  const { s } = useStore()
  const { t, tOr } = useIdioma()
  const enPantalla = EN_PANTALLA.includes(sesion.rol)

  const [modulo, setModulo] = useState(
    sesion.es_super && !sesion.empresaId ? 'super' : enPantalla ? 'cocina' : 'salon'
  )

  const modulos = []
  if (enPantalla) {
    modulos.push({ id: 'cocina', nombre: tOr('app.mod.cocina', 'Cocina') })
  } else {
    modulos.push({ id: 'salon', nombre: t('app.mod.salon') }, { id: 'caja', nombre: t('app.mod.caja') }, { id: 'venta', nombre: t('app.mod.venta') })
    if (puede(sesion.rol, 'ver_cocina')) modulos.push({ id: 'cocina', nombre: tOr('app.mod.cocina', 'Cocina') })
  }
  if (puede(sesion.rol, 'gestionar_menu')) modulos.push({ id: 'menu', nombre: t('app.mod.menu') })
  if (sesion.supabase && (sesion.rol === 'admin' || sesion.rol === 'cajero')) modulos.push({ id: 'estacion', nombre: t('app.mod.estacion') })
  if (puede(sesion.rol, 'ver_inventario')) modulos.push({ id: 'inventario', nombre: tOr('app.mod.inventario', 'Inventario') })
  if (puede(sesion.rol, 'ver_auditoria')) modulos.push({ id: 'auditoria', nombre: tOr('app.mod.auditoria', 'Auditoría') })
  modulos.push({ id: 'config', nombre: t('app.mod.config') })
  if (sesion.es_super) modulos.push({ id: 'super', nombre: tOr('app.mod.super', 'Super') })

  const configRef = useRef(s.config)
  configRef.current = s.config
  useEffect(() => { actualizarConfig(() => configRef.current || {}) }, [s.config])
  const puedeEstacion = Boolean(sesion.supabase) && (sesion.rol === 'admin' || sesion.rol === 'cajero')
  useEffect(() => {
    if (!puedeEstacion) return undefined
    if (estacionRecordada()) iniciarEstacion(() => configRef.current || {})
    return () => detenerEstacion({ recordar: true })
  }, [puedeEstacion, sesion.empresaId])

  useEffect(() => {
    if (puedeEstacion) autoConfigurarAgente(gruposDe(configRef.current || {}))
  }, [puedeEstacion, sesion.empresaId])

  const permitidos = modulos.map(m => m.id).join(',')
  useEffect(() => {
    const aplicar = hash => {
      const destino = VISTAS[hash]
      if (destino && permitidos.split(',').includes(destino)) setModulo(destino)
    }
    aplicar(window.location.hash)

    const alCambiar = () => aplicar(window.location.hash)
    window.addEventListener('hashchange', alCambiar)
    const dejarEscucha = suscribirVista((_destino, hash) => aplicar(hash))
    return () => {
      window.removeEventListener('hashchange', alCambiar)
      dejarEscucha()
    }
  }, [permitidos])

  return (
    <div className="app">
      <Topbar sesion={{ ...sesion, empresa: sesion.empresa || s.config.nombre }} modulo={modulo} modulos={modulos}
        onModulo={setModulo} onSalir={onSalir} aviso={aviso || undefined} />
      {sesion.operando && (
        <div className="topbar-rol" style={{ background: 'var(--warn-line)', color: 'var(--on-btn)', padding: '6px 14px', borderRadius: 0, display: 'block', width: '100%', textAlign: 'center' }}>
          {tOr('super.banner.viendo', 'Estás viendo la empresa')} <b>{sesion.empresa}</b> —{' '}
          <button className="auth-enlace" type="button" onClick={onVolver}>{tOr('super.banner.volver', 'volver a mi empresa')}</button>
        </div>
      )}
      {s._supCargando && <div className="auth-aviso" role="status" style={{ padding: '8px 16px' }}>{t('app.conectando')}</div>}
      <Suspense fallback={<div className="auth-aviso" role="status" style={{ padding: '8px 16px' }}>{t('app.conectando')}</div>}>
        {modulo === 'salon' && <HallPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'caja' && <CashPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'venta' && <QuickSalePage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'cocina' && <KitchenPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'menu' && <MenuPage rol={sesion.rol} />}
        {modulo === 'estacion' && <StationPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'inventario' && <InventoryPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'auditoria' && <AuditPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'config' && <SettingsPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'super' && sesion.es_super && <SuperPage sesion={sesion} />}
      </Suspense>
    </div>
  )
}
