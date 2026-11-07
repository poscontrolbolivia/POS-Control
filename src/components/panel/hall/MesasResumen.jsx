import VistaMapaLista from '../../ui/VistaMapaLista.jsx'
import { Fragment, useMemo, useState } from 'react'
import { useStore, totalFinal, pagadoCuenta, saldoCuenta } from '../../../context/StoreContext.jsx'
import { round2 } from '../../../services/format.js'
import { useMoneda } from '../../../services/money.js'
import { useIdioma } from '../../../i18n/index.jsx'
import './HallPage.css'
import './MesasResumen.css'
import { W, H, ASP_BASE, leerZoom, estiloMesa, leerZonaCaja, guardarZonaCaja } from './mapaMesas.js'
import LienzoMapa, { MesaDatos } from './LienzoMapa.jsx'

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

// Dónde van los chips de una mesa dividida DENTRO del mapa. El lienzo recorta lo que se sale, así que el chip se ancla al borde que
// tenga más espacio: debajo de la mesa si hay sitio (si no, encima) y a la izquierda de la mesa (si está en la mitad derecha, a la derecha).
const estiloChips = (m, asp) => {
  const izq = (m.x / W) * 100
  const ancho = (m.w / W) * 100 * (ASP_BASE / asp)
  const abajoLibre = m.y + m.h < H - 90
  const enDerecha = m.x + m.w / 2 > W / 2
  return {
    ...(enDerecha ? { right: `${100 - izq - ancho}%`, justifyContent: 'flex-end' } : { left: `${izq}%` }),
    ...(abajoLibre ? { top: `${((m.y + m.h) / H) * 100}%` } : { top: `${(m.y / H) * 100}%`, transform: 'translateY(-100%)' }),
    width: 'max-content',
    flexWrap: 'nowrap',
  }
}

const iniciaVista = () => {
  try { const v = localStorage.getItem('pos-caja-mesas-vista'); if (v === 'mapa' || v === 'lista') return v } catch { /* noop */ }
  return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'lista' : 'mapa'
}

// `despuesDe`: nivel del marco que va justo encima ('n1' o 'n2'); los marcos se alternan blanco/tinte, así que el primero
// de aquí es el contrario.
export default function MesasResumen({ mesas = [], zonas = [], cuentas = [], onOpen = () => {}, despuesDe = 'n2' }) {
  const { money } = useMoneda()
  const { t, tOr } = useIdioma()
  const [vista, setVista] = useState(iniciaVista)
  // Abre en el salón donde se dejó la última vez (o el primero), no en «Todos».
  const [zona, setZonaEstado] = useState(leerZonaCaja)
  const setZona = id => { setZonaEstado(id); guardarZonaCaja(id) }
  // Mismo mapa que el Salón: LienzoMapa pone la misma proporción y el zoom que se dejó allí.
  const { s } = useStore()
  const zoom = leerZoom(s._empresaId ?? 'demo')
  const heredadas = s.caja?.turno?.heredadas || []

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

  const primero = despuesDe === 'n2' ? 'nav-n1' : 'nav-n2'
  const segundo = despuesDe === 'n2' ? 'nav-n2' : 'nav-n1'
  return (
    <>
      {/* Igual que en Salón: Mapa · Lista en su marco y los salones en el suyo, cada uno en una sola fila. */}
      <div className={primero + ' mr-vista-fila'}>
        <VistaMapaLista valor={vista} onCambiar={cambiarVista} etiqueta={t('salon.vista')} />
      </div>
      {zonasOrden.length >= 1 && (
        <div className={segundo + ' mr-zonas'} role="group" aria-label={t('salon.salones')}>
          <button type="button" className={activo === TODAS ? 'tab on' : 'tab'} aria-pressed={activo === TODAS} onClick={() => setZona(TODAS)} title={t('salon.todasTitle')}>
            {t('salon.todas')}
          </button>
          {zonasOrden.map(z => (
            <button type="button" key={z.id} className={activo === z.id ? 'tab on' : 'tab'} aria-pressed={activo === z.id} onClick={() => setZona(z.id)}>{z.nombre}</button>
          ))}
        </div>
      )}
    <section className="caja-card mr-bloque mr-mesas" aria-label={tOr('caja.mesasTitulo', 'Mesas')}>
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
        <LienzoMapa zoom={zoom} className="mr-salon">
          {asp => mesasZona.map(m => {
            const cs = cuentasDeMesa(cuentas, m.id), c = cs[0], est = estadoVarias(cs)
            const resto = round2(cs.reduce((a, x) => a + saldoCuenta(x), 0))
            const capT = capacidadCuenta(c, mesas) || (m.cap || 0)
            const sub = c ? `${money(resto)} · 👥 ${c.comensales ?? 0}/${capT}${c.abiertaPor ? ` · 👤 ${c.abiertaPor}` : ''}` : `${t('salon.' + est)} · 👥 ${m.cap}`
            return (
              <Fragment key={m.id}>
                <div role="button" tabIndex={0} className={`mesa ${m.forma} ${est}`} title={sub}
                  onClick={() => abre(m)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') abre(m) }}
                  style={estiloMesa(m, asp)}>
                  <MesaDatos m={m} cs={cs} resto={resto} mostrarZona={activo === TODAS} nombreZona={zonaNombre(m.zona)} heredadas={heredadas} />
                </div>
                {/* Las cuentas divididas se cobran desde abajo del cuadro, pegadas a su mesa. */}
                {chips(m, cs, estiloChips(m, asp))}
              </Fragment>
            )
          })}
        </LienzoMapa>
      )}

      <div className="leyenda mr-leyenda">
        {leyenda.map(([k, l]) => <span key={k}><i className={'pt ' + k} />{l}</span>)}
        <span><i className="pt pax" />{t('salon.leyendaPax')}</span>
        <span><i className="pt unida" />{t('salon.leyendaUnidas')}</span>
      </div>
    </section>
    </>
  )
}
