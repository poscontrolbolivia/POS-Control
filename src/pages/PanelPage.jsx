import { Suspense, useEffect, useRef, useState } from 'react'
import { lazyRetry } from '../services/lazyRetry.js'
import ChunkBoundary from '../components/ChunkBoundary.jsx'
import { useStore } from '../context/StoreContext.jsx'
import { puede, fijarPermisosExtra } from '../services/permissions.js'
import { rpc } from '../services/supabaseClient.js'
import { suscribirVista } from '../services/notifications.js'
import { useIdioma } from '../i18n/index.jsx'
import Topbar from '../components/panel/Topbar.jsx'
import PantallaCarga from '../components/PantallaCarga.jsx'
import HallPage from '../components/panel/hall/HallPage.jsx'
import CashPage from '../components/panel/cash/CashPage.jsx'
import QuickSalePage from '../components/panel/quicksale/QuickSalePage.jsx'
import KitchenPage from '../components/panel/kitchen/KitchenPage.jsx'
import MenuPage from '../components/panel/menu/MenuPage.jsx'
import SettingsPage from '../components/panel/settings/SettingsPage.jsx'
import { iniciarEstacion, detenerEstacion, estacionRecordada, actualizarConfig, autoConfigurarAgente } from '../services/station.js'
import { gruposDe } from '../services/printing.js'
import { contarAbiertas } from '../services/alertasApi.js'

const AuditPage = lazyRetry(() => import('../components/panel/audit/AuditPage.jsx'))
const InventoryPage = lazyRetry(() => import('../components/panel/inventory/InventoryPage.jsx'))
const ReportsPage = lazyRetry(() => import('../components/panel/reports/ReportsPage.jsx'))
const AlertasPage = lazyRetry(() => import('../components/panel/alerts/AlertasPage.jsx'))
const SuperPage = lazyRetry(() => import('../components/panel/super/SuperPage.jsx'))

const VISTAS = { '#salon': 'salon', '#cocina': 'cocina', '#caja': 'caja', '#estacion': 'config', '#venta': 'venta', '#menu': 'menu', '#config': 'config', '#auditoria': 'auditoria', '#inventario': 'inventario', '#reportes': 'reportes', '#alertas': 'alertas' }

// Enlaces profundos de impresión: #estacion (la PC de la estación), #grupo-<id> y los nombres de
// submenú de Impresoras. Todos aterrizan en Configuración; PrintersCard lee el mismo hash para saber
// qué submenú venir abierto.
const HASH_IMPRESION = /^#(estacion|grupo-[a-z0-9-]+|grupos|contenido|papel|donde|sonido)$/

const EN_PANTALLA = ['cocina', 'barra']

export default function PanelPage({ sesion, onSalir, onVolver, aviso = '' }) {
  const { s, error } = useStore()
  const { t, tOr } = useIdioma()
  const enPantalla = EN_PANTALLA.includes(sesion.rol)

  // Permisos que el admin otorgó a esta persona (ver/gestionar inventario). En la base salen de
  // mis_permisos; en demo, del usuario demo. El admin los tiene siempre (puede() ya lo sabe).
  const [, setPermTick] = useState(0)
  const permisosDemo = sesion.supabase ? null : ((s.usuariosDemo || []).find(u => u.usuario === sesion.usuario)?.permisos || [])
  const claveDemo = permisosDemo ? permisosDemo.join(',') : ''
  useEffect(() => {
    let vivo = true
    if (sesion.supabase) {
      fijarPermisosExtra([])
      setPermTick(n => n + 1)
      rpc('mis_permisos', {}).then(r => { if (vivo) { fijarPermisosExtra(r); setPermTick(n => n + 1) } }).catch(() => {})
    } else {
      fijarPermisosExtra(claveDemo ? claveDemo.split(',') : [])
      setPermTick(n => n + 1)
    }
    return () => { vivo = false }
  }, [sesion.supabase, sesion.empresaId, sesion.usuario, claveDemo])

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
  if (puede(sesion.rol, 'ver_alertas')) modulos.push({ id: 'alertas', nombre: tOr('app.mod.alertas', 'Alertas'), contador: contarAbiertas(s.alertas) })
  if (puede(sesion.rol, 'gestionar_menu')) modulos.push({ id: 'menu', nombre: t('app.mod.menu') })
  if (puede(sesion.rol, 'ver_reportes')) modulos.push({ id: 'reportes', nombre: tOr('app.mod.reportes', 'Reportes') })
  if (puede(sesion.rol, 'ver_inventario')) modulos.push({ id: 'inventario', nombre: tOr('app.mod.inventario', 'Inventario') })
  if (puede(sesion.rol, 'ver_auditoria')) modulos.push({ id: 'auditoria', nombre: tOr('app.mod.auditoria', 'Auditoría') })
  modulos.push({ id: 'config', nombre: t('app.mod.config') })
  if (sesion.es_super) modulos.push({ id: 'super', nombre: tOr('app.mod.super', 'Super') })

  const [foco, setFoco] = useState(null)
  // `desde` le dice al Salón de dónde vino el toque: desde Caja abre la cuenta en modo cobro.
  const abrirDeAlerta = ({ mesaId, cuentaId, desde }) => {
    setFoco({ mesaId: mesaId || null, cuentaId: cuentaId || null, desde: desde || null, seq: Date.now() })
    setModulo('salon')
  }
  // El cajero cobra de mesa en mesa: al terminar, la vista de cobro lo devuelve a Caja en vez de dejarlo en Salón.
  const volverCaja = () => { setFoco(null); setModulo('caja') }

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
      const deImpresion = HASH_IMPRESION.test(hash)
      const destino = deImpresion ? 'config' : VISTAS[hash]
      if (destino && permitidos.split(',').includes(destino)) {
        // Configuración trae el bloque abierto según pos-cfg-abierto (la tecla que lee SettingsPage):
        // sin este aviso el enlace profundo caería en Configuración con todo minimizado.
        if (deImpresion) { try { localStorage.setItem('pos-cfg-abierto', 'impresoras') } catch { /* noop */ } }
        setModulo(destino)
      }
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

  // Mientras llegan los datos de la empresa: pantalla de carga completa (sin salto de mesas de relleno).
  if (s._supCargando) return <PantallaCarga error={error} onSalir={onSalir} />

  return (
    <div className="app">
      <Topbar sesion={{ ...sesion, empresa: sesion.empresa || s.config.nombre }} modulo={modulo} modulos={modulos}
        onModulo={id => { setFoco(null); setModulo(id) }} onSalir={onSalir} aviso={aviso || undefined} />
      {sesion.operando && (
        <div className="topbar-rol" style={{ background: 'var(--warn-line)', color: 'var(--on-btn)', padding: '6px 14px', borderRadius: 0, display: 'block', width: '100%', textAlign: 'center', whiteSpace: 'normal' }}>
          {tOr('super.banner.viendo', 'Estás viendo la empresa')} <b>{sesion.empresa}</b> —{' '}
          <button className="auth-enlace" type="button" onClick={onVolver}>{tOr('super.banner.volver', 'volver a mi empresa')}</button>
        </div>
      )}
      <ChunkBoundary resetKey={modulo}>
      <Suspense fallback={<div className="auth-aviso" role="status" style={{ padding: '8px 16px' }}>{t('app.conectando')}</div>}>
        {modulo === 'salon' && <HallPage rol={sesion.rol} sesion={sesion} foco={foco} onVolverCaja={volverCaja} />}
        {modulo === 'caja' && <CashPage rol={sesion.rol} sesion={sesion} onAbrirMesa={abrirDeAlerta} />}
        {modulo === 'venta' && <QuickSalePage rol={sesion.rol} sesion={sesion} onAbrirMesa={abrirDeAlerta} />}
        {modulo === 'cocina' && <KitchenPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'menu' && <MenuPage rol={sesion.rol} />}
        {modulo === 'inventario' && <InventoryPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'reportes' && <ReportsPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'alertas' && <AlertasPage rol={sesion.rol} sesion={sesion} onAbrirCuenta={abrirDeAlerta} />}
        {modulo === 'auditoria' && <AuditPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'config' && <SettingsPage rol={sesion.rol} sesion={sesion} />}
        {modulo === 'super' && sesion.es_super && <SuperPage sesion={sesion} />}
      </Suspense>
      </ChunkBoundary>
    </div>
  )
}
