import { useMemo, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { round2 } from '../../../services/format.js'

// Mapa de calor del periodo: cada mesa pintada según lo que vendió, clicable para filtrar el reporte.
// Es la misma cartesian del Salón (lienzo 1000×600), pero leyendo resumen.por_mesa, que viene por NOMBRE
// de mesa tanto de la memoria demo como de la RPC, así funciona en los dos modos.
const W = 1000, H = 600, TODAS = 'todas'

const iniciaVista = () => {
  try { const v = localStorage.getItem('pos-reportes-mesas-vista'); if (v === 'mapa' || v === 'lista') return v } catch { /* noop */ }
  return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
}

const ordenarZonas = zonas => zonas
  .map((z, i) => ({ ...z, _i: i }))
  .sort((a, b) => ((a.orden ?? a._i + 1) - (b.orden ?? b._i + 1)) || (a._i - b._i))

export default function MapaVentas({ mesas = [], zonas = [], ventas = {}, fuera = [], sel = null, onSel = () => {}, m, total = 0 }) {
  const { t, tOr } = useIdioma()
  const [vista, setVista] = useState(iniciaVista)
  const [zona, setZona] = useState(TODAS)

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
    return { background: `color-mix(in srgb, var(--verde) ${round2(6 + i * 62)}%, var(--card))`, color: i > 0.55 ? 'var(--on-btn)' : 'var(--ink)' }
  }
  const detalle = sel ? { monto: ventas[sel]?.monto ?? fuera.find(x => x.mesa === sel)?.monto ?? 0, cuentas: ventas[sel]?.cuentas ?? fuera.find(x => x.mesa === sel)?.cuentas ?? 0 } : null

  return (
    <section className="adm-card rp-sec rp-mapa" aria-label={tOr('reportes.mapaTitulo', 'Mapa de ventas')}>
      <div className="adm-card-cab rp-mapa-cab">
        <h3>🗺️ {tOr('reportes.mapaTitulo', 'Mapa de ventas')}</h3>
        <span className="rp-n">{mesas.length}</span>
        <span className="sp" />
        <div className="rp-vistas" role="group" aria-label={t('salon.vista')}>
          <button type="button" className={'tab' + (vista === 'mapa' ? ' on' : '')} aria-pressed={vista === 'mapa'} onClick={() => cambiarVista('mapa')}>🧩 {tOr('reportes.mapaVistaMapa', 'Mapa')}</button>
          <button type="button" className={'tab' + (vista === 'lista' ? ' on' : '')} aria-pressed={vista === 'lista'} onClick={() => cambiarVista('lista')}>☰ {tOr('reportes.mapaVistaLista', 'Lista')}</button>
        </div>
      </div>

      {zonasOrden.length >= 1 && (
        <div className="zonas-scroll rp-zonas" role="group" aria-label={t('salon.salones')}>
          <button type="button" className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS} onClick={() => setZona(TODAS)} title={t('salon.todasTitle')}>
            <span aria-hidden="true">▦</span> {t('salon.todas')}
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
        <div className="lienzo rp-lienzo" style={{ aspectRatio: `${W} / ${H}` }}>
          {mesasZona.map(mm => {
            const monto = montoDe(mm.nombre)
            return (
              <button type="button" key={mm.id}
                className={`mesa ${mm.forma || 'cuadrada'} rp-mesa` + (sel === mm.nombre ? ' sel' : '')}
                onClick={() => pulsado(mm.nombre)} aria-pressed={sel === mm.nombre}
                title={tOr('reportes.mapaTocar', 'Filtrar el reporte por esta mesa')}
                style={{ left: `${(mm.x / W) * 100}%`, top: `${(mm.y / H) * 100}%`, width: `${(mm.w / W) * 100}%`, height: `${(mm.h / H) * 100}%`, ...calor(monto) }}>
                <b className="nombre">{mm.nombre}</b>
                <span className="rp-mesa-cifra">{monto > 0 ? m(monto) : '—'}</span>
                {monto > 0 && <span className="rp-mesa-pax">{cuentaDe(mm.nombre)}</span>}
                {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(mm.zona)}</span>}
              </button>
            )
          })}
        </div>
      )}

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
