import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, saldoCuenta } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { useMoneda } from '../../../services/money.js'
import { cargarAlertas, contarAbiertas, conNombres } from '../../../services/alertasApi.js'
import { alertasAutomaticas } from './alertasAutomaticas.js'
import './AlertasPage.css'

const TIPOS = ['cocina', 'cobro', 'inventario', 'mesa', 'general']
const CHIPS_TIPO = ['todas', ...TIPOS]
const CHIPS_ESTADO = ['pendientes', 'resueltas', 'todas']

const ETIQUETA_TIPO = { todas: 'Todas', general: 'General', cocina: 'Cocina', cobro: 'Cobro', inventario: 'Inventario', mesa: 'Mesa' }
const ETIQUETA_ESTADO = { pendientes: 'Pendientes', resueltas: 'Resueltas', todas: 'Todas' }
const PRIORIDADES = [1, 5, 9]
const ETIQUETA_PRIO = { 1: '1 · Urgente', 5: '5 · Normal', 9: '9 · Baja' }

const MAX_TITULO = 80
const MAX_MENSAJE = 240
const REFRESCAR_MS = 20000
const AVISO_MS = 4000
const URGENTE = 2
const BAJA = 8

const etiquetaTipo = (tipo, tOr) => tOr('alertas.tipo.' + tipo, ETIQUETA_TIPO[tipo] || ETIQUETA_TIPO.general)
const prioridadValida = p => (Number.isFinite(Number(p)) ? Math.min(9, Math.max(1, Math.round(Number(p)))) : 5)
const etiquetaPrio = (p, tOr) => (p <= URGENTE ? tOr('alertas.prioUrgente', ETIQUETA_PRIO[1])
  : p >= BAJA ? tOr('alertas.prioBaja', ETIQUETA_PRIO[9]) : tOr('alertas.prioNormal', ETIQUETA_PRIO[5]))
const clasePrio = p => (p <= URGENTE ? ' urgente' : p >= BAJA ? ' baja' : '')

const hace = (ms, ahora, tOr) => {
  const t = Number(ms) || 0
  if (!t) return tOr('alertas.sinFecha', 'sin fecha')
  const d = Math.max(0, (ahora || Date.now()) - t)
  if (d < 60000) return tOr('alertas.haceAhora', 'hace un momento')
  if (d < 3600000) { const n = Math.floor(d / 60000); return tOr('alertas.haceMin', `hace ${n} min`, { n }) }
  if (d < 86400000) { const n = Math.floor(d / 3600000); return tOr('alertas.haceHoras', `hace ${n} h`, { n }) }
  const n = Math.floor(d / 86400000); return tOr('alertas.haceDias', `hace ${n} d`, { n })
}

export default function AlertasPage({ rol, sesion, onAbrirCuenta }) {
  const { s, d, error, modo } = useStore()
  const { tOr } = useIdioma()
  const { money } = useMoneda()

  const enBase = modo === 'supabase'
  const quien = sesion?.nombre || sesion?.usuario || rol || ''

  const [frescas, setFrescas] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [ahora, setAhora] = useState(() => Date.now())
  const [filtroTipo, setFiltroTipo] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('pendientes')
  const [form, setForm] = useState(null)
  const [formErr, setFormErr] = useState('')
  const [aviso, setAviso] = useState('')
  const [convertidas, setConvertidas] = useState(() => [])

  const seq = useRef(0)
  const timerAviso = useRef(null)

  useEffect(() => () => clearTimeout(timerAviso.current), [])

  const avisar = txt => {
    setAviso(txt)
    clearTimeout(timerAviso.current)
    timerAviso.current = setTimeout(() => setAviso(''), AVISO_MS)
  }

  const traer = useCallback(async () => {
    const n = ++seq.current
    setCargando(true)
    const lista = await cargarAlertas()
    if (n !== seq.current) return
    setFrescas(lista)
    setAhora(Date.now())
    setCargando(false)
  }, [])

  // Una sola carga inicial; el sondeo de 20 s y el evento de reanudación se solapan menos
  // si comparten el mismo cuerpo.
  useEffect(() => {
    if (enBase) traer()
    const tick = async () => {
      setAhora(Date.now())
      if (enBase) setFrescas(await cargarAlertas())
    }
    const id = setInterval(tick, REFRESCAR_MS)
    window.addEventListener('pos-reanudar', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('pos-reanudar', tick)
    }
  }, [enBase, traer])

  // El store ya trae el nombre del autor; la query suelta de alertasApi solo trae el uuid.
  const nombres = useMemo(() => {
    const m = new Map()
    const pon = (id, nombre) => { if (id && nombre && !m.has(id)) m.set(id, nombre) }
    for (const a of s.alertas || []) {
      if (!a) continue
      pon(a.creadaPorId, a.creadaPorNombre)
      pon(a.creadaPor, a.creadaPorNombre)
      pon(a.resueltaPorId, a.resueltaPorNombre)
      pon(a.resueltaPor, a.resueltaPorNombre)
    }
    return m
  }, [s.alertas])

  const base = useMemo(() => conNombres(enBase ? (frescas ?? s.alertas ?? []) : (s.alertas ?? []), nombres), [enBase, frescas, s.alertas, nombres])

  const nombreMesa = id => (s.mesas || []).find(m => m.id === id)?.nombre || ''
  const etiquetaCuenta = c => {
    if (!c) return ''
    const ids = Array.isArray(c.mesaIds) ? c.mesaIds : []
    if (ids.length) return ids.map(nombreMesa).filter(Boolean).join(' + ') || tOr('alertas.mesa', 'Mesa')
    if (c.canal === 'llevar') return tOr('alertas.paraLlevar', 'Para llevar')
    if (c.canal === 'mostrador') return tOr('alertas.mostrador', 'Mostrador')
    return c.numero ? tOr('alertas.pedidoN', `Pedido ${c.numero}`, { n: c.numero }) : tOr('alertas.cuenta', 'Cuenta')
  }
  const cuentaPorId = useMemo(() => new Map((s.cuentas || []).map(c => [c.id, c])), [s.cuentas])
  const cuentasAbiertas = useMemo(() => (s.cuentas || []).filter(c => c && c.estado !== 'cerrada'), [s.cuentas])

  const pendientes = useMemo(() => base.filter(a => a.resueltaEn == null), [base])
  const resueltas = useMemo(() => base.filter(a => a.resueltaEn != null), [base])

  const visiblesPend = useMemo(() => pendientes.filter(a => filtroTipo === 'todas' || a.tipo === filtroTipo)
    .sort((a, b) => (a.prioridad - b.prioridad) || (b.creadaEn - a.creadaEn)), [pendientes, filtroTipo])
  const visiblesRes = useMemo(() => resueltas.filter(a => filtroTipo === 'todas' || a.tipo === filtroTipo)
    .sort((a, b) => (b.resueltaEn || 0) - (a.resueltaEn || 0)), [resueltas, filtroTipo])

  const conteoTipo = useMemo(() => {
    const m = { todas: pendientes.length }
    TIPOS.forEach(t => { m[t] = pendientes.filter(a => a.tipo === t).length })
    return m
  }, [pendientes])

  // Sugerencias derivadas: se oculta la que ya fue convertida (mismo origen y mismo título), así no
  // se repite el aviso que PwaBridge ya notifica ni la que el equipo levantó a mano.
  const claveSugerencia = a => `${a.tipo}|${a.cuentaId || a.mesaId || 'sin'}|${a.titulo}`
  const sugerencias = useMemo(() => {
    const yaCubiertas = new Set(pendientes.map(claveSugerencia))
    return alertasAutomaticas({ cuentas: s.cuentas, mesas: s.mesas, insumos: s.insumos, ahora })
      .filter(a => !yaCubiertas.has(claveSugerencia(a)))
      .filter(a => filtroTipo === 'todas' || a.tipo === filtroTipo)
  }, [s.cuentas, s.mesas, s.insumos, ahora, pendientes, filtroTipo])

  const resolver = (a, resuelta) => d({ t: 'alerta-resolver', id: a.id, resuelta })

  const abrir = a => {
    onAbrirCuenta?.({ cuentaId: a.cuentaId, mesaId: a.mesaId, tipo: a.tipo })
    window.location.hash = '#salon'
  }

  const abrirForm = () => {
    setFormErr('')
    setForm({ titulo: '', mensaje: '', tipo: 'general', prioridad: 5, cuentaId: '' })
  }

  const guardar = () => {
    if (!form) return
    const titulo = (form.titulo || '').trim().slice(0, MAX_TITULO)
    if (!titulo) { setFormErr(tOr('alertas.form.faltaTitulo', 'Escribe un título para la alerta.')); return }
    const cuenta = cuentaPorId.get(form.cuentaId) || null
    d({
      t: 'alerta+',
      alerta: {
        tipo: TIPOS.includes(form.tipo) ? form.tipo : 'general',
        titulo,
        mensaje: (form.mensaje || '').trim().slice(0, MAX_MENSAJE),
        cuentaId: cuenta?.id ?? null,
        mesaId: Array.isArray(cuenta?.mesaIds) ? cuenta.mesaIds[0] ?? null : null,
        prioridad: prioridadValida(form.prioridad),
      },
    })
    setForm(null)
    setFormErr('')
    avisar(tOr('alertas.creada', 'Alerta levantada.'))
  }

  const convertir = a => {
    if (convertidas.includes(a.id)) return
    d({
      t: 'alerta+',
      alerta: { tipo: a.tipo, titulo: a.titulo, mensaje: a.mensaje, cuentaId: a.cuentaId ?? null, mesaId: a.mesaId ?? null, prioridad: prioridadValida(a.prioridad) },
    })
    setConvertidas(prev => [...prev, a.id])
    avisar(tOr('alertas.auto.convertida', 'Sugerencia convertida en alerta.'))
  }

  const grupos = []
  if (filtroEstado !== 'resueltas') grupos.push({ id: 'pendientes', titulo: tOr('alertas.groupPendientes', 'Pendientes'), filas: visiblesPend })
  if (filtroEstado !== 'pendientes') grupos.push({ id: 'resueltas', titulo: tOr('alertas.groupResueltas', 'Resueltas'), filas: visiblesRes })
  const totalVisible = grupos.reduce((t, g) => t + g.filas.length, 0)
  const nAbiertas = contarAbiertas(base)

  // El saldo pendiente va en la fila para que el cajero sepa de qué plata se habla.
  const etiquetaSaldo = cuenta => {
    const resto = saldoCuenta(cuenta)
    return resto > 0.009 ? `${tOr('alertas.saldo', 'saldo')} ${money(resto)}` : null
  }

  const filaAlerta = a => {
    const resuelta = a.resueltaEn != null
    const cuenta = a.cuentaId ? cuentaPorId.get(a.cuentaId) : null
    const mesa = a.mesaId ? nombreMesa(a.mesaId) : ''
    const lazo = cuenta ? etiquetaCuenta(cuenta) : (mesa || (a.mesaId ? tOr('alertas.mesa', 'Mesa') : ''))
    const saldoTxt = cuenta && cuenta.estado !== 'cerrada' ? etiquetaSaldo(cuenta) : null
    return (
      <article key={a.id} className={'ala-fila' + (resuelta ? ' resuelta' : '') + clasePrio(a.prioridad)}>
        <div className="ala-cuerpo">
          <div className="ala-cab-fila">
            <span className={'ala-badge ala-tipo-' + a.tipo}>{etiquetaTipo(a.tipo, tOr)}</span>
            <span className={'ala-prio' + clasePrio(a.prioridad)}>{etiquetaPrio(a.prioridad, tOr)}</span>
            {a.monto > 0 && <span className="ala-monto">{money(a.monto)}</span>}
            {saldoTxt && <span className="ala-saldo">{saldoTxt}</span>}
          </div>
          <b className="ala-titulo">{a.titulo}</b>
          {a.mensaje && <p className="ala-msg">{a.mensaje}</p>}
          <div className="ala-meta">
            <span>{a.auto ? tOr('alertas.auto.chip', 'automática')
              : a.creadaPor ? tOr('alertas.laLevanto', `la levantó ${a.creadaPor}`, { quien: a.creadaPor })
                : tOr('alertas.sinAutor', 'sin autor')}</span>
            <span aria-hidden="true">·</span>
            <span>{hace(a.creadaEn, ahora, tOr)}</span>
            {resuelta && (
              <>
                <span aria-hidden="true">·</span>
                <span>{tOr('alertas.resuelta', 'resuelta')} {hace(a.resueltaEn, ahora, tOr)}{a.resueltaPor ? ` · ${a.resueltaPor}` : ''}</span>
              </>
            )}
            {lazo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="ala-lazo">🪑 {lazo}</span>
              </>
            )}
          </div>
        </div>
        <div className="ala-acciones">
          {resuelta ? (
            <button type="button" className="ghost" onClick={() => resolver(a, false)}>↺ {tOr('alertas.reabrir', 'Reabrir')}</button>
          ) : (
            <button type="button" className="primary" onClick={() => resolver(a, true)}>✔ {tOr('alertas.resolver', 'Resolver')}</button>
          )}
          {a.cuentaId && (
            <button type="button" className="ghost" onClick={() => abrir(a)}>↗ {tOr('alertas.abrirCuenta', 'Abrir cuenta')}</button>
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="ala">
      <header className="ala-cab">
        <div className="ala-cab-txt">
          <h2>🔔 {tOr('alertas.titulo', 'Alertas')}</h2>
          <p className="ala-sub">
            {tOr('alertas.desc', 'Lo que necesita una acción ahora mismo en el negocio.')}{' '}
            <b>{tOr('alertas.abiertasN', `${nAbiertas} abiertas`, { n: nAbiertas })}</b>
            {enBase && cargando && frescas === null ? ` · ${tOr('alertas.cargando', 'cargando…')}` : ''}
          </p>
        </div>
        <div className="ala-cab-acc">
          {enBase && (
            <button type="button" className="ghost" onClick={traer} disabled={cargando}>
              {cargando ? tOr('alertas.cargando', 'Cargando…') : tOr('alertas.actualizar', 'Actualizar')}
            </button>
          )}
          <button type="button" className={form ? 'ghost' : 'primary'} onClick={form ? () => { setForm(null); setFormErr('') } : abrirForm}>
            {form ? `✕ ${tOr('alertas.form.cerrar', 'Cerrar formulario')}` : `＋ ${tOr('alertas.nueva', 'Nueva alerta')}`}
          </button>
        </div>
      </header>

      {error && <div className="ala-error" role="alert">⚠️ {error}</div>}
      {aviso && <div className="ala-ok" role="status">✓ {aviso}</div>}

      <section className="ala-filtros" role="group" aria-label={tOr('alertas.filtros', 'Filtros')}>
        <div className="ala-grupo" role="group" aria-label={tOr('alertas.filtroTipo', 'Tipo de alerta')}>
          <span className="ala-grupo-label">{tOr('alertas.filtroTipo', 'Tipo')}</span>
          {CHIPS_TIPO.map(k => (
            <button key={k} type="button" className={'tab' + (filtroTipo === k ? ' on' : '')} aria-pressed={filtroTipo === k}
              onClick={() => setFiltroTipo(k)}>
              {etiquetaTipo(k, tOr)}
              {conteoTipo[k] > 0 && <em className="ala-n">{conteoTipo[k]}</em>}
            </button>
          ))}
        </div>
        <div className="ala-grupo" role="group" aria-label={tOr('alertas.filtroEstado', 'Estado de la alerta')}>
          <span className="ala-grupo-label">{tOr('alertas.filtroEstado', 'Estado')}</span>
          {CHIPS_ESTADO.map(k => (
            <button key={k} type="button" className={'tab' + (filtroEstado === k ? ' on' : '')} aria-pressed={filtroEstado === k}
              onClick={() => setFiltroEstado(k)}>
              {tOr('alertas.estado.' + k, ETIQUETA_ESTADO[k])}
            </button>
          ))}
        </div>
      </section>

      {form && (
        <section className="ala-form" aria-label={tOr('alertas.nueva', 'Nueva alerta')}>
          <b>{tOr('alertas.form.titulo', 'Nueva alerta')}</b>
          <label className="ala-campo">
            <span>{tOr('alertas.form.camposTitulo', 'Título')}</span>
            <input name="campos-titulo" autoFocus value={form.titulo} maxLength={MAX_TITULO}
              placeholder={tOr('alertas.form.tituloPista', 'Qué pasa, en pocas palabras')}
              aria-label={tOr('alertas.form.camposTitulo', 'Título')}
              onChange={e => { setForm(f => ({ ...f, titulo: e.target.value })); setFormErr('') }} />
            <span className="ala-cont">{form.titulo.length}/{MAX_TITULO}</span>
          </label>
          <label className="ala-campo">
            <span>{tOr('alertas.form.camposMensaje', 'Mensaje')}</span>
            <textarea name="campos-mensaje" value={form.mensaje} maxLength={MAX_MENSAJE} rows={3}
              placeholder={tOr('alertas.form.mensajePista', 'Detalle para quien la reciba')}
              aria-label={tOr('alertas.form.camposMensaje', 'Mensaje')}
              onChange={e => setForm(f => ({ ...f, mensaje: e.target.value }))} />
            <span className="ala-cont">{form.mensaje.length}/{MAX_MENSAJE}</span>
          </label>
          <div className="ala-campos">
            <label className="ala-campo">
              <span>{tOr('alertas.form.tipo', 'Tipo')}</span>
              <select name="tipo" value={form.tipo} aria-label={tOr('alertas.form.tipo', 'Tipo')}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPOS.map(k => <option key={k} value={k}>{etiquetaTipo(k, tOr)}</option>)}
              </select>
            </label>
            <label className="ala-campo">
              <span>{tOr('alertas.form.prioridad', 'Prioridad')}</span>
              <select name="prioridad" value={form.prioridad} aria-label={tOr('alertas.form.prioridad', 'Prioridad')}
                onChange={e => setForm(f => ({ ...f, prioridad: Number(e.target.value) }))}>
                {PRIORIDADES.map(p => <option key={p} value={p}>{tOr('alertas.prio.' + p, ETIQUETA_PRIO[p])}</option>)}
              </select>
            </label>
            <label className="ala-campo ala-ancho2">
              <span>{tOr('alertas.form.cuenta', 'Cuenta abierta')}</span>
              <select name="cuenta" value={form.cuentaId} aria-label={tOr('alertas.form.cuenta', 'Cuenta abierta')}
                onChange={e => setForm(f => ({ ...f, cuentaId: e.target.value }))}>
                <option value="">{tOr('alertas.form.sinCuenta', 'Sin cuenta (aviso general)')}</option>
                {cuentasAbiertas.map(c => (
                  <option key={c.id} value={c.id}>
                    {etiquetaCuenta(c)}{c.clienteNombre ? ` · ${c.clienteNombre}` : ''} · {money(saldoCuenta(c))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formErr && <span className="ala-error" role="alert">⚠️ {formErr}</span>}
          <p className="ala-pista">{tOr('alertas.form.creadaPor', 'La levanta')} <b>{quien || tOr('alertas.form.anonimo', 'sin sesión')}</b></p>
          <div className="ala-form-acc">
            <button type="button" className="primary" onClick={guardar}>{tOr('alertas.form.guardar', 'Guardar alerta')}</button>
            <button type="button" className="ghost" onClick={() => { setForm(null); setFormErr('') }}>{tOr('alertas.form.cancelar', 'Cancelar')}</button>
          </div>
        </section>
      )}

      {totalVisible === 0 ? (
        <div className="ala-vacio">
          <b>{tOr('alertas.vacio.titulo', 'No hay alertas aquí')}</b>
          <p>{pendientes.length === 0 && resueltas.length === 0
            ? tOr('alertas.vacio.nada', 'Cuando alguien levante una alerta aparecerá en esta lista.')
            : tOr('alertas.vacio.filtro', 'Ninguna alerta con los filtros actuales.')}</p>
        </div>
      ) : (
        grupos.map(g => (
          <section key={g.id} className="ala-bloque">
            <div className="ala-bloque-cab">
              <h3>{g.titulo}</h3>
              <span className="ala-badge">{g.filas.length}</span>
            </div>
            {g.filas.length === 0
              ? <p className="ala-pista">{g.id === 'pendientes' ? tOr('alertas.vacio.pendientes', 'Nada pendiente por ahora.') : tOr('alertas.vacio.resueltas', 'Aún no has resuelto alertas.')}</p>
              : <div className="ala-lista">{g.filas.map(filaAlerta)}</div>}
          </section>
        ))
      )}

      {filtroEstado !== 'resueltas' && (
        <section className="ala-auto" aria-label={tOr('alertas.auto.titulo', 'Sugerencias automáticas')}>
          <div className="ala-bloque-cab">
            <h3>💡 {tOr('alertas.auto.titulo', 'Sugerencias automáticas')}</h3>
            <span className="ala-badge">{sugerencias.length}</span>
          </div>
          <p className="ala-pista">{tOr('alertas.auto.desc', 'Calculadas del estado actual; no se guardan hasta que las conviertas en alerta.')}</p>
          {sugerencias.length === 0 ? (
            <p className="ala-pista">{tOr('alertas.auto.nada', 'Nada que sugerir: el servicio está al día.')}</p>
          ) : (
            <div className="ala-lista">
              {sugerencias.map(a => {
                const hecha = convertidas.includes(a.id)
                return (
                  <div key={a.id} className={'ala-fila ala-auto-fila' + clasePrio(a.prioridad)}>
                    <div className="ala-cuerpo">
                      <div className="ala-cab-fila">
                        <span className={'ala-badge ala-tipo-' + a.tipo}>{etiquetaTipo(a.tipo, tOr)}</span>
                        <span className={'ala-prio' + clasePrio(a.prioridad)}>{etiquetaPrio(a.prioridad, tOr)}</span>
                        {a.monto > 0 && <span className="ala-monto">{money(a.monto)}</span>}
                      </div>
                      <b className="ala-titulo">{a.titulo}</b>
                      <p className="ala-msg">{a.mensaje}</p>
                      <div className="ala-meta">
                        <span>{tOr('alertas.auto.chip', 'automática')}</span>
                        <span aria-hidden="true">·</span>
                        <span>{hace(a.creadaEn, ahora, tOr)}</span>
                      </div>
                    </div>
                    <div className="ala-acciones">
                      <button type="button" className="primary" disabled={hecha} onClick={() => convertir(a)}>
                        {hecha ? tOr('alertas.auto.yaConvertida', 'Ya la levantaste') : `＋ ${tOr('alertas.auto.convertir', 'Convertir en alerta')}`}
                      </button>
                      {a.cuentaId && <button type="button" className="ghost" onClick={() => abrir(a)}>↗ {tOr('alertas.abrirCuenta', 'Abrir cuenta')}</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
