import { renderToString } from 'react-dom/server'
import { StoreProvider, useStore } from './context/StoreContext.jsx'
import { IdiomaProvider } from './i18n/index.jsx'
import PanelPage from './pages/PanelPage.jsx'
import HallPage from './components/panel/hall/HallPage.jsx'
import CashPage from './components/panel/cash/CashPage.jsx'
import SettingsPage from './components/panel/settings/SettingsPage.jsx'
import KitchenPage from './components/panel/kitchen/KitchenPage.jsx'
import QuickSalePage from './components/panel/quicksale/QuickSalePage.jsx'
import MenuPage from './components/panel/menu/MenuPage.jsx'
import ReportsPage from './components/panel/reports/ReportsPage.jsx'
import InventoryPage from './components/panel/inventory/InventoryPage.jsx'
import UsersPage from './components/panel/users/UsersPage.jsx'
import AuditPage from './components/panel/audit/AuditPage.jsx'
import AlertasPage from './components/panel/alerts/AlertasPage.jsx'
import OrderPanel from './components/panel/order/OrderPanel.jsx'
import MesasResumen from './components/panel/hall/MesasResumen.jsx'
import Topbar from './components/panel/Topbar.jsx'

const envolver = el => renderToString(<IdiomaProvider><StoreProvider>{el}</StoreProvider></IdiomaProvider>)
const sesion = rol => ({ usuario: rol, nombre: rol, rol, empresa: 'Demo', empresaId: null })

function ConCuenta({ rol, ocupada = true, cobro = false }) {  const { s } = useStore()
  const cuenta = s.cuentas.find(c => c.estado !== 'cerrada' && c.tipo === 'mesa' && c.items.length)
  const mesa = ocupada ? s.mesas.find(m => cuenta?.mesaIds.includes(m.id)) : s.mesas.find(m => !s.cuentas.some(c => c.estado !== 'cerrada' && c.mesaIds.includes(m.id)))
  if (!mesa) return <p>sin mesa</p>
  return <OrderPanel rol={rol} sesion={sesion(rol)} mesa={mesa} onClose={() => {}} cobro={cobro ? { desde: 'caja' } : undefined} onEdicion={() => {}} />
}

// Mesa dividida (2a + 2b): es justo lo que Caja tiene que poder cobrar desde la misma tarjeta.
const MESITAS = [{ id: 'm1', nombre: 'Mesa 2', x: 40, y: 40, w: 140, h: 140, cap: 4, forma: 'redonda', zona: 'z1' }]
const ZONITAS = [{ id: 'z1', nombre: 'Salón', orden: 1 }]
const DIVIDIDAS = [
  { id: 'c1', etiqueta: 'a', estado: 'abierta', tipo: 'mesa', mesaIds: ['m1'], comensales: 2, abiertaEn: 1, abiertaPor: 'ana', items: [{ id: 'i1', nombre: 'Silpanote', precio: 45, qty: 2, estado: 'pendiente' }], pagos: [] },
  { id: 'c2', etiqueta: 'b', estado: 'precuenta', tipo: 'mesa', mesaIds: ['m1'], comensales: 3, abiertaEn: 2, abiertaPor: 'bea', items: [{ id: 'i2', nombre: 'Marquesillo', precio: 30, qty: 1, estado: 'enviado' }], pagos: [{ id: 'p1', monto: 10 }] },
]
const conVista = (v, el) => { localStorage.setItem('pos-caja-mesas-vista', v); return envolver(el) }

export const CASOS = {
  'Panel · admin': () => envolver(<PanelPage sesion={sesion('admin')} onSalir={() => {}} />),
  'Panel · mesero': () => envolver(<PanelPage sesion={sesion('mesero')} onSalir={() => {}} />),
  'Panel · cajero': () => envolver(<PanelPage sesion={sesion('cajero')} onSalir={() => {}} />),
  'Panel · cocina': () => envolver(<PanelPage sesion={sesion('cocina')} onSalir={() => {}} />),
  'Panel · barra': () => envolver(<PanelPage sesion={sesion('barra')} onSalir={() => {}} />),
  'Salón': () => envolver(<HallPage rol="admin" sesion={sesion('admin')} />),
  'Caja': () => envolver(<CashPage rol="cajero" sesion={sesion('cajero')} onAbrirMesa={() => {}} />),
  'Configuración': () => envolver(<SettingsPage rol="admin" sesion={sesion('admin')} />),
  'Despacho': () => envolver(<KitchenPage rol="admin" sesion={sesion('admin')} />),
  'Despacho · cocina': () => envolver(<KitchenPage rol="cocina" sesion={sesion('cocina')} />),
  'Venta directa': () => envolver(<QuickSalePage rol="cajero" sesion={sesion('cajero')} />),
  'Ítems (menú)': () => envolver(<MenuPage rol="admin" sesion={sesion('admin')} />),
  'Reportes': () => envolver(<ReportsPage rol="admin" sesion={sesion('admin')} />),
  'Inventario': () => envolver(<InventoryPage rol="admin" sesion={sesion('admin')} />),
  'Equipo': () => envolver(<UsersPage rol="admin" sesion={sesion('admin')} />),
  'Auditoría': () => envolver(<AuditPage rol="admin" sesion={sesion('admin')} />),
  'Alertas': () => envolver(<AlertasPage rol="admin" sesion={sesion('admin')} />),
  'Barra superior': () => envolver(<Topbar sesion={sesion('admin')} modulo="salon" modulos={[{ id: 'salon', nombre: 'Salón' }, { id: 'caja', nombre: 'Caja' }]} onModulo={() => {}} onSalir={() => {}} />),
  'Comanda · mesero (mesa ocupada)': () => envolver(<ConCuenta rol="mesero" />),
  'Comanda · mesero (mesa libre)': () => envolver(<ConCuenta rol="mesero" ocupada={false} />),
  'Comanda · cajero (modo cobro)': () => envolver(<ConCuenta rol="cajero" cobro />),
  'Caja · mesa dividida en lista': () => conVista('lista', <MesasResumen mesas={MESITAS} zonas={ZONITAS} cuentas={DIVIDIDAS} onOpen={() => {}} />),
  'Caja · mesa dividida en mapa': () => conVista('mapa', <MesasResumen mesas={MESITAS} zonas={ZONITAS} cuentas={DIVIDIDAS} onOpen={() => {}} />),
}
