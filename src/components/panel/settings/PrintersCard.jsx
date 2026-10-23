import { lazy, Suspense, useEffect, useReducer, useState } from 'react'
import { useStore, nuevoId } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { soporteSerial, reutilizarImpresoras, suscribirImpresora, fijarBaud } from '../../../services/printer.js'
import PrinterOutput from '../../printing/PrinterOutput.jsx'
import AgentStatus from '../../printing/AgentStatus.jsx'
import { gruposDe, gruposDeComanda, gruposDeSeccion, slugGrupo } from '../../../services/printing.js'
import '../../../styles/admin.css'

// La estación (cola + salida por grupo) solo hace falta cuando se imprime desde esa PC:
// así el estado del agente y la salida de cada grupo aparecen UNA sola vez.
const StationPage = lazy(() => import('../station/StationPage.jsx'))


// Submenú minimizable propio de Impresoras: misma forma que los bloques de Configuración
// (píldora con icono + nombre completo + flecha a la derecha) y una línea de explicación.
// Un solo submenú visible: el padre (PrintersCard) sabe cuál está abierto; los demás se ocultan hasta minimizarlo.
function Sub({ id, icono, titulo, ayuda, chip = null, abierto = false, oculto = false, onToggle, children }) {
  if (oculto) return null
  return (
    <section className={'imp-sub' + (abierto ? ' abierto' : '')}>
      <button type="button" className="imp-sub-cab" aria-expanded={abierto} aria-controls={'imp-sub-cuerpo-' + id} onClick={onToggle}>
        <span className="imp-sub-icono" aria-hidden="true">{icono}</span>
        <span className="imp-sub-titulo">{titulo}</span>
        {chip}
        <span className="imp-sub-flecha" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
      </button>
      {abierto && (
        <div className="imp-sub-cuerpo" id={'imp-sub-cuerpo-' + id}>
          <p className="imp-sub-ayuda">{ayuda}</p>
          {children}
        </div>
      )}
    </section>
  )
}

// Nivel 2 (submenús de Impresoras): la tecla propia vive bajo el mismo prefijo que el acordeón de
// Configuración (pos-cfg-abierto guarda el bloque de nivel 1; acá se guarda el submenú de nivel 2).
const CLAVE_SUB = 'pos-cfg-impresoras-sub'
const SUBS = ['grupos', 'contenido', 'papel', 'donde', 'sonido']
// Hashes que son rutas de la app: nunca un id de grupo, aunque el grupo se llame igual (#caja, #cocina).
const HASH_DE_RUTA = ['salon', 'cocina', 'caja', 'venta', 'menu', 'config', 'auditoria', 'inventario', 'reportes', 'alertas', 'estacion']

// Qué submenú pide el enlace profundo: #estacion es «dónde se imprime»; #grupo-<id> (o el id del
// grupo a secas) es «Grupos de comanda»; #donde, #grupos, #papel, #contenido y #sonido van directos.
// Devuelve null cuando el hash no habla de impresión (ruta de otra pantalla, o sin hash).
function subDesdeHash(idsGrupos) {
  const bruto = typeof window !== 'undefined' ? String(window.location?.hash || '') : ''
  const h = bruto.replace(/^#/, '')
  if (!h) return null
  if (h === 'estacion') return 'donde'
  if (SUBS.includes(h)) return h
  const id = h.replace(/^grupo-/, '')
  return !HASH_DE_RUTA.includes(id) && idsGrupos.includes(id) ? 'grupos' : null
}

// Estado inicial ANTES del primer render (el enlace profundo no puede parpadear cerrado):
// manda el hash; si no trae nada de impresión, vale lo guardado la última vez; y sin nada guardado
// se entra con «Grupos de comanda» abierto, porque si todos vienen cerrados el botón de ＋ grupo
// queda invisible y parece que no se puede crear nada.
function leerSubInicial(idsGrupos) {
  const delHash = subDesdeHash(idsGrupos)
  if (delHash) return delHash
  try {
    const guardado = localStorage.getItem(CLAVE_SUB)
    if (guardado === '') return null // la última vez se minimizó todo
    if (SUBS.includes(guardado)) return guardado
  } catch { /* noop */ }
  return 'grupos'
}

export default function PrintersCard({ rol, sesion }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const cfg = s.config || {}
  const grupos = gruposDe(cfg)
  const idsGrupos = grupos.map(g => g.id)
  const [, refrescar] = useReducer(x => x + 1, 0)
  const [nuevo, setNuevo] = useState(null)
  const [conf, setConf] = useState(null)
  const [sub, setSub] = useState(() => leerSubInicial(idsGrupos))
  // Se guarda al tocar (nunca en el primer render): así un enlace profundo no pisa la preferencia
  // que el usuario ya tenía guardada cuando sólo venía a mirar una cosa.
  const cambiarSub = siguiente => {
    setSub(siguiente)
    try { localStorage.setItem(CLAVE_SUB, siguiente ?? '') } catch { /* noop */ }
  }
  const sp = id => ({ abierto: sub === id, oculto: Boolean(sub) && sub !== id, onToggle: () => { setConf(null); setNuevo(null); cambiarSub(sub === id ? null : id) } })
  const soportado = soporteSerial()

  const claveGrupos = grupos.map(g => `${g.id}:${g.baud}`).join('|')

  useEffect(() => {
    let vivo = true
    reutilizarImpresoras(grupos.map(g => ({ id: g.id, baud: g.baud })))
    const unsub = suscribirImpresora(() => { if (vivo) refrescar() })
    const poll = setInterval(() => { if (vivo) refrescar() }, 3000)
    return () => { vivo = false; unsub(); clearInterval(poll) }
  }, [claveGrupos])

  // Cambiar de pantalla no recarga Configuración: si el hash nuevo habla de impresión, se abre ese submenú.
  // La escucha se rearma con los grupos, que es cuando cambia idsGrupos (claveGrupos) y cambiarSub.
  useEffect(() => {
    const alCambiar = () => {
      const pedido = subDesdeHash(idsGrupos)
      if (pedido) cambiarSub(pedido)
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [claveGrupos])

  if (rol !== 'admin') {
    return <div className="adm-aviso">{t('impresoras.sinPermiso')}{sesion?.nombre ? t('config.sesionParent', { nombre: sesion.nombre }) : ''}</div>
  }

  const guardar = cambios => d({ t: 'cfg~', cambios })
  const guardarGrupos = lista => guardar({ gruposImpresion: lista })
  const cambiarGrupo = (id, cambios) => guardarGrupos(grupos.map(g => (g.id === id ? { ...g, ...cambios } : g)))
  const seccionesOrden = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const gruposComanda = gruposDeComanda(cfg)
  // Sección → grupos: admite el valor viejo (un texto) y la lista nueva (varios a la vez).
  const idsDe = secId => {
    const guardado = cfg.impresoraPorSeccion?.[secId]
    return (Array.isArray(guardado) ? guardado : [guardado]).filter(Boolean).map(String)
  }
  const elegidosDe = secId => (idsDe(secId).length ? idsDe(secId) : gruposDeSeccion(cfg, secId).map(g => g.id))
  const usos = id => seccionesOrden.filter(sec => elegidosDe(sec.id).includes(id)).length

  const crearGrupo = () => {
    const nombre = (nuevo || '').trim().slice(0, 40)
    if (!nombre) return
    let id = slugGrupo(nombre)
    while (grupos.some(g => g.id === id)) id += '-' + nuevoId().slice(0, 4)
    guardarGrupos([...grupos, { id, nombre, ancho: 32, baud: 9600, copias: 1, corte: true }])
    setNuevo(null)
  }

  const borrarGrupo = g => {
    const restantes = grupos.filter(x => x.id !== g.id)

    const mapa = {}
    Object.entries(cfg.impresoraPorSeccion || {}).forEach(([k, v]) => {
      const lista = (Array.isArray(v) ? v : [v]).filter(Boolean).map(String).filter(id => id !== g.id)
      if (lista.length) mapa[k] = lista
    })
    guardar({ gruposImpresion: restantes, impresoraPorSeccion: mapa })

    d({ t: 'area-', id: g.id, reemplazo: gruposDeComanda({ gruposImpresion: restantes })[0]?.id || 'cocina' })
    setConf(null)
  }

  const asignarSeccion = (seccionId, grupoId) => {
    const base = elegidosDe(seccionId)
    const siguiente = base.includes(grupoId) ? base.filter(x => x !== grupoId) : [...base, grupoId]
    if (!siguiente.length) return
    guardar({ impresoraPorSeccion: { ...(cfg.impresoraPorSeccion || {}), [seccionId]: siguiente } })
  }
  const todasLaSeccion = seccionId => {
    if (!gruposComanda.length) return
    guardar({ impresoraPorSeccion: { ...(cfg.impresoraPorSeccion || {}), [seccionId]: gruposComanda.map(g => g.id) } })
  }

  const nComanda = gruposComanda.length
  const enEstacion = cfg.modoImpresion === 'estacion' && Boolean(sesion?.supabase)
  const irItems = () => { window.location.hash = '#menu' }

  return (
    <div className="adm-imp imp-submenu-lista">
      {!soportado && (
        <div className="imp-noporte">
          {t('impresoras.noSoporte1')} <b>{t('impresoras.noSoporte2')}</b>{t('impresoras.noSoporte3')}{' '}
          <b>{t('impresoras.noSoporte4')}</b>{t('impresoras.noSoporte5')} {t('impresoras.noSoporte6')}{' '}
          <b>{t('impresoras.noSoporte7')}</b>{t('impresoras.noSoporte8')}
        </div>
      )}

      {/* Alta siempre a la vista: sin esta barra había que adivinar qué submenú escondía el botón de crear. */}
      <div className="adm-fila imp-alta-barra">
        <button type="button" className="success" onClick={() => { setConf(null); cambiarSub('grupos'); setNuevo('') }}>
          ＋ {tOr('impresoras.altaGrupo', 'Grupo de comanda')}
        </button>
        <button type="button" className="primary" onClick={() => { setConf(null); setNuevo(null); cambiarSub('donde') }}>
          ＋ {tOr('impresoras.altaImpresora', 'Conectar impresora')}
        </button>
        <span className="sp" />
        <span className="imp-dato">{tOr('impresoras.altaAyuda', 'Primero crea el grupo (la salida); después conéctale la impresora.')}</span>
      </div>

      {/* 1) Qué salidas existen */}
      <Sub
        id="grupos"
        {...sp('grupos')}
        icono="🧾"
        titulo={tOr('impresoras.gruposTitulo', 'Grupos de comanda')}
        ayuda={tOr('impresoras.subGruposAyuda', 'Cada grupo es una salida aparte (cocina, barra, ticket de pago). Dale nombre y escoge el papel que usa.')}
        chip={<span className="adm-chip">{grupos.length} {grupos.length === 1 ? tOr('impresoras.unGrupo', 'grupo') : tOr('impresoras.variosGrupos', 'grupos')}</span>}
      >
        <div className="adm-fila imp-sub-acciones">
          <button type="button" className="primary" onClick={() => setNuevo(nuevo === null ? '' : null)}>＋ {t('impresoras.nuevoGrupo')}</button>
        </div>
        {nuevo !== null && (
          <form className="adm-fila adm-nuevo" onSubmit={e => { e.preventDefault(); crearGrupo() }}>
            <input name="nombre-grupo" autoFocus value={nuevo} maxLength={40} placeholder={t('impresoras.nombreGrupoPlace')} onChange={e => setNuevo(e.target.value)} />
            <button type="submit" className="success" disabled={!nuevo.trim()}>{t('comun.guardar')}</button>
            <button type="button" className="danger" onClick={() => setNuevo(null)}>{t('comun.cancelar')}</button>
          </form>
        )}

        <div className="imp-grupos">
          {grupos.map(g => {
            const n = usos(g.id)
            return (
              <section key={g.id} className={'imp-grupo' + (g.tickets ? ' tickets' : '')}>
                <header className="imp-grupo-cab">
                  <input name="nombre-grupo" className="imp-nombre" value={g.nombre} maxLength={40} aria-label={t('impresoras.nombreGrupo')}
                    onChange={e => cambiarGrupo(g.id, { nombre: e.target.value })} />
                  <span className="adm-chip">{g.tickets ? t('impresoras.grupoTickets') : t('impresoras.grupoComanda')}</span>
                </header>
                <div className="imp-opciones">
                  <label className="adm-campo"><span>{t('impresoras.anchoLabel')}</span>
                    <select name="ancho" value={Number(g.ancho) >= 42 ? 48 : 32} onChange={e => cambiarGrupo(g.id, { ancho: Number(e.target.value) })}>
                      <option value={32}>{t('impresoras.ancho58')}</option>
                      <option value={48}>{t('impresoras.ancho80')}</option>
                    </select>
                  </label>
                  <label className="adm-campo"><span>{t('impresoras.baudLabel')}</span>
                    <select name="baud" value={Number(g.baud) || 9600} onChange={e => { fijarBaud(g.id, e.target.value); cambiarGrupo(g.id, { baud: Number(e.target.value) }) }}>
                      <option value={9600}>9600 bps (POS-580)</option>
                      <option value={115200}>115200 bps (Xprinter)</option>
                    </select>
                  </label>
                </div>
                <div className="adm-fila">
                  <span className="imp-dato">{n ? t('impresoras.seccionesDelGrupo', { n }) : tOr('impresoras.sinSecciones', 'Aún sin secciones asignadas')}</span>
                  <span className="sp" />
                  {conf === g.id ? (
                    <>
                      <span className="imp-dato">{t('impresoras.confirmarEliminar')}</span>
                      <button type="button" className="danger solid" onClick={() => borrarGrupo(g)}>{t('comun.confirmar')}</button>
                      <button type="button" className="danger" onClick={() => setConf(null)}>{t('comun.cancelar')}</button>
                    </>
                  ) : (
                    <button type="button" className="danger" disabled={(!g.tickets && nComanda <= 1) || g.tickets}
                      title={g.tickets ? t('impresoras.noSeBorra') : nComanda <= 1 ? t('impresoras.minUno') : n ? t('impresoras.enUso', { n }) : t('comun.eliminar')}
                      onClick={() => setConf(g.id)}>{t('comun.eliminar')}</button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </Sub>

      {/* 2) Qué cae en cada grupo */}
      <Sub
        id="contenido"
        {...sp('contenido')}
        icono="🍽️"
        titulo={tOr('impresoras.subContenido', 'Qué se imprime en cada grupo')}
        ayuda={tOr('impresoras.subContenidoAyuda', 'Acá mandas secciones completas. Cada plato suelto se escoge en Ítems (área del producto), no dos veces acá.')}
        chip={<span className="adm-chip">{seccionesOrden.length} {seccionesOrden.length === 1 ? tOr('impresoras.unaSeccion', 'sección') : tOr('impresoras.variasSecciones', 'secciones')}</span>}
      >
        <div className="adm-fila imp-sub-acciones">
          <button type="button" className="ghost" onClick={irItems}>{tOr('impresoras.irItems', 'Ir a Ítems')}</button>
        </div>
        <div className="imp-secciones">
          {seccionesOrden.map(sec => {
            const sel = elegidosDe(sec.id)
            return (
              <div key={sec.id} className="imp-seccion imp-seccion-multi">
                <span className="imp-seccion-nombre">{sec.nombre}</span>
                <div className="imp-multi-chips">
                  {gruposComanda.map(g => (
                    <button type="button" key={g.id} className={'imp-op ' + (sel.includes(g.id) ? 'primary' : 'ghost')}
                      onClick={() => asignarSeccion(sec.id, g.id)}>{g.nombre}</button>
                  ))}
                  {gruposComanda.length > 1 && (
                    <button type="button" className={'imp-op ' + (sel.length === gruposComanda.length ? 'primary' : 'ghost')}
                      onClick={() => todasLaSeccion(sec.id)}>{tOr('impresoras.todas', 'Todas')}</button>
                  )}
                </div>
              </div>
            )
          })}
          {!seccionesOrden.length && <span className="imp-dato">{t('menu.sinProductos')}</span>}
        </div>
      </Sub>

      {/* 3) Copias, pie de página y corte */}
      <Sub
        id="papel"
        {...sp('papel')}
        icono="✂️"
        titulo={tOr('impresoras.subPapel', 'Cómo sale el papel')}
        ayuda={tOr('impresoras.subPapelAyuda', 'Copias, texto del pie y corte de cada grupo.')}
      >
        <div className="imp-papeles">
          {grupos.map(g => (
            <div key={g.id} className="imp-papel">
              <b className="imp-papel-nombre">{g.nombre}</b>
              <div className="imp-opciones">
                <label className="adm-campo"><span>{t('impresoras.copiasLabel')}</span>
                  <select name="copias" value={Math.min(3, Math.max(1, Number(g.copias) || 1))} title={t('impresoras.copiasAyuda')}
                    onChange={e => cambiarGrupo(g.id, { copias: Number(e.target.value) })}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label className="adm-campo"><span>{t('impresoras.pieLabel')}</span>
                  <input name="pie" defaultValue={g.pie || ''} maxLength={120} placeholder={t('impresoras.piePlace')}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== String(g.pie || '').trim()) cambiarGrupo(g.id, { pie: v }) }} />
                </label>
              </div>
              <label className="imp-radio"><input name="corte" type="checkbox" checked={g.corte !== false} onChange={e => cambiarGrupo(g.id, { corte: e.target.checked })} /> {t('impresoras.corte')}</label>
            </div>
          ))}
        </div>
      </Sub>

      {/* 4) Esta PC o la estación (única salida del agente y de cada grupo) */}
      <Sub
        id="donde"
        {...sp('donde')}
        icono="🖥️"
        titulo={t('impresoras.dondeLabel')}
        ayuda={tOr('impresoras.subDondeAyuda', 'Escoge si imprimen los equipos de aquí o la PC de la estación, y revisa la salida de cada grupo.')}
        chip={<span className="adm-chip">{enEstacion ? tOr('impresoras.chipEstacion', 'Estación') : tOr('impresoras.chipLocal', 'Esta PC')}</span>}
      >
        <div className="adm-fila">
          <label className="imp-radio"><input type="radio" name="imp-donde" checked={cfg.modoImpresion !== 'estacion'} onChange={() => guardar({ modoImpresion: 'local' })} /> {t('impresoras.dondeLocal')}</label>
          <label className="imp-radio"><input type="radio" name="imp-donde" checked={cfg.modoImpresion === 'estacion'} onChange={() => guardar({ modoImpresion: 'estacion' })} /> {t('impresoras.dondeEstacion')}</label>
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.dondeAyuda')}</p>

        {enEstacion ? (
          <Suspense fallback={null}><StationPage embebida rol={rol} sesion={sesion} /></Suspense>
        ) : (
          <>
            <AgentStatus />
            <div className="imp-salidas">
              {grupos.map(g => (
                <div key={g.id} className="imp-salida-grupo">
                  <b className="imp-papel-nombre">{g.nombre}</b>
                  <PrinterOutput g={g} cfg={cfg} onCambio={refrescar} />
                </div>
              ))}
            </div>
          </>
        )}
      </Sub>

      {/* 5) Sonido */}
      <Sub
        id="sonido"
        {...sp('sonido')}
        icono="🔔"
        titulo={tOr('impresoras.subSonido', 'Sonido al imprimir')}
        ayuda={tOr('impresoras.subSonidoAyuda', 'Un pitido en la impresora para que nadie se quede con la comanda sin ver.')}
      >
        <div className="adm-fila">
          <label className="imp-radio"><input name="impresora-beep" type="checkbox" checked={Boolean(cfg.impresoraBeep)} onChange={e => guardar({ impresoraBeep: e.target.checked })} /> {t('impresoras.beep')}</label>
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.notaComandas', { boton: t('pedido.enviarCocina') })}</p>
      </Sub>
    </div>
  )
}
