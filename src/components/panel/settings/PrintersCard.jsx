import { useEffect, useReducer, useState } from 'react'
import { useStore, nuevoId } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { soporteSerial, reutilizarImpresoras, suscribirImpresora, fijarBaud } from '../../../services/printer.js'
import PrinterOutput from '../../printing/PrinterOutput.jsx'
import AgentStatus from '../../printing/AgentStatus.jsx'
import { gruposDe, gruposDeComanda, gruposDeSeccion, slugGrupo } from '../../../services/printing.js'
import '../../../styles/admin.css'

export default function PrintersCard({ rol, sesion }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const cfg = s.config || {}
  const grupos = gruposDe(cfg)
  const [, refrescar] = useReducer(x => x + 1, 0)
  const [nuevo, setNuevo] = useState(null)
  const [conf, setConf] = useState(null)
  const soportado = soporteSerial()

  const claveGrupos = grupos.map(g => `${g.id}:${g.baud}`).join('|')

  useEffect(() => {
    let vivo = true
    reutilizarImpresoras(grupos.map(g => ({ id: g.id, baud: g.baud })))
    const unsub = suscribirImpresora(() => { if (vivo) refrescar() })
    const poll = setInterval(() => { if (vivo) refrescar() }, 3000)
    return () => { vivo = false; unsub(); clearInterval(poll) }
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

  return (
    <div className="adm-card adm-imp">
      <div className="adm-card-cab">
        <h3>{tOr('impresoras.tituloNuevo', 'Grupos de impresión y comandas')}</h3>
        <span className="sp" />
        <button type="button" className="ghost" onClick={() => { window.location.hash = '#menu' }}>{tOr('impresoras.irItems', 'Ir a Ítems')}</button>
        <button type="button" className="teal" onClick={() => setNuevo(nuevo === null ? '' : null)}>＋ {t('impresoras.nuevoGrupo')}</button>
      </div>
      <p className="adm-sub" style={{ margin: 0 }}>{tOr('impresoras.ayudaUnica', 'Todo lo impreso se arma acá: los grupos de comanda, dónde imprime cada uno (esta PC o la estación), copias, pie de página y corte. No hay otra pantalla de impresión.')}</p>
      <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.intro')}</p>

      {!soportado && (
        <div className="imp-noporte">
          {t('impresoras.noSoporte1')} <b>{t('impresoras.noSoporte2')}</b>{t('impresoras.noSoporte3')}{' '}
          <b>{t('impresoras.noSoporte4')}</b>{t('impresoras.noSoporte5')} {t('impresoras.noSoporte6')}{' '}
          <b>{t('impresoras.noSoporte7')}</b>{t('impresoras.noSoporte8')}
        </div>
      )}

      <p className="imp-subtitulo">{tOr('impresoras.gruposTitulo', 'Grupos de comanda')}</p>
      {nuevo !== null && (
        <form className="adm-fila adm-nuevo" onSubmit={e => { e.preventDefault(); crearGrupo() }}>
          <input autoFocus value={nuevo} maxLength={40} placeholder={t('impresoras.nombreGrupoPlace')} onChange={e => setNuevo(e.target.value)} />
          <button type="submit" className="success" disabled={!nuevo.trim()}>{t('comun.guardar')}</button>
          <button type="button" className="danger" onClick={() => setNuevo(null)}>{t('comun.cancelar')}</button>
        </form>
      )}

      <AgentStatus />

      <div className="imp-grupos">
        {grupos.map(g => {
          const n = usos(g.id)
          return (
            <section key={g.id} className={'imp-grupo' + (g.tickets ? ' tickets' : '')}>
              <header className="imp-grupo-cab">
                <input className="imp-nombre" value={g.nombre} maxLength={40} aria-label={t('impresoras.nombreGrupo')}
                  onChange={e => cambiarGrupo(g.id, { nombre: e.target.value })} />
                <span className="adm-chip">{g.tickets ? t('impresoras.grupoTickets') : t('impresoras.grupoComanda')}</span>
              </header>
              <div className="imp-opciones">
                <label className="adm-campo"><span>{t('impresoras.anchoLabel')}</span>
                  <select value={Number(g.ancho) >= 42 ? 48 : 32} onChange={e => cambiarGrupo(g.id, { ancho: Number(e.target.value) })}>
                    <option value={32}>{t('impresoras.ancho58')}</option>
                    <option value={48}>{t('impresoras.ancho80')}</option>
                  </select>
                </label>
                <label className="adm-campo"><span>{t('impresoras.baudLabel')}</span>
                  <select value={Number(g.baud) || 9600} onChange={e => { fijarBaud(g.id, e.target.value); cambiarGrupo(g.id, { baud: Number(e.target.value) }) }}>
                    <option value={9600}>9600 bps (POS-580)</option>
                    <option value={115200}>115200 bps (Xprinter)</option>
                  </select>
                </label>
              </div>
              <div className="imp-opciones">
                <label className="adm-campo"><span>{t('impresoras.copiasLabel')}</span>
                  <select value={Math.min(3, Math.max(1, Number(g.copias) || 1))} title={t('impresoras.copiasAyuda')}
                    onChange={e => cambiarGrupo(g.id, { copias: Number(e.target.value) })}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label className="adm-campo"><span>{t('impresoras.pieLabel')}</span>
                  <input defaultValue={g.pie || ''} maxLength={120} placeholder={t('impresoras.piePlace')}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== String(g.pie || '').trim()) cambiarGrupo(g.id, { pie: v }) }} />
                </label>
                <label className="imp-radio"><input type="checkbox" checked={g.corte !== false} onChange={e => cambiarGrupo(g.id, { corte: e.target.checked })} /> {t('impresoras.corte')}</label>
              </div>
              <PrinterOutput g={g} cfg={cfg} onCambio={refrescar} />
              <div className="adm-fila">
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
              {!g.tickets && <p className="imp-dato" style={{ margin: 0 }}>{t('impresoras.seccionesDelGrupo', { n })}</p>}
            </section>
          )
        })}
      </div>

      <p className="imp-subtitulo">{tOr('impresoras.opcionesTitulo', 'Opciones de impresión')}</p>
      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.seccionesTitulo')}</span>
        <p className="adm-sub" style={{ margin: 0 }}>{tOr('impresoras.seccionesMulti', 'Cada sección puede mandar a varios grupos a la vez, o a todos. Un plato que llega a dos grupos se imprime en las dos cocinas.')}</p>
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
      </div>

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.dondeLabel')}</span>
        <div className="adm-fila">
          <label className="imp-radio"><input type="radio" name="imp-donde" checked={cfg.modoImpresion !== 'estacion'} onChange={() => guardar({ modoImpresion: 'local' })} /> {t('impresoras.dondeLocal')}</label>
          <label className="imp-radio"><input type="radio" name="imp-donde" checked={cfg.modoImpresion === 'estacion'} onChange={() => guardar({ modoImpresion: 'estacion' })} /> {t('impresoras.dondeEstacion')}</label>
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.dondeAyuda', { modulo: t('app.mod.estacion') })}</p>
      </div>

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.ticketsLabel')}</span>
        <div className="adm-fila">
          <label className="imp-radio"><input type="checkbox" checked={Boolean(cfg.impresoraBeep)} onChange={e => guardar({ impresoraBeep: e.target.checked })} /> {t('impresoras.beep')}</label>
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.notaComandas', { boton: t('pedido.enviarCocina') })}</p>
      </div>
    </div>
  )
}
