// Administración de impresoras (solo rol admin), por GRUPOS: Cocina, Barra, Caja…
// Cada grupo tiene su propia impresora térmica (Web Serial + ESC/POS), ancho de papel y velocidad.
// Las secciones del menú se asignan a un grupo (aquí o al crear/editar la sección en Menú): al enviar
// una comanda, cada parte sale directo a la impresora de su grupo, sin diálogos.
// NO se traduce: los nombres técnicos (Web Serial, Chrome, Edge) ni los modelos (POS-580, Xprinter).
// Props: { rol, sesion }
import { useEffect, useReducer, useState } from 'react'
import { useStore, nuevoId } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import {
  soporteSerial, conectarImpresora, reutilizarImpresoras, estadoImpresora,
  suscribirImpresora, imprimirSilencioso, fijarBaud,
} from '../../services/impresora.js'
import { gruposDe, gruposDeComanda, grupoDeSeccion, slugGrupo } from '../../services/impresion.js'
import './admin.css'

export default function ImpresorasAdmin({ rol, sesion }) {
  const { s, d } = useStore()
  const { t } = useIdioma()
  const cfg = s.config || {}
  const grupos = gruposDe(cfg)
  const [, refrescar] = useReducer(x => x + 1, 0)
  const [nuevo, setNuevo] = useState(null)       // nombre del grupo que se está creando
  const [msgs, setMsgs] = useState({})            // grupoId → { txt, ok }
  const [ocupadoId, setOcupadoId] = useState(null)
  const [conf, setConf] = useState(null)          // grupo con la confirmación de borrado abierta
  const soportado = soporteSerial()

  const claveGrupos = grupos.map(g => `${g.id}:${g.baud}`).join('|')
  // "Recordar impresoras": reasigna los puertos ya emparejados + estados en vivo.
  useEffect(() => {
    let vivo = true
    reutilizarImpresoras(grupos.map(g => ({ id: g.id, baud: g.baud })))
    const unsub = suscribirImpresora(() => { if (vivo) refrescar() })
    const poll = setInterval(() => { if (vivo) refrescar() }, 3000)
    return () => { vivo = false; unsub(); clearInterval(poll) }
  }, [claveGrupos]) // eslint-disable-line

  if (rol !== 'admin') {
    return <div className="adm-aviso">{t('impresoras.sinPermiso')}{sesion?.nombre ? t('config.sesionParent', { nombre: sesion.nombre }) : ''}</div>
  }

  const guardar = cambios => d({ t: 'cfg~', cambios })
  const guardarGrupos = lista => guardar({ gruposImpresion: lista })
  const cambiarGrupo = (id, cambios) => guardarGrupos(grupos.map(g => (g.id === id ? { ...g, ...cambios } : g)))
  const nota = (id, txt, ok) => {
    setMsgs(m => ({ ...m, [id]: { txt, ok } }))
    setTimeout(() => setMsgs(m => { const n = { ...m }; delete n[id]; return n }), 6000)
  }
  const modoTickets = cfg.impresion === 'silenciosa' || cfg.imprimacion === 'silenciosa' ? 'silenciosa' : 'manual'
  const seccionesOrden = [...(s.secciones || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const usos = id => seccionesOrden.filter(sec => grupoDeSeccion(cfg, sec.id)?.id === id).length

  const conectar = async g => {
    setOcupadoId(g.id)
    try {
      await conectarImpresora({ grupo: g.id, baud: g.baud })
      nota(g.id, t('impresoras.conectadaOk'), true)
    } catch (e) {
      const cancelada = String(e?.name || '') === 'NotFoundError' // el usuario cerró el selector sin elegir
      nota(g.id, cancelada ? t('impresoras.cancelada') : `${t('impresoras.noConecta')} ${String(e?.message || e)}`, false)
    } finally { setOcupadoId(null); refrescar() }
  }

  const probar = async g => {
    setOcupadoId(g.id)
    try {
      await imprimirSilencioso({
        grupo: g.id,
        lineas: [
          // 'POS CONTROL' es el nombre del producto: va tal cual en el papel.
          { texto: 'POS CONTROL', negrita: true, centrado: true, tam: 2 },
          { texto: g.nombre.toUpperCase(), negrita: true, centrado: true },
          { texto: '', guion: true },
          { texto: `${t('impresoras.pruebaLinea')}\tOK`, guion: true },
          { texto: cfg.nombre || t('comun.miNegocio'), centrado: true },
          { texto: (Number(g.ancho) || 32) >= 42 ? t('impresoras.ancho80') : t('impresoras.ancho58'), centrado: true },
          { texto: new Date().toLocaleString(), centrado: true },
        ],
        ancho: Number(g.ancho) || 32,
        corte: true,
        beep: Boolean(cfg.impresoraBeep),
      })
      nota(g.id, t('impresoras.pruebaOk'), true)
    } catch (e) {
      nota(g.id, String(e?.message || e), false)
    } finally { setOcupadoId(null); refrescar() }
  }

  const crearGrupo = () => {
    const nombre = (nuevo || '').trim().slice(0, 40)
    if (!nombre) return
    let id = slugGrupo(nombre)
    while (grupos.some(g => g.id === id)) id += '-' + nuevoId().slice(0, 4)
    guardarGrupos([...grupos, { id, nombre, ancho: 32, baud: 9600 }])
    setNuevo(null)
  }

  const borrarGrupo = g => {
    const restantes = grupos.filter(x => x.id !== g.id)
    // Las secciones que apuntaban a este grupo vuelven al primero (grupoDeSeccion lo resuelve solo).
    const mapa = { ...(cfg.impresoraPorSeccion || {}) }
    Object.keys(mapa).forEach(k => { if (mapa[k] === g.id) delete mapa[k] })
    guardar({ gruposImpresion: restantes, impresoraPorSeccion: mapa })
    setConf(null)
  }

  const asignarSeccion = (seccionId, grupoId) => guardar({ impresoraPorSeccion: { ...(cfg.impresoraPorSeccion || {}), [seccionId]: grupoId } })

  const nComanda = gruposDeComanda(cfg).length

  return (
    <div className="adm-card adm-imp">
      <div className="adm-card-cab">
        <h3>{t('impresoras.titulo')}</h3>
        <span className="sp" />
        <button type="button" className="teal" onClick={() => setNuevo(nuevo === null ? '' : null)}>＋ {t('impresoras.nuevoGrupo')}</button>
      </div>
      <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.intro')}</p>

      {!soportado && (
        <div className="imp-noporte">
          {t('impresoras.noSoporte1')} <b>{t('impresoras.noSoporte2')}</b>{t('impresoras.noSoporte3')}{' '}
          <b>{t('impresoras.noSoporte4')}</b>{t('impresoras.noSoporte5')} {t('impresoras.noSoporte6')}{' '}
          <b>{t('impresoras.noSoporte7')}</b>{t('impresoras.noSoporte8')}
        </div>
      )}

      {nuevo !== null && (
        <form className="adm-fila adm-nuevo" onSubmit={e => { e.preventDefault(); crearGrupo() }}>
          <input autoFocus value={nuevo} maxLength={40} placeholder={t('impresoras.nombreGrupoPlace')} onChange={e => setNuevo(e.target.value)} />
          <button type="submit" className="success" disabled={!nuevo.trim()}>{t('comun.guardar')}</button>
          <button type="button" className="ghost" onClick={() => setNuevo(null)}>{t('comun.cancelar')}</button>
        </form>
      )}

      <div className="imp-grupos">
        {grupos.map(g => {
          const est = estadoImpresora(g.id)
          const claveChip = !soportado ? 'impresoras.estadoNoSoportado' : est.error ? 'impresoras.estadoError' : est.conectada ? 'impresoras.estadoOk' : 'impresoras.estadoOff'
          const clsChip = !soportado || est.error ? 'err' : est.conectada ? 'ok' : 'off'
          const n = usos(g.id)
          const m = msgs[g.id]
          const ocupado = ocupadoId === g.id
          return (
            <section key={g.id} className={'imp-grupo' + (g.tickets ? ' tickets' : '')}>
              <header className="imp-grupo-cab">
                <input className="imp-nombre" value={g.nombre} maxLength={40} aria-label={t('impresoras.nombreGrupo')}
                  onChange={e => cambiarGrupo(g.id, { nombre: e.target.value })} />
                <span className="adm-chip">{g.tickets ? t('impresoras.grupoTickets') : t('impresoras.grupoComanda')}</span>
                <span className={'imp-chip ' + clsChip}>{t(claveChip)}</span>
                {est.cola > 0 && <span className="adm-chip">{t('impresoras.cola', { n: est.cola })}</span>}
              </header>
              <div className="imp-opciones">
                <label className="adm-campo"><span>{t('impresoras.anchoLabel')}</span>
                  <select value={Number(g.ancho) >= 42 ? 48 : 32} onChange={e => cambiarGrupo(g.id, { ancho: Number(e.target.value) })}>
                    <option value={32}>{t('impresoras.ancho58')}</option>
                    <option value={48}>{t('impresoras.ancho80')}</option>
                  </select>
                </label>
                <label className="adm-campo"><span>{t('impresoras.baudLabel')}</span>
                  {/* Opciones técnicas (bps + modelo): se dejan tal cual. */}
                  <select value={Number(g.baud) || 9600} onChange={e => { fijarBaud(g.id, e.target.value); cambiarGrupo(g.id, { baud: Number(e.target.value) }) }}>
                    <option value={9600}>9600 bps (POS-580)</option>
                    <option value={115200}>115200 bps (Xprinter)</option>
                  </select>
                </label>
              </div>
              <div className="adm-fila">
                <button type="button" className="primary" disabled={!soportado || ocupado} onClick={() => conectar(g)}>{t('impresoras.conectar')}</button>
                <button type="button" className="success" disabled={!soportado || !est.conectada || ocupado} onClick={() => probar(g)}>{t('impresoras.probar')}</button>
                <span className="sp" />
                {conf === g.id ? (
                  <>
                    <span className="imp-dato">{t('impresoras.confirmarEliminar')}</span>
                    <button type="button" className="danger solid" onClick={() => borrarGrupo(g)}>{t('comun.confirmar')}</button>
                    <button type="button" className="ghost" onClick={() => setConf(null)}>{t('comun.cancelar')}</button>
                  </>
                ) : (
                  <button type="button" className="danger" disabled={(!g.tickets && nComanda <= 1) || g.tickets}
                    title={g.tickets ? t('impresoras.noSeBorra') : nComanda <= 1 ? t('impresoras.minUno') : n ? t('impresoras.enUso', { n }) : t('comun.eliminar')}
                    onClick={() => setConf(g.id)}>{t('comun.eliminar')}</button>
                )}
              </div>
              {!g.tickets && <p className="imp-dato" style={{ margin: 0 }}>{t('impresoras.seccionesDelGrupo', { n })}</p>}
              {est.error && <div className="imp-err">❌ {est.error}</div>}
              {m && <div className={'adm-msg' + (m.ok ? ' ok' : ' warn')}>{m.ok ? '✅ ' : '⚠️ '}{m.txt}</div>}
            </section>
          )
        })}
      </div>

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.seccionesTitulo')}</span>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.seccionesAyuda')}</p>
        <div className="imp-secciones">
          {seccionesOrden.map(sec => (
            <label key={sec.id} className="imp-seccion">
              <span>{sec.nombre}</span>
              <select value={grupoDeSeccion(cfg, sec.id)?.id || ''} onChange={e => asignarSeccion(sec.id, e.target.value)}>
                {gruposDeComanda(cfg).map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </label>
          ))}
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
          <label className="imp-radio"><input type="radio" name="imp-modo" checked={modoTickets === 'silenciosa'} onChange={() => guardar({ impresion: 'silenciosa' })} /> {t('impresoras.modoSilencioso')}</label>
          <label className="imp-radio"><input type="radio" name="imp-modo" checked={modoTickets !== 'silenciosa'} onChange={() => guardar({ impresion: 'manual' })} /> {t('impresoras.modoManual')}</label>
          <label className="imp-radio"><input type="checkbox" checked={Boolean(cfg.impresoraBeep)} onChange={e => guardar({ impresoraBeep: e.target.checked })} /> {t('impresoras.beep')}</label>
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('impresoras.notaComandas', { boton: t('pedido.enviarCocina') })}</p>
      </div>
    </div>
  )
}
