import { useEffect, useRef, useState } from 'react'
import { useStore } from '../services/store.jsx'
import { puede } from '../services/permisos.js'
import { suscribirVista } from '../services/notificaciones.js'
import { useIdioma } from '../i18n/index.jsx'
import Topbar from '../components/panel/Topbar.jsx'
import SalonPage from '../components/salon/SalonPage.jsx'
import CajaPage from '../components/caja/CajaPage.jsx'
import VentaDirecta from '../components/venta/VentaDirecta.jsx'
import MenuAdmin from '../components/admin/MenuAdmin.jsx'
import ConfigAdmin from '../components/admin/ConfigAdmin.jsx'
import SuperPage from '../components/super/SuperPage.jsx'
import EstacionPage from '../components/estacion/EstacionPage.jsx'
import { iniciarEstacion, detenerEstacion, estacionRecordada, actualizarConfig } from '../services/estacion.js'

// Los avisos del sistema (al pulsarlos) y los atajos del ícono de la PWA llegan como
// '#salon', '#cocina', '#caja'. No existe pantalla de cocina: lo enviado a preparar se ve
// en el mapa del salón, así que '#cocina' abre el salón.
const VISTAS = { '#salon': 'salon', '#cocina': 'salon', '#caja': 'caja', '#estacion': 'estacion', '#venta': 'venta', '#menu': 'menu', '#config': 'config' }

// Panel de la app (la ruta /panel). Es el equivalente al PanelPage.jsx de Catering Control:
// el shell con la barra de arriba y el módulo activo. Los ids de módulo NO se traducen (son
// estado de navegación); solo la etiqueta visible.
export default function PanelPage({ sesion, onSalir, onVolver, aviso = '' }) {
  const { s } = useStore()
  const { t, tOr } = useIdioma()
  // Un super sin empresa (dueño de la plataforma sin membresías) arranca en su panel; un super
  // "operando" otra empresa arranca en el salón de ESA empresa.
  const [modulo, setModulo] = useState(sesion.es_super && !sesion.empresaId ? 'super' : 'salon')

  const modulos = [{ id: 'salon', nombre: t('app.mod.salon') }, { id: 'caja', nombre: t('app.mod.caja') }, { id: 'venta', nombre: t('app.mod.venta') }]
  if (puede(sesion.rol, 'gestionar_menu')) modulos.push({ id: 'menu', nombre: t('app.mod.menu') })
  if (sesion.supabase && (sesion.rol === 'admin' || sesion.rol === 'cajero')) modulos.push({ id: 'estacion', nombre: t('app.mod.estacion') })
  modulos.push({ id: 'config', nombre: t('app.mod.config') }) // todos: idioma y tema; el resto solo admin
  if (sesion.es_super) modulos.push({ id: 'super', nombre: tOr('app.mod.super', 'Super') })

  // Estación de impresión: si esta PC quedó configurada como estación, arranca sola al entrar
  // (y sigue imprimiendo aunque se cambie de módulo). Se apaga al salir de la sesión.
  const configRef = useRef(s.config)
  configRef.current = s.config
  useEffect(() => { actualizarConfig(() => configRef.current || {}) }, [s.config])
  const puedeEstacion = Boolean(sesion.supabase) && (sesion.rol === 'admin' || sesion.rol === 'cajero')
  useEffect(() => {
    if (!puedeEstacion) return undefined
    if (estacionRecordada()) iniciarEstacion(() => configRef.current || {})
    return () => detenerEstacion({ recordar: true })
  }, [puedeEstacion, sesion.empresaId]) // eslint-disable-line

  // El hash solo cambia el módulo si ese módulo está habilitado para este rol.
  const permitidos = modulos.map(m => m.id).join(',')
  useEffect(() => {
    const aplicar = hash => {
      const destino = VISTAS[hash]
      if (destino && permitidos.split(',').includes(destino)) setModulo(destino)
    }
    aplicar(window.location.hash)
    // 'hashchange' cubre el caso en que la app YA está abierta y se pulsa un aviso o un atajo:
    // cambiar solo el fragmento no recarga el documento, así que el mount no se repite.
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
      {/* Aviso permanente mientras el super opera otra empresa: cubre Salón/Caja/Venta, no solo el panel */}
      {sesion.operando && (
        <div className="topbar-rol" style={{ background: '#8a6d1a', color: '#fff', padding: '6px 14px', borderRadius: 0, display: 'block', width: '100%', textAlign: 'center' }}>
          {tOr('super.banner.viendo', 'Estás viendo la empresa')} <b>{sesion.empresa}</b> —{' '}
          <button className="auth-enlace" type="button" onClick={onVolver}>{tOr('super.banner.volver', 'volver a mi empresa')}</button>
        </div>
      )}
      {s._supCargando && <div className="auth-aviso" role="status" style={{ padding: '8px 16px' }}>{t('app.conectando')}</div>}
      {modulo === 'salon' && <SalonPage rol={sesion.rol} sesion={sesion} />}
      {modulo === 'caja' && <CajaPage rol={sesion.rol} sesion={sesion} />}
      {modulo === 'venta' && <VentaDirecta rol={sesion.rol} sesion={sesion} />}
      {modulo === 'menu' && <MenuAdmin rol={sesion.rol} />}
      {modulo === 'estacion' && <EstacionPage rol={sesion.rol} sesion={sesion} />}
      {modulo === 'config' && <ConfigAdmin rol={sesion.rol} sesion={sesion} />}
      {modulo === 'super' && sesion.es_super && <SuperPage sesion={sesion} />}
    </div>
  )
}
