import { useEffect, useRef, useState } from 'react'
import { useMoneda } from '../../../services/money.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { totalCuenta } from '../../../context/StoreContext.jsx'
import './HallPage.css'
import { ASP_BASE, calcularAsp } from './mapaMesas.js'

// Marco ÚNICO del mapa de mesas: Salón, Caja, Venta directa y Reportes lo usan igual, así el tamaño,
// la proporción y el zoom son siempre los mismos. Quien lo usa solo decide qué mesas dibuja dentro:
// `children` recibe la proporción actual (asp) para calcular el estilo de cada mesa.
// (El Salón dibuja el mismo marco con su propio código porque además edita y arrastra mesas.)
export default function LienzoMapa({ zoom = 1, children, className = '' }) {
  const bloque = useRef(null)
  const [asp, setAsp] = useState(ASP_BASE)
  useEffect(() => {
    const calc = () => { const a = calcularAsp(bloque.current); if (a !== null) setAsp(prev => (Math.abs(prev - a) > 0.01 ? a : prev)) }
    calc()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calc) : null
    if (ro && bloque.current) ro.observe(bloque.current)
    window.addEventListener('resize', calc)
    return () => { ro?.disconnect(); window.removeEventListener('resize', calc) }
  }, [])

  return (
    <div className={'salon mapa-solo ' + className}>
      <div className="lienzo-bloque" ref={bloque}>
        <div className="lienzo-area" style={{ ['--asp']: String(asp) }}>
          <div className="lienzo-wrap">
            <div className="lienzo" style={{ ['--z']: String(zoom) }}>
              {typeof children === 'function' ? children(asp) : children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Número de mesa que se lee en grande dentro del cuadro («Mesa 2» → «2»).
export const numeroDeMesa = m => String(m.nombre).match(/(\d+)\s*$/)?.[1] ?? ''

// Lo que lleva por dentro una mesa del mapa. Es UNA sola pieza para que el Salón y la Caja muestren
// exactamente los mismos datos: número, nombre del cliente, importe, salón, ↩ heredada y ✂/🔗.
// cs = cuentas abiertas de la mesa, resto = lo que falta por cobrar, heredadas = ids de cuentas del turno anterior.
export function MesaDatos({ m, cs, resto, mostrarZona, nombreZona, heredadas = [] }) {
  const { money } = useMoneda()
  const { t } = useIdioma()
  const c = cs[0]
  const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
  return (
    <>
      <b className="nombre">{numeroDeMesa(m) || m.nombre}</b>
      {cs.length === 1 && c.tipo === 'mesa' && c.clienteNombre && <span className="alias-mesa" title={`${c.clienteNombre} (${m.nombre})`}>{c.clienteNombre}</span>}
      {c && <span className="importe">{money(resto)}</span>}
      {mostrarZona && <span className="etiqueta-zona">{nombreZona}</span>}
      {c && heredadas.includes(c.id) && <span className="badge-heredada" title={t('salon.heredadaTitle')}>↩</span>}
      {!unida && cs.length > 1 && <span className="badge-unida" title={t('pedido.menuDividir')}>✂ ×{cs.length}</span>}
      {unida && (
        <span className="badge-unida" title={t('salon.unidaTitle', { n: c.mesaIds.length, total: money(totalCuenta(c)) })}>
          🔗 ×{c.mesaIds.length}
        </span>
      )}
    </>
  )
}
