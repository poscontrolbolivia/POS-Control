// Gestión del equipo del negocio (solo rol admin): listar personas, invitar con clave inicial,
// restablecer una clave olvidada y quitar el acceso.
// Habla SOLO con las RPCs de la migración 004 (equipo_listar / equipo_invitar /
// equipo_restablecer / equipo_revocar), todas con p_empresa_id (rpc() lo inyecta) y todas con
// permiso validado en la base: aquí el rol solo decide si la pantalla se muestra.
// Sin diálogos nativos (alert/confirm/prompt bloquean la pestaña en browsers embebidos):
// las confirmaciones y los errores se pintan en pantalla.
// Props: { rol, sesion }
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import { rpc, mensajeError } from '../../services/supabase.js'
import './admin.css'      // clases .adm-* del área de administración (las comparte con ConfigAdmin)
import './EquipoAdmin.css'

// Roles tal y como los guarda la base (escritos en español). La etiqueta visible pasa por
// tOr('rol.' + rol, rol), que son claves que ya existen en los tres diccionarios.
const ROLES = ['admin', 'cajero', 'mesero']
const MIN_CLAVE = 4 // mismo mínimo que exige la base; se valida aquí para no ir de vacío
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Clave inicial pronunciable: tres sílabas consonante+vocal = 6 caracteres ("kanuseli").
// Es para entregarla en persona y cambiarla luego, no para memorizar un password de banco.
const CONSONANTES = 'bcdfghjklmnprstvz'
const VOCALES = 'aeiou'
const azar = max => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint32Array(1)
    crypto.getRandomValues(b)
    return b[0] % max
  }
  return Math.floor(Math.random() * max)
}
const generarClave = () => {
  let clave = ''
  for (let i = 0; i < 3; i++) clave += CONSONANTES[azar(CONSONANTES.length)] + VOCALES[azar(VOCALES.length)]
  return clave
}

// Los `raise exception` de Postgres llegan en error.message. Cuando el caso tiene prefijo
// conocido (equipo_correo_tomado) lo traducimos; el resto (p. ej. «no puedes quitarte a ti
// mismo» o «debe quedar al menos un admin») ya viene escrito en español por la base y se
// muestra tal cual: borrar esos mensajes dejaría al usuario sin el motivo real.
const textoError = (err, tOr) => {
  const crudo = mensajeError(err)
  if (crudo.includes('equipo_correo_tomado')) return tOr('equipo.correoTomado', 'Ese correo ya está en tu equipo.')
  return crudo
}

const IDIOMA_LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' }
// '2026-10-16T13:52:00Z' → '16/10/2026'. Fecha ausente o rara → '—' (nunca NaN en pantalla).
function fecha(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(IDIOMA_LOCALE[idiom] || 'es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function EquipoAdmin({ rol, sesion }) {
  const { modo } = useStore()
  const { tOr, idiom } = useIdioma()

  const [miembros, setMiembros] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')       // fallo de lectura o de la última operación
  const [aviso, setAviso] = useState('')       // mensaje verde tras un alta/cambio
  const [form, setForm] = useState({ nombre: '', correo: '', rol: 'cajero', clave: '' })
  const [validando, setValidando] = useState('') // error de formulario (local, sin ida a la base)
  const [enviando, setEnviando] = useState(false)
  const [claveFila, setClaveFila] = useState(null)   // { usuarioId, nombre, clave } de la fila en edición
  const [claveMsg, setClaveMsg] = useState('')       // error local del campo de clave (no ensucia el global)
  const [guardandoClave, setGuardandoClave] = useState(false)
  const [quitandoId, setQuitandoId] = useState(null) // usuario_id cuya revocación está en vuelo
  const [confirmaId, setConfirmaId] = useState(null) // fila en «¿Seguro?» (confirmación en dos toques)
  const timerRef = useRef(null)                      // caducidad de la pregunta «¿Seguro?»

  const esAdmin = rol === 'admin'
  const enBase = modo === 'supabase'
  // Una mutación a la vez: mientras algo está en vuelo se bloquean los botones de escribir
  // (los de actualizar también, para no pisarse con el refresco posterior).
  const ocupado = enviando || guardandoClave || Boolean(quitandoId)

  // Se apaga la ventana de confirmación al desmontar (si no, el setTimeout avisaría a un
  // componente que ya no está en el árbol).
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const cargar = async (silenciosa = false) => {
    if (!silenciosa) setCargando(true)
    setError('')
    try {
      // conEmpresa:false ⇒ las cuatro RPCs de equipo no reciben p_empresa_id: la migración 004
      // lee la empresa con private.empresa_activa() (el GUC de la conexión anclada). Mandar el
      // parámetro haría que PostgREST no encontrara la firma y contestara «no existe la función».
      const filas = await rpc('equipo_listar', {}, { conEmpresa: false })
      setMiembros(Array.isArray(filas) ? filas : [])
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setCargando(false)
    }
  }

  // La lista se lee al hacerse visible el bloque (montaje), no en cada tecla: el panel de
  // configuración se renderiza muchas veces mientras se escribe y equipo_listar es una consulta.
  useEffect(() => {
    if (esAdmin && enBase) cargar()
    // eslint-disable-next-line
  }, [esAdmin, enBase])

  if (!esAdmin) return null

  if (!enBase) {
    return (
      <div className="adm-card eq-bloque">
        <div className="adm-card-cab"><h3>{tOr('equipo.titulo', 'Equipo')}</h3></div>
        <p className="adm-vacio">{tOr('equipo.sinSupabase', 'El equipo se gestiona en la base de datos: en el modo de prueba no hay usuarios reales que invitar.')}</p>
      </div>
    )
  }

  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setValidando('') }

  // ── Alta ──
  const validarInvitar = () => {
    if (!form.nombre.trim()) return tOr('equipo.faltaNombre', 'Escribe el nombre de la persona.')
    if (!form.correo.trim()) return tOr('equipo.faltaCorreo', 'Escribe el correo con el que va a entrar.')
    if (!CORREO_OK.test(form.correo.trim())) return tOr('equipo.correoInvalido', 'Ese correo no tiene un formato válido.')
    if (form.clave.length < MIN_CLAVE) return tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.')
    return ''
  }

  const invitar = async e => {
    e.preventDefault()
    if (ocupado) return
    const problema = validarInvitar()
    if (problema) { setValidando(problema); return }
    setValidando(''); setAviso(''); setError(''); setEnviando(true)
    try {
      await rpc('equipo_invitar', {
        p_nombre: form.nombre.trim(),
        p_correo: form.correo.trim().toLowerCase(),
        p_rol: form.rol,
        p_clave: form.clave,
      }, { conEmpresa: false })
      setForm(f => ({ nombre: '', correo: '', rol: f.rol, clave: '' }))
      setAviso(tOr('equipo.altaOk', 'Listo: esa persona ya puede entrar con su correo y la clave inicial.'))
      await cargar(true) // siempre refrescamos: la lista la manda la base, nunca la inventamos local
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setEnviando(false)
    }
  }

  // ── Clave olvidada (campo inline, sin diálogo) ──
  const abrirClave = m => {
    setAviso(''); setError(''); setClaveMsg('')
    setClaveFila(c => (c && c.usuarioId === m.usuario_id ? null : { usuarioId: m.usuario_id, nombre: m.nombre || m.correo, clave: generarClave() }))
    setGuardandoClave(false)
  }
  const guardarClave = async e => {
    e.preventDefault()
    if (!claveFila || ocupado) return
    if (claveFila.clave.length < MIN_CLAVE) { setClaveMsg(tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.')); return }
    setError(''); setClaveMsg(''); setAviso(''); setGuardandoClave(true)
    try {
      await rpc('equipo_restablecer', { p_usuario_id: claveFila.usuarioId, p_clave: claveFila.clave }, { conEmpresa: false })
      setAviso(tOr('equipo.claveOk', 'Clave cambiada: comunícala a esa persona.'))
      setClaveFila(null)
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setGuardandoClave(false)
    }
  }

  // ── Revocar: dos toques (primer toque pregunta, el segundo ejecuta) ──
  const quitar = async m => {
    if (ocupado) return
    setAviso(''); setError(''); setQuitandoId(m.usuario_id)
    try {
      await rpc('equipo_revocar', { p_usuario_id: m.usuario_id }, { conEmpresa: false })
      setAviso(tOr('equipo.revocadoOk', 'Esa persona ya no puede entrar.'))
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr)) // «no puedes quitarte a ti mismo» / «debe quedar un admin»
    } finally {
      setQuitandoId(null)
      setConfirmaId(null)
      clearTimeout(timerRef.current)
    }
  }

  const pulsarQuitar = m => {
    clearTimeout(timerRef.current)
    if (confirmaId === m.usuario_id) { quitar(m); return }
    setConfirmaId(m.usuario_id)
    setClaveFila(c => (c && c.usuarioId === m.usuario_id ? null : c))
    timerRef.current = setTimeout(() => setConfirmaId(null), 4000) // la pregunta caduca sola
  }

  return (
    <section className="adm-card adm-equipo eq-bloque">
      <div className="adm-card-cab">
        <h3>{tOr('equipo.titulo', 'Equipo')}</h3>
        <span className="adm-chip">{miembros.length} {miembros.length === 1 ? tOr('equipo.una', 'persona') : tOr('equipo.varias', 'personas')}</span>
        <span className="sp" />
        <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>
          {cargando ? tOr('equipo.cargando', 'Cargando…') : tOr('equipo.actualizar', 'Actualizar')}
        </button>
      </div>
      <p className="adm-sub eq-nota">
        {tOr('equipo.subtitulo', 'Las personas de esta lista entran a')} <b>{sesion?.empresa || tOr('equipo.tuNegocio', 'tu negocio')}</b>{' '}
        {tOr('equipo.subtitulo2', 'con su correo y su clave. Cambia la clave si la olvidó y quítala cuando se vaya.')}
      </p>

      {error && (
        <div className="eq-error" role="alert">
          ⚠️ {error}
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>{tOr('equipo.reintentar', 'Reintentar')}</button>
        </div>
      )}
      {aviso && <div className="eq-ok">✅ {aviso}</div>}

      {cargando && miembros.length === 0
        ? <div className="adm-vacio">{tOr('equipo.consultando', 'Consultando el equipo…')}</div>
        : miembros.length
          ? (
            <div className="eq-lista">
              <div className="eq-cab">
                <span>{tOr('equipo.colPersona', 'Persona')}</span>
                <span>{tOr('equipo.colRol', 'Rol')}</span>
                <span>{tOr('equipo.colAlta', 'Alta')}</span>
                <span className="eq-cab-acciones">{tOr('equipo.colAcciones', 'Acciones')}</span>
              </div>
              {miembros.map(m => {
                const enClave = claveFila?.usuarioId === m.usuario_id
                const preguntando = confirmaId === m.usuario_id
                return (
                  <div key={m.usuario_id} className="eq-fila">
                    <div className="eq-cab-movil">{tOr('equipo.colPersona', 'Persona')}</div>
                    <div className="eq-persona">
                      <span className="eq-nombre">{m.nombre || tOr('equipo.sinNombre', 'sin nombre')}</span>
                      <span className="eq-correo">{m.correo}</span>
                    </div>
                    <div className="eq-celda">
                      <span className="eq-cab-movil">{tOr('equipo.colRol', 'Rol')}</span>
                      <span className={'eq-rol eq-rol-' + (m.rol || 'otro')}>{tOr('rol.' + m.rol, m.rol || '—')}</span>
                    </div>
                    <div className="eq-celda">
                      <span className="eq-cab-movil">{tOr('equipo.colAlta', 'Alta')}</span>
                      <span className="eq-alta">{fecha(m.creado_en, idiom)}</span>
                    </div>
                    <div className="eq-acciones">
                      <button type="button" className="ghost" disabled={ocupado} onClick={() => abrirClave(m)}>
                        {enClave ? tOr('equipo.clave.cerrar', 'Cerrar') : tOr('equipo.clave.abrir', 'Nueva clave')}
                      </button>
                      <button type="button"
                        className={'eq-quitar' + (preguntando ? ' preguntando' : '')}
                        disabled={ocupado}
                        onClick={() => pulsarQuitar(m)}>
                        {quitandoId === m.usuario_id
                          ? tOr('equipo.quitar.haciendo', 'Quitando…')
                          : preguntando
                            ? tOr('equipo.quitar.pregunta', '¿Seguro?')
                            : tOr('equipo.quitar', 'Quitar')}
                      </button>
                    </div>

                    {enClave && (
                      <form className="eq-clave" onSubmit={guardarClave}>
                        <b className="eq-clave-titulo">{tOr('equipo.clave.titulo', 'Nueva clave para')} <span className="eq-clave-nombre">{claveFila.nombre}</span></b>
                        <div className="eq-clave-fila">
                          <input autoFocus type="text" value={claveFila.clave} autoComplete="new-password"
                            placeholder={tOr('equipo.clave.pista', 'mínimo 4 caracteres')}
                            onChange={e => { setClaveFila(c => ({ ...c, clave: e.target.value })); setClaveMsg('') }} />
                          <button type="button" className="ghost" onClick={() => setClaveFila(c => ({ ...c, clave: generarClave() }))}>
                            {tOr('equipo.generar', 'Generar')}
                          </button>
                        </div>
                        {claveMsg && <span className="adm-msg warn">{claveMsg}</span>}
                        <div className="adm-fila">
                          <button type="submit" className="primary" disabled={ocupado}>
                            {guardandoClave ? tOr('equipo.clave.guardando', 'Guardando…') : tOr('equipo.clave.guardar', 'Guardar la clave')}
                          </button>
                          <button type="button" onClick={() => { setClaveFila(null); setClaveMsg('') }} disabled={guardandoClave}>
                            {tOr('equipo.cancelar', 'Cancelar')}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          )
          : error
            ? null // el aviso rojo de arriba ya explica el fallo: sin lista y sin duplicar el mensaje
            : <div className="adm-vacio">{tOr('equipo.vacio', 'Todavía no hay nadie más en el equipo. Invita a la primera persona abajo.')}</div>}

      {/* Alta: un formulario fijo, no un diálogo, para poder invitar desde el móvil sin perder la lista */}
      <form className="eq-invitar" onSubmit={invitar}>
        <h4 className="eq-invitar-titulo">{tOr('equipo.invitar.titulo', 'Invitar a una persona')}</h4>
        <div className="eq-campos">
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.nombre', 'Nombre')}</span>
            <input value={form.nombre} onChange={set('nombre')} placeholder={tOr('equipo.invitar.nombrePista', 'p. ej. María Quispe')} autoComplete="off" />
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.correo', 'Correo')}</span>
            <input type="email" inputMode="email" value={form.correo} onChange={set('correo')}
              placeholder={tOr('equipo.invitar.correoPista', 'maria@negocio.com')} autoComplete="off" />
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.rol', 'Rol')}</span>
            <select value={form.rol} onChange={set('rol')}>
              {ROLES.map(r => <option key={r} value={r}>{tOr('rol.' + r, r)}</option>)}
            </select>
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.clave', 'Clave inicial')}</span>
            <span className="eq-clave-fila">
              <input type="text" value={form.clave} onChange={set('clave')} autoComplete="new-password"
                placeholder={tOr('equipo.clave.pista', 'mínimo 4 caracteres')} />
              <button type="button" className="ghost" onClick={() => { setForm(f => ({ ...f, clave: generarClave() })); setValidando('') }}>
                {tOr('equipo.generar', 'Generar')}
              </button>
            </span>
          </label>
        </div>
        <div className="adm-fila">
          <button type="submit" className="primary" disabled={ocupado || cargando}>
            {enviando ? tOr('equipo.invitar.enviando', 'Invitando…') : tOr('equipo.invitar.enviar', 'Invitar al equipo')}
          </button>
          {validando && <span className="adm-msg warn">{validando}</span>}
        </div>
        <p className="eq-ayuda">
          {tOr('equipo.invitar.ayuda', 'Se invita con la clave que escribas aquí: el rol decide qué puede hacer en la app (admin manda en todo, cajero cobra, mesero toma pedidos). La base rechaza correos repetidos y no deja quitar el último admin.')}
        </p>
      </form>
    </section>
  )
}
