import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, totalFinal, pagadoCuenta, saldoCuenta } from '../../../context/StoreContext.jsx'
import { round2 } from '../../../services/format.js'
import { useMoneda } from '../../../services/money.js'
import { useIdioma } from '../../../i18n/index.jsx'
import './HallPage.css'
import './MesasResumen.css'
import { W, H, ASP_BASE, leerZoom, estiloMesa, calcularAsp } from './mapaMesas.js'

// Lectura de solo lectura del mapa/listado de mesas para la pantalla de Caja.
// No abre pedidos ni edita: al pulsar una mesa llama a onOpen (que navega al Salón).
const TODAS = 'todas'

const estadoMesa = c => (!c ? 'libre' : c.estado === 'precuenta' ? 'porcobrar' : c.items.some(i => i.estado === 'enviado') ? 'enviada' : 'ocupada')
const estadoVarias = cs => {
  if (!cs.length) return 'libre'
  const e = cs.map(estadoMesa)
  return e.every(x => x === 'porcobrar') ? 'porcobrar' : e.includes('enviada') ? 'enviada' : 'ocupada'
}
const cuentasDeMesa = (cuentas, mesaId) => cuentas
  .filter(c => c.mesaIds.includes(mesaId) && c.estado !== 'cerrada')
  .sort((x, y) => (x.etiqueta || '').localeCompare(y.etiqueta || ''))
const capacidadCuenta = (c, mesas) => {
  if (!c) return 0
  const ids = c.tipo === 'mesa' && c.mesaIds.length > 1 ? c.mesaIds : [c.mesaIds[0]]
  return ids.reduce((t, id) => t + (mesas.find(m => m.id === id)?.cap ?? 0), 0)
}
const ordenarZonas = zonas => zonas
  .map((z, i) => ({ ...z, _i: i }))
  .sort((a, b) => ((a.orden ?? a._i + 1) - (b.orden ?? b._i + 1)) || (a._i - b._i))

const iniciaVista = () => {
  try { const v = localStorage.getItem('pos-caja-mesas-vista'); if (v === 'mapa' || v === 'lista') return v } catch { /* noop */ }
  return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
}

export default function MesasResumen({ mesas = [], zonas = [], cuentas = [], onOpen = () => {} }) {
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const [vista, setVista] = useState(iniciaVista)
  const [zona, setZona] = useState(TODAS)
  // Mismo mapa que el Salón: misma proporción, mismo tamaño de mesa y el zoom que se dejó allí.
  const { s } = useStore()
  const zoom = leerZoom(s._empresaId ?? 'demo')
  const bloque = useRef(null)
  const [asp, setAsp] = useState(ASP_BASE)
  useEffect(() => {
    const calc = () => { const a = calcularAsp(bloque.current); if (a !== null) setAsp(prev => (Math.abs(prev - a) > 0.01 ? a : prev)) }
    calc()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calc) : null
    if (ro && bloque.current) ro.observe(bloque.current)
    window.addEventListener('resize', calc)
    return () => { ro?.disconnect(); window.removeEventListener('resize', calc) }
  }, [vista])

  const cambiarVista = v => { setVista(v); try { localStorage.setItem('pos-caja-mesas-vista', v) } catch { /* noop */ } }

  const zonasOrden = useMemo(() => ordenarZonas(zonas), [zonas])
  const activo = zona === TODAS || zonasOrden.some(z => z.id === zona) ? zona : (zonasOrden[0]?.id ?? TODAS)
  const mesasZona = mesas.filter(m => activo === TODAS || m.zona === activo)
  const zonaNombre = id => zonasOrden.find(z => z.id === id)?.nombre ?? t('salon.sinZona')

  const abre = m => onOpen(m)
  // Caja: si la mesa está dividida (2a, 2b), cada cuenta se cobra sola desde la misma tarjeta. Sin
  // estos chips el cajero tenía que entrar a la mesa y recién ahí adivinar cuál subcuenta era.
  const chips = (m, cs, estilo) => (cs.length > 1 ? (
    <div className="mr-subchips" style={estilo} role="group" aria-label={`${m.nombre} · ${tOr('caja.submesas', 'Cuentas de esta mesa')}`}>
      {cs.map(x => (
        <button type="button" key={x.id} className={'mr-chip ' + estadoMesa(x)} onClick={() => onOpen(m, x)}
          title={tOr('caja.cobrarEsta', 'Cobrar esta cuenta')}>
          <b>{m.nombre}{x.etiqueta || ''}</b>
          <span>{money(saldoCuenta(x))}</span>
        </button>
      ))}
    </div>
  ) : null)
  const leyenda = [['libre', t('salon.libre')], ['ocupada', t('salon.ocupada')], ['enviada', t('salon.enviada')], ['porcobrar', t('salon.porcobrar')]]

  return (
    <section className="caja-card mr-bloque" aria-label={tOr('caja.mesasTitulo', 'Mesas')}>
      <div className="caja-head mr-cab">
        <h2>{tOr('caja.mesasTitulo', 'Mesas')}</h2>
        <span className="caja-hora">{mesasZona.length}</span>
        <span className="sp" />
        <div className="vista-sel" role="group" aria-label={t('salon.vista')}>
          <button type="button" className={'tab' + (vista === 'mapa' ? ' on' : '')} aria-pressed={vista === 'mapa'} onClick={() => cambiarVista('mapa')}>🗺 <span className="txt">{t('salon.vistaMapa')}</span></button>
          <button type="button" className={'tab' + (vista === 'lista' ? ' on' : '')} aria-pressed={vista === 'lista'} onClick={() => cambiarVista('lista')}>☰ <span className="txt">{t('salon.vistaLista')}</span></button>
        </div>
      </div>

      {/* El salón se elige arriba y siempre: en la vista mapa el selector quedaba debajo de la ayuda y no se veía. */}
      {zonasOrden.length >= 1 && (
        <div className="zonas-scroll mr-zonas" role="group" aria-label={t('salon.salones')}>
          <button type="button" className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS} onClick={() => setZona(TODAS)} title={t('salon.todasTitle')}>
            <span aria-hidden="true">▦</span> {t('salon.todas')}
          </button>
          {zonasOrden.map(z => (
            <button type="button" key={z.id} className={activo === z.id ? 'tab on' : 'tab'} aria-pressed={activo === z.id} onClick={() => setZona(z.id)}>{z.nombre}</button>
          ))}
        </div>
      )}

      <p className="caja-nota mr-ayuda">{tOr('caja.mesasAyuda', 'Lee el saldo de cada mesa y toca una para cobrarla. Los pedidos se toman en Salón.')}</p>

      {mesasZona.length === 0 ? (
        <p className="caja-nota mr-vacio">{t('salon.sinMesasZona')}</p>
      ) : vista === 'lista' ? (
        <div className="mr-lista">
          {mesasZona.map(m => {
            const cs = cuentasDeMesa(cuentas, m.id), c = cs[0], est = estadoVarias(cs)
            const total = cs.reduce((a, x) => a + totalFinal(x), 0)
            const abono = round2(cs.reduce((a, x) => a + pagadoCuenta(x), 0))
            const resto = round2(cs.reduce((a, x) => a + saldoCuenta(x), 0))
            const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
            const capT = capacidadCuenta(c, mesas) || (m.cap || 0)
            const com = c ? (c.comensales ?? 0) : null
            return (
              <div className="mr-fila" key={m.id}>
                <button type="button" className={'mr-item ' + est} onClick={() => abre(m)}>
                  <b className="mr-nombre">{m.nombre}{unida ? ` 🔗×${c.mesaIds.length}` : cs.length > 1 ? ` ✂×${cs.length}` : ''}</b>
                  <span className="mr-est">{t('salon.' + est)}</span>
                  {c && <small className="mr-importe">{money(resto)}{abono > 0.009 && <em className="abonado" title={t('salon.totalAbonado', { total: money(total) })}>✓ {money(abono)}</em>}</small>}
                  {c && com !== null && <small className={'mr-quien' + (com > capT ? ' alerta' : '')}>👥 {com}/{capT || m.cap || 0}</small>}
                  {activo === TODAS && <span className="mr-zona">{zonaNombre(m.zona)}</span>}
                </button>
                {chips(m, cs)}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="salon mr-salon">
          <div className="lienzo-bloque" ref={bloque}>
            <div className="lienzo-area" style={{ ['--asp']: String(asp) }}>
              <div className="lienzo-wrap">
                <div className="lienzo" style={{ ['--z']: String(zoom) }}>
                  {mesasZona.map(m => {
                    const cs = cuentasDeMesa(cuentas, m.id), c = cs[0], est = estadoVarias(cs)
                    const resto = round2(cs.reduce((a, x) => a + saldoCuenta(x), 0))
                    const unida = c && c.tipo === 'mesa' && c.mesaIds.length > 1
                    const num = String(m.nombre).match(/(\d+)\s*$/)?.[1] ?? ''
                    return (
                      <Fragment key={m.id}>
                        <div role="button" tabIndex={0} className={`mesa ${m.forma} ${est}`} title={tOr('caja.mesasAbrir', 'Abrir en el salón')}
                          onClick={() => abre(m)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') abre(m) }}
                          style={estiloMesa(m, asp)}>
                          <b className="nombre">{num || m.nombre}</b>
                          {c && <span className="importe">{money(resto)}</span>}
                          {activo === TODAS && <span className="etiqueta-zona">{zonaNombre(m.zona)}</span>}
                          {!unida && cs.length > 1 && <span className="badge-unida" title={t('pedido.menuDividir')}>✂ ×{cs.length}</span>}
                          {unida && <span className="badge-unida">🔗 ×{c.mesaIds.length}</span>}
                        </div>
                        {/* Las cuentas divididas se cobran desde abajo del cuadro, pegadas a su mesa. */}
                        {chips(m, cs, { left: `${(m.x / W) * 100}%`, top: `${((m.y + m.h) / H) * 100}%`, width: estiloMesa(m, asp).width })}
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="leyenda mr-leyenda">
        {leyenda.map(([k, l]) => <span key={k}><i className={'pt ' + k} />{l}</span>)}
      </div>
    </section>
  )
}
