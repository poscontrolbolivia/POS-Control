import { useEffect, useRef } from 'react'
import { useStore, leerSesionSup } from '../context/StoreContext.jsx'
import { useIdioma } from '../i18n/index.jsx'
import { initNotificaciones, notificarLocal, permisoConcedido, cancelarNotificacion } from '../services/notifications'
import { sb, rpc } from '../services/supabaseClient.js'
import { debeAvisar, recibeAvisos, esDeCocina, areasDeItem } from '../services/avisos.js'

const MAX_AVISOS = 3
// Un cambio más viejo que esto no se avisa: si el teléfono estuvo dormido, al despertar no debe caer
// una avalancha de notificaciones de cosas que ya pasaron.
const VENTANA_MS = 2 * 60 * 1000

// Quién recibe qué lo decide services/avisos.js: cada persona solo recibe lo suyo (su mesa, su área).
export default function PwaBridge() {
  const { s } = useStore()
  const { t } = useIdioma()

  const vistosRef = useRef(new Set())
  const estadosRef = useRef(new Map())
  const sembradoRef = useRef(false)
  const claveRef = useRef('')
  const miIdRef = useRef(null)
  const misAreasRef = useRef([])

  useEffect(() => { initNotificaciones() }, [])

  const ses = leerSesionSup()
  const rol = ses?.rol || ''
  const empresaId = s._empresaId || ''

  // Quién soy (id de usuario) y, si soy de cocina/barra, mis áreas.
  useEffect(() => {
    let vivo = true
    miIdRef.current = null
    misAreasRef.current = []
    if (!sb || !empresaId) return undefined
    sb.auth.getSession().then(r => { if (vivo) miIdRef.current = r?.data?.session?.user?.id || null }).catch(() => {})
    if (esDeCocina(rol)) {
      rpc('mis_areas', {}).then(r => { if (vivo) misAreasRef.current = Array.isArray(r) ? r : [] }).catch(() => {})
    }
    return () => { vivo = false }
  }, [empresaId, rol])

  const nombreCuenta = (c, mesas) => {
    if (c.tipo === 'directa' || (c.mesaIds || []).length === 0) {
      return c.numero ? t('pwa.pedidoNumero', { n: c.numero }) : (c.canal === 'mostrador' ? t('pwa.mostrador') : t('pwa.ventaDirecta'))
    }
    const nombres = c.mesaIds.map((id) => mesas.find((m) => m.id === id)?.nombre || t('pwa.mesa'))
    return nombres.join(' + ')
  }

  useEffect(() => {
    // Mientras carga la empresa el estado está vacío: no se toma como «base».
    if (s._supCargando) return
    const cuentas = s.cuentas || []
    const mesas = s.mesas || []
    const ahora = Date.now()
    const reciente = ts => !ts || ahora - ts <= VENTANA_MS

    // Cambiar de empresa (o de sesión) empieza de cero: lo que ya existía en la otra NO es un aviso nuevo.
    const clave = (ses?.empresaId || '') + '|' + empresaId + '|' + (ses?.usuario || '')
    if (claveRef.current !== clave) {
      claveRef.current = clave
      vistosRef.current = new Set()
      estadosRef.current = new Map()
      sembradoRef.current = false
    }

    const memorizar = () => {
      cuentas.forEach((c) => {
        estadosRef.current.set(c.id, c.estado)
        c.items.forEach((i) => {
          if (i.estado === 'enviado') vistosRef.current.add('env:' + i.id + ':' + (i.enviadoEn || 0))
          if (i.estado === 'listo') vistosRef.current.add('listo:' + i.id)
        })
      })
    }

    const quien = { rol, esSuper: Boolean(ses?.es_super), miId: miIdRef.current, miNombre: ses?.nombre, miUsuario: ses?.usuario, misAreas: misAreasRef.current }

    if (!sembradoRef.current) { memorizar(); sembradoRef.current = true; return }
    // Sin permiso del navegador o con un rol que no recibe avisos, solo se mantiene al día lo ya visto.
    if (!permisoConcedido() || !recibeAvisos(quien)) { memorizar(); return }

    const comandas = []
    const listos = []

    cuentas.forEach((c) => {
      const anterior = estadosRef.current.get(c.id)
      estadosRef.current.set(c.id, c.estado)

      // Platos nuevos para cocina/barra: solo los de sus áreas.
      const nuevos = []
      const salieron = []
      c.items.forEach((i) => {
        if (i.estado === 'enviado') {
          const k = 'env:' + i.id + ':' + (i.enviadoEn || 0)
          if (vistosRef.current.has(k)) return
          vistosRef.current.add(k)
          if (reciente(i.enviadoEn) && debeAvisar(quien, { tipo: 'comanda', areas: areasDeItem(i) })) nuevos.push(i)
        } else if (i.estado === 'listo') {
          const k = 'listo:' + i.id
          if (vistosRef.current.has(k)) return
          vistosRef.current.add(k)
          if (reciente(i.listoEn)) salieron.push(i)
        }
      })
      if (nuevos.length) comandas.push({ cuenta: c, nuevos })
      if (salieron.length && debeAvisar(quien, { tipo: 'listo', cuenta: c })) listos.push({ cuenta: c, salieron })

      // «Por cobrar»: solo el cajero.
      if (c.estado === 'precuenta' && anterior !== undefined && anterior !== 'precuenta' && debeAvisar(quien, { tipo: 'porCobrar' })) {
        notificarLocal(t('pwa.tituloPorCobrar'), t('pwa.cuerpoPorCobrar', { cuenta: nombreCuenta(c, mesas) }), '#salon', {
          tag: 'precuenta-' + c.id,
          fijar: true,
        })
      }
      if (anterior === 'precuenta' && c.estado !== 'precuenta') cancelarNotificacion('precuenta-' + c.id)

      // «Cuenta cobrada»: solo a quien abrió esa cuenta.
      if (c.estado === 'cerrada' && anterior && anterior !== 'cerrada' && reciente(c.cerradaEn) && debeAvisar(quien, { tipo: 'cobrada', cuenta: c })) {
        notificarLocal(t('pwa.tituloCobrada'), t('pwa.cuerpoCobrada', { cuenta: nombreCuenta(c, mesas) }), '#salon', { tag: 'cobrada-' + c.id })
      }
    })

    if (comandas.length && comandas.length <= MAX_AVISOS) {
      comandas.forEach(({ cuenta, nuevos }) => {
        const platos = nuevos.map((i) => i.nombre + ' x' + i.qty).join(', ')
        notificarLocal(t('pwa.tituloCocina'), t('pwa.cuerpoCocina', { cuenta: nombreCuenta(cuenta, mesas), platos }), '#cocina', { tag: 'cocina-' + cuenta.id })
      })
    } else if (comandas.length) {
      const total = comandas.reduce((acc, p) => acc + p.nuevos.length, 0)
      const nombres = comandas.map((p) => nombreCuenta(p.cuenta, mesas)).join(', ')
      notificarLocal(t('pwa.tituloCocina'), t('pwa.cuerpoCocinaLote', { cuentas: comandas.length, items: total, nombres }), '#cocina', { tag: 'cocina-lote' })
    }

    if (listos.length && listos.length <= MAX_AVISOS) {
      listos.forEach(({ cuenta, salieron }) => {
        const platos = salieron.map((i) => i.nombre + ' x' + i.qty).join(', ')
        notificarLocal(t('pwa.tituloListo'), t('pwa.cuerpoListo', { cuenta: nombreCuenta(cuenta, mesas), platos }), '#salon', { tag: 'listo-' + cuenta.id, renotify: true })
      })
    } else if (listos.length) {
      const nombres = listos.map((p) => nombreCuenta(p.cuenta, mesas)).join(', ')
      notificarLocal(t('pwa.tituloListo'), t('pwa.cuerpoListoLote', { cuentas: listos.length, nombres }), '#salon', { tag: 'listo-lote' })
    }
  }, [s.cuentas, s.mesas, s._supCargando, empresaId, rol, t])

  return null
}
