import { Suspense } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { puede } from '../../../services/permissions.js'
import { lazyRetry } from '../../../services/lazyRetry.js'
import CashPage from './CashPage.jsx'
import CierresPanel from './CierresPanel.jsx'
import CabeceraPagina from '../../ui/CabeceraPagina.jsx'
import '../../../styles/admin.css'
import './CajaHub.css'

const ReportsPage = lazyRetry(() => import('../reports/ReportsPage.jsx'))

// Un solo menú «Caja» con submenús, como los salones del mapa: Caja (turno y cobros),
// Cierres (historial) y Reportes (ventas). Cada rol ve solo los submenús que le tocan.
export const SUBMENUS_CAJA = ['caja', 'cierres', 'reportes']

export function submenusDe(rol) {
  return [
    { id: 'caja', icono: '💵' },
    ...(rol === 'admin' ? [{ id: 'cierres', icono: '🧾' }] : []),
    ...(puede(rol, 'ver_reportes') ? [{ id: 'reportes', icono: '📊' }] : []),
  ]
}

export default function CajaHub({ rol, sesion, onAbrirMesa, sub = 'caja', onSub }) {
  const { tOr } = useIdioma()
  const lista = submenusDe(rol)
  const actual = lista.some(x => x.id === sub) ? sub : 'caja'
  const nombres = {
    caja: tOr('caja.subCaja', 'Caja'),
    cierres: tOr('caja.subCierres', 'Cierres de caja'),
    reportes: tOr('caja.subReportes', 'Reportes'),
  }

  return (
    <>
      {lista.length > 1 && (
        <div className="caja-hub">
          <div className="caja-pan caja-hub-tabs" role="tablist" aria-label={tOr('caja.submenus', 'Secciones de caja')}>
            {lista.map(x => (
              <button key={x.id} type="button" role="tab" aria-selected={actual === x.id}
                className={'tab' + (actual === x.id ? ' on' : '')} onClick={() => onSub?.(x.id)}>
                {x.icono} {nombres[x.id]}
              </button>
            ))}
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        {actual === 'caja' && <CashPage rol={rol} sesion={sesion} onAbrirMesa={onAbrirMesa} />}
        {actual === 'cierres' && (
          <div className="adm-panel">
            <CabeceraPagina titulo={nombres.cierres} />
            <CierresPanel sesion={sesion} />
          </div>
        )}
        {actual === 'reportes' && <ReportsPage rol={rol} sesion={sesion} />}
      </Suspense>
    </>
  )
}
