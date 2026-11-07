import VistaMapaLista from '../../ui/VistaMapaLista.jsx'
import { useMemo, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { useStore } from '../../../context/StoreContext.jsx'
import { round2 } from '../../../services/format.js'
import LienzoMapa, { numeroDeMesa } from '../hall/LienzoMapa.jsx'
import { leerZoom, estiloMesa, leerZonaCaja, guardarZonaCaja } from '../hall/mapaMesas.js'

// Mapa de calor del periodo: cada mesa pintada según lo que vendió, clicable para filtrar el reporte.
// Es el MISMO mapa del Salón (LienzoMapa: misma proporción, tamaño de mesa y zoom), pero leyendo resumen.por_mesa,
// que viene por NOMBRE de mesa tanto de la memoria demo como de la RPC, así funciona en los dos modos.
const TODAS = 'todas'

const iniciaVista = () => {
  try { const v = localStorage.getItem('pos-reportes-mesas-vista'); if (v === 'mapa' || v === 'lista') return v } catch { /* noop */ }
  return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
}

// Cifra compacta para que quepa dentro de la mesa (el monto exacto sale en el filtro, el título y la vista Lista).
const corto = n => {
  const v = Number(n) || 0
  if (v <= 0) return '—'
  if (v >= 1000) return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v))
}

const ordenarZonas = zonas => zonas
  .map((z, i) => ({ ...z, _i: i }))
  .sort((a, b) => ((a.orden ?? a._i + 1) - (b.orden ?? b._i + 1)) || (a._i - b._i))

export default function MapaVentas({ mesas = [], zonas = [], ventas = {}, fuera = [], sel = null, onSel = () => {}, m, total = 0, cuentasPanel = null }) {
  const { t, tOr } = useIdioma()
  const { s } = useStore()
  const zoom = leerZoom(s._empresaId ?? 'demo')
  const [vista, setVista] = useState(iniciaVista)
  const [zona, setZonaEstado] = useState(leerZonaCaja)
  const setZona = id => { setZonaEstado(id); guardarZonaCaja(id) }

  const cambiarVista = v => { setVista(v); try { localStorage.setItem('pos-reportes-mesas-vista', v) } catch { /* noop */ } }
  const zonasOrden = useMemo(() => ordenarZonas(zonas), [zonas])
  const activo = zona === TODAS || zonasOrden.some(z => z.id === zona) ? zona : (zonasOrden[0]?.id ?? TODAS)
  const mesasZona = mesas.filter(mm => activo === TODAS || mm.zona === activo)
  const zonaNombre = id => zonasOrden.find(z => z.id === id)?.nombre ?? t('salon.sinZona')

  const max = useMemo(() => Object.values(ventas).reduce((a, x) => Math.max(a, Number(x?.monto) || 0), 0), [ventas])
  const montoDe = nombre => ventas[nombre]?.monto ?? 0
  const cuentaDe = nombre => ventas[nombre]?.cuentas ?? 0
  const pulsado = nombre => onSel(sel === nombre ? null : nombre)
  const pct = n => `${total > 0 ? round2(((Number(n) || 0) / total) * 100) : 0}%`
  // El verde de marca (--verde) es el color del dinero; --ac queda para estado/info, así que el calor
  // no puede pintarse de azul. Las mesas frías salen casi blancas y las fuertes se leen en blanco.
  const calor = monto => {
    const i = max > 0 ? Math.min(1, (Number(monto) || 0) / max) : 0
    return { background: `color-mix(in srgb, var(--verde) ${round2(14 + i * 62)}%, var(--card))`, color: i > 0.55 ? 'var(--on-btn)' : 'var(--ink)' }
  }
  const detalle = sel ? { monto: ventas[sel]?.monto ?? fuera.find(x => x.mesa === sel)?.monto ?? 0, cuentas: ventas[sel]?.cuentas ?? fuera.find(x => x.mesa === sel)?.cuentas ?? 0 } : null

  return (
    <section className="rp-mapa" aria-label={tOr('reportes.mapaTitulo', 'Mapa de ventas')}>
      <h3 className="rp-mapa-tit">🗺️ {tOr('reportes.mapaTitulo', 'Mapa de ventas')} <span className="rp-n">{mesas.length}</span></h3>
      {/* Igual que en Salón y Caja: Mapa · Lista en su marco y los salones en el suyo. */}
      <div className="nav-n2 rp-vista-fila">
        <VistaMapaLista valor={vista} onCambiar={cambiarVista} etiqueta={t('salon.vista')} />
      </div>

      {zonasOrden.length >= 1 && (
        <div className="nav-n1 rp-zonas" role="group" aria-label={t('salon.salones')}>
          <button type="button" className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS} onClick={() => setZona(TODAS)} title={t('salon.todasTitle')}>
            {t('salon.todas')}
          </button>
          {zonasOrden.map(z => (
            <button type="button" key={z.id} className={activo === z.id ? 'tab on' : 'tab'} aria-pressed={activo === z.id} onClick={() => setZona(z.id)}>{z.nombre}</button>
          ))}
        </div>
      )}

      <p className="rp-nota">{tOr('reportes.mapaAyuda', 'Cuanto más verde, más vendió esa mesa en el periodo. Tócala para filtrar todos los reportes a esa mesa.')}</p>

      {sel && (
        <div className="rp-filtro" role="status">
          <span>{tOr('reportes.mapaFiltrado', 'Filtrado por')} <b>{sel}</b> · {m(detalle.monto)} · {pct(detalle.monto)}</span>
          <button type="button" className="rp-filtro-x" onClick={() => onSel(null)} aria-label={t('comun.cancelar')} title={t('comun.cancelar')}>✕</button>
        </div>
      )}

      {mesasZona.length === 0 ? (
        <p className="rp-nota">{t('salon.sinMesasZona')}</p>
      ) : vista === 'lista' ? (
        <div className="rp-mesa-lista">
          {mesasZona.map(mm => {
            const monto = montoDe(mm.nombre)
            return (
              <button type="button" key={mm.id} className={'rp-mesa-card' + (sel === mm.nombre ? ' sel' : '')} onClick={() => pulsado(mm.nombre)}
                style={calor(monto)} aria-pressed={sel === mm.nombre}>
                <b>{mm.nombre}</b>
                <span className="rp-mesa-zona">{activo === TODAS ? zonaNombre(mm.zona) : ''}</span>
                <span className="rp-mesa-monto">{monto > 0 ? m(monto) : tOr('reportes.mapaSinVentas', 'Sin ventas')}</span>
                <small>{tOr('reportes.colCuentas', 'Cuentas')}: {cuentaDe(mm.nombre)}</small>
              </button>
            )
          })}
        </div>
      ) : (
        <LienzoMapa zoom={zoom}>
          {asp => mesasZona.map(mm => {
            const monto = montoDe(mm.nombre)
            return (
              <div role="button" tabIndex={0} key={mm.id}
                className={`mesa ${mm.forma || 'cuadrada'} rp-mesa` + (sel === mm.nombre ? ' sel' : '')}
                onClick={() => pulsado(mm.nombre)} aria-pressed={sel === mm.nombre}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pulsado(mm.nombre) } }}
                title={`${mm.nombre}${monto > 0 ? ' · ' + m(monto) : ''} — ${tOr('reportes.mapaTocar', 'Filtrar el reporte por esta mesa')}`}
                style={{ ...estiloMesa(mm, asp), ...calor(monto) }}>
                <b className="nombre">{numeroDeMesa(mm) || mm.nombre}</b>
                <span className="importe">{corto(monto)}</span>
                {monto > 0 && <span className="rp-mesa-pax">×{cuentaDe(mm.nombre)}</span>}
                {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(mm.zona)}</span>}
              </div>
            )
          })}
        </LienzoMapa>
      )}

      {cuentasPanel}

      <div className="rp-calor">
        <span>{tOr('reportes.mapaSinVentas', 'Sin ventas')}</span>
        <i className="rp-calor-barra" />
        <b>{max > 0 ? m(max) : '—'}</b>
      </div>

      {fuera.length > 0 && (
        <div className="rp-fuera">
          <p className="rp-nota">{tOr('reportes.mapaFuera', 'Cuentas que no corresponden a una mesa del salón (mesas unidas, mostrador, para llevar o mesas eliminadas).')}</p>
          <div className="rp-fuera-chips">
            {fuera.map(x => (
              <button type="button" key={x.mesa} className={'rp-fuera-chip' + (sel === x.mesa ? ' on' : '')} aria-pressed={sel === x.mesa} onClick={() => pulsado(x.mesa)}>
                <b>{x.mesa}</b> {m(x.monto)} <small>×{x.cuentas}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
