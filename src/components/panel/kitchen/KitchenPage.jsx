import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import { rpc, mensajeError, sb, obtenerEmpresaActiva } from '../../../services/supabaseClient.js'
import { useStore } from '../../../context/StoreContext.jsx'
import { gruposDeComanda, repartirPorGrupo, SIN_AREA, GRUPO_DIRECTA } from '../../../services/printing.js'
import { pendientesPorGrupo, mostradorPendientes, badgeDirecta, aplicarOptimistas } from '../../../services/despacho.js'
import Aviso from '../../ui/Aviso.jsx'
import './KitchenPage.css'
import { hora } from '../../../services/format.js'

// Con el tiempo real conectado, el sondeo es solo una red de seguridad (cada minuto); sin él, cada 5 s.
// Con la pantalla oculta no se pide nada. Antes: cada 4 s siempre (unas 20 000 peticiones al día).
const SONDEO_MS = 5000
const SONDEO_SEGURO_MS = 60000
const AMARILLO_MIN = 5
const URGENTE_MIN = 10
const PERMITIDOS = ['cocina', 'barra', 'admin', 'cajero', 'mesero']
const LLAVE_VISTA = 'pos-cocina-vista'
const BRECHA_LOTE_MS = 1500
const EN_COLA = ['enviado', 'listo', 'anulacion']

const ms = ts => { const n = typeof ts === 'number' ? ts : Date.parse(ts); return Number.isFinite(n) ? n : null }

function cronometro(desde, ahora) {
  if (!desde) return '--:--'
  const s = Math.max(0, Math.floor((ahora - desde) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const MOTIVOS = [
  { clave: 'cocina.mot.noSalio', txt: 'No salió' },
  { clave: 'cocina.mot.cambio', txt: 'Cambio del cliente' },
  { clave: 'cocina.mot.error', txt: 'Error al pedir' },
  { clave: 'cocina.mot.otro', txt: 'Otro' },
]

// Un envío agrupa varias ítems en la misma comanda: lo que se envió junto, se cocina junto.
function lotes(items) {
  const out = []
  items.forEach(i => {
    const ultimo = out[out.length - 1]
    const en = i.enviadoEn || 0
    if (ultimo && en - ultimo.desde <= BRECHA_LOTE_MS) ultimo.items.push(i)
    else out.push({ desde: en, items: [i] })
  })
  return out
}

// Un envío = una tanda de la comanda. Si a una mesa que ya está en cocina se le agrega pedido, los platos
// nuevos entran en la MISMA comanda pero como una tanda aparte («Adición n») con su propio cronómetro,
// para que Despacho no confunda lo nuevo con lo que lleva rato en preparación. El orden dentro de la
// comanda es fijo (hora de envío y, en empate, el orden en que se vieron por primera vez): un plato que
// sale NO cambia de sitio.
function agruparTandas(items, orden) {
  const lista = [...(items || [])].sort((x, y) =>
    (ms(x.enviada_en) || 0) - (ms(y.enviada_en) || 0) || (orden.get(x.id) ?? 1e9) - (orden.get(y.id) ?? 1e9))
  const out = []
  lista.forEach(i => {
    const en = ms(i.enviada_en) || 0
    const ultima = out[out.length - 1]
    if (ultima && en - ultima.desde <= BRECHA_LOTE_MS) ultima.items.push(i)
    else out.push({ desde: en, items: [i] })
  })
  return out
}

// En demo la cola no viene del servidor: se arma con las cuentas abiertas del negocio local,
// proyectando cada ítem al área que se está mirando (igual que hace el servidor).
function colaDemo(s, area) {
  const filas = []
  ;(s.cuentas || []).filter(c => c.estado !== 'cerrada').forEach(c => {
    const delArea = repartirPorGrupo(c.items.filter(i => EN_COLA.includes(i.estado)), s.productos, s.config).find(x => x.grupo.id === area)
    if (!delArea) return
    const ids = new Set(delArea.items.map(i => i.id))
    lotes(c.items.filter(i => ids.has(i.id)).sort((x, y) => (x.enviadoEn || 0) - (y.enviadoEn || 0))).forEach(l => filas.push({
      ...c,
      area,
      cuenta_id: c.id,
      mesa: (c.mesaIds || []).map(id => (s.mesas || []).find(m => m.id === id)?.nombre).filter(Boolean).join(', '),
      enviada_en: l.desde || null,
      lote: l.desde,
      items: l.items.map(i => ({
        id: i.id,
        nombre: i.nombre,
        qty: i.qty,
        nota: i.nota || '',
        estado: i.estado === 'anulacion' ? 'anulacion' : (i.estado === 'listo' || (i.areasListas || []).includes(area) ? 'listo' : 'enviado'),
        areas: i.areas || [],
        enviada_en: i.enviadoEn || null,
        listo_en: (i.areasEn || {})[area] ?? (i.estado === 'listo' ? i.listoEn : null),
        anulacion_motivo: i.motivo || '',
      })),
    }))
  })
  return filas.sort((x, y) => (x.enviada_en || 0) - (y.enviada_en || 0))
}

// En demo una mesa puede tener varias comandas abiertas (un envío = una comanda).
const claveComanda = c => c.area + ':' + c.cuenta_id + ':' + (c.lote || '')

function devsDemo(s, area) {
  if (!area) return []
  return (s.devoluciones || []).filter(x => x.area === area && !x.confirmadaEn).map(x => ({
    id: x.id, nombre: x.nombre, qty: x.qty, mesa: x.mesa, motivo: x.motivo, pedida_en: x.pedidaEn, pedida_por: x.pedidaPor || '',
  }))
}

export default function KitchenPage({ rol, sesion }) {
  const { t, tOr } = useIdioma()
  const conectado = Boolean(sesion?.supabase)
  const permitido = PERMITIDOS.includes(rol)
  const puedeAutorizar = rol === 'admin' || rol === 'cajero'
  const empresaId = sesion?.empresaId || obtenerEmpresaActiva() || null
  const { s, d } = useStore()
  const usuario = sesion?.nombre || sesion?.usuario || rol

  const grupos = useMemo(() => gruposDeComanda(s.config), [s.config])
  const [misAreas, setMisAreas] = useState([])
  const restringido = (rol === 'cocina' || rol === 'barra') && misAreas.length > 0
  const idsGrupos = useMemo(() => grupos.map(g => g.id), [grupos])
  const idsVisibles = useMemo(() => (restringido ? idsGrupos.filter(id => misAreas.includes(id)) : idsGrupos), [idsGrupos, misAreas, restringido])
  useEffect(() => {
    if (!conectado || !(rol === 'cocina' || rol === 'barra')) return undefined
    let vivo = true
    rpc('mis_areas', {}).then(r => { if (vivo) setMisAreas(Array.isArray(r) ? r : []) }).catch(() => {})
    return () => { vivo = false }
  }, [conectado, rol])

  const [vista, setVista] = useState(() => {
    const ids = gruposDeComanda(s.config).map(g => g.id)
    if (rol === 'cocina' || rol === 'barra') return ids.includes(rol) ? rol : (ids[0] || 'cocina')
    try { const v = localStorage.getItem(LLAVE_VISTA); if (v === SIN_AREA || ids.includes(v)) return v } catch {  }
    return ids[0] || 'cocina'
  })
  const cambiarVista = v => { setVista(v); setSacadasAbierto(false); try { localStorage.setItem(LLAVE_VISTA, v) } catch {  } }

  // "Sin área" solo existe cuando el servidor devuelve ítems de un área borrada; en demo las áreas salen del config local.
  const verSinArea = !restringido && conectado
  const areasMostradas = useMemo(() => [vista], [vista])
  const areasVisibles = useMemo(() => (verSinArea && vista !== SIN_AREA ? [vista, SIN_AREA] : [vista]), [vista, verSinArea])

  useEffect(() => {
    if (vista === SIN_AREA && verSinArea) return
    if (idsVisibles.length && !idsVisibles.includes(vista)) cambiarVista(idsVisibles[0])
  }, [idsVisibles, vista, verSinArea])

  const [colas, setColas] = useState({})
  const [cargando, setCargando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())
  const [ultimo, setUltimo] = useState(0)
  const [realtime, setRealtime] = useState(false)
  const [recien, setRecien] = useState({})
  const [ocupado, setOcupado] = useState('')
  const [anulando, setAnulando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [sacadasAbierto, setSacadasAbierto] = useState(false)
  const [totalAbierto, setTotalAbierto] = useState(false)
  const [devs, setDevs] = useState([])
  const [notasDev, setNotasDev] = useState({})

  const vistosRef = useRef({})
  const cargandoRef = useRef(false)
  const colasRef = useRef({})
  const cargarRef = useRef(null)
  const areasRef = useRef(areasVisibles)
  areasRef.current = areasVisibles
  const sRef = useRef(s)
  sRef.current = s
  // Marcar «ya salió» se pinta al instante y se confirma en segundo plano: antes cada toque esperaba al
  // servidor, a la cola y a una recarga completa de la empresa (unos 4 s). `optRef` recuerda lo que el
  // usuario ya hizo hasta que el servidor lo confirme, para que un refresco antiguo no lo desmarque.
  const optRef = useRef(new Map())
  const ordenRef = useRef(new Map())
  const enVueloRef = useRef(new Map())
  const repetirRef = useRef(false)
  const realtimeRef = useRef(false)
  const devsEnRef = useRef(0)
  realtimeRef.current = realtime
  const vistaRef = useRef(vista)
  vistaRef.current = vista

  // Un error de una acción (marcar salida, anular) se queda a la vista unos segundos: antes el siguiente
  // refresco lo borraba al instante y nadie sabía por qué «no pasaba nada».
  const avisoHastaRef = useRef(0)
  const avisar = useCallback(msg => { if (msg) avisoHastaRef.current = Date.now() + 10000; setAviso(msg || '') }, [])

  const conOptimistas = (lista, area) => aplicarOptimistas(lista, area, optRef.current)
  const repintar = () => {
    const sig = { ...colasRef.current }
    Object.keys(sig).forEach(a => { sig[a] = conOptimistas(sig[a], a) })
    colasRef.current = sig
    setColas(sig)
  }
  // Con el tiempo real conectado la pantalla y los contadores se ponen al día solos; sin él, se pide.
  const reanudar = () => { if (!realtimeRef.current) window.dispatchEvent(new Event('pos-reanudar')) }

  const cargar = useCallback(async () => {
    if (cargandoRef.current) { repetirRef.current = true; return }
    cargandoRef.current = true
    setCargando(true)
    try {
      const areas = areasRef.current
      const crudo = conectado
        ? await Promise.all(areas.map(a => rpc('cola_de_area', a === SIN_AREA ? { p_area: a, p_validas: idsGrupos } : { p_area: a }).then(fila => [a, Array.isArray(fila) ? fila : []])))
        : areas.map(a => [a, colaDemo(sRef.current, a)])
      // «Venta directa» además recibe lo cobrado en el mostrador: la cuenta ya está cerrada y el
      // servidor no la devuelve, pero el producto falta entregarlo. Sin duplicar lo que ya traiga.
      const mostrador = mostradorPendientes(sRef.current.cuentas)
      const res = crudo.map(([a, lista]) => {
        if (a !== GRUPO_DIRECTA || !mostrador.length) return [a, lista]
        const ya = new Set(lista.flatMap(c => (c.items || []).map(i => i.id)))
        return [a, [...lista, ...mostrador.map(f => ({ ...f, items: f.items.filter(i => !ya.has(i.id)) })).filter(f => f.items.length)]]
      })
      const nuevoRecien = {}
      const sig = { ...colasRef.current }
      res.forEach(([a, lista0]) => {
        lista0.forEach(c => (c.items || []).forEach(it => { if (!ordenRef.current.has(it.id)) ordenRef.current.set(it.id, ordenRef.current.size) }))
        const lista = conOptimistas(lista0, a)
        sig[a] = lista
        const enviados = new Set()
        lista.forEach(c => (c.items || []).forEach(it => { if (it.estado === 'enviado') enviados.add(it.id) }))
        const antes = vistosRef.current[a]
        if (antes) lista.forEach(c => { if ((c.items || []).some(it => it.estado === 'enviado' && !antes.has(it.id))) nuevoRecien[claveComanda({ ...c, area: a })] = Date.now() })
        vistosRef.current[a] = enviados
      })
      colasRef.current = sig
      setColas(sig)

      const real = areas.find(x => x !== SIN_AREA)
      if (!conectado) setDevs(devsDemo(sRef.current, real))
      else if (real) {
        // Las devoluciones cambian poco: con el tiempo real conectado se piden como mucho cada 30 s.
        if (!realtimeRef.current || Date.now() - devsEnRef.current > 30000) {
          devsEnRef.current = Date.now()
          rpc('devoluciones_de_area', { p_area: real }).then(r => setDevs(Array.isArray(r) ? r : [])).catch(() => {})
        }
      }
      else setDevs([])
      if (Object.keys(nuevoRecien).length) setRecien(r => ({ ...r, ...nuevoRecien }))
      setAhora(Date.now())
      setUltimo(Date.now())
      if (Date.now() > avisoHastaRef.current) setAviso('')
    } catch (e) {
      avisar(mensajeError(e))
    } finally {
      cargandoRef.current = false
      setCargando(false)
      if (repetirRef.current) { repetirRef.current = false; cargarRef.current?.() }
    }
  }, [conectado, avisar, idsGrupos])
  cargarRef.current = cargar

  useEffect(() => {
    if (!permitido) return undefined
    areasVisibles.forEach(a => { vistosRef.current[a] = null })
    cargarRef.current?.()
    if (!conectado) return undefined
    const poll = setInterval(() => { if (!document.hidden) cargarRef.current?.() }, realtime ? SONDEO_SEGURO_MS : SONDEO_MS)
    const alVolver = () => { if (!document.hidden) cargarRef.current?.() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', alVolver) }
  }, [conectado, permitido, areasVisibles, realtime])

  useEffect(() => {
    if (conectado || !permitido) return
    cargarRef.current?.()
  }, [s, conectado, permitido, areasVisibles, idsGrupos])

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!conectado || !permitido || !sb || !empresaId) { setRealtime(false); return undefined }
    let canal = null
    try {
      canal = sb.channel('cocina-' + empresaId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cuenta_items', filter: `empresa_id=eq.${empresaId}` }, () => cargarRef.current?.())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cuenta_item_areas', filter: `empresa_id=eq.${empresaId}` }, () => cargarRef.current?.())
        .subscribe(st => setRealtime(st === 'SUBSCRIBED'))
    } catch { setRealtime(false) }
    return () => { setRealtime(false); try { if (canal) sb.removeChannel(canal) } catch {  } }
  }, [conectado, permitido, empresaId])

  const accion = async (item, fn) => {
    if (ocupado) return
    setOcupado(item.id)
    try {
      await fn()
      await cargarRef.current?.()
      reanudar()
    } catch (e) { avisar(mensajeError(e)) } finally { setOcupado('') }
  }

  const confirmarDev = async dv => {
    if (ocupado) return
    setOcupado(dv.id)
    const nota = (notasDev[dv.id] || '').trim()
    try {
      if (conectado) await rpc('confirmar_devolucion', { p_id: dv.id, p_nota: nota || null })
      else d({ t: 'devolver~', id: dv.id, nota, usuario })
      setNotasDev(n => { const { [dv.id]: _x, ...resto } = n; return resto })
      await cargarRef.current?.()
      reanudar()
    } catch (e) { avisar(mensajeError(e)) } finally { setOcupado('') }
  }
  // Sale/vuelve un plato: se ve ya en pantalla y el servidor lo confirma detrás. Si falla, se deshace solo.
  const cambiarSalida = (item, c, listo) => {
    if (!conectado) {
      d({ t: listo ? 'cocina-salida' : 'cocina-deshacer', cuentaId: c.cuenta_id, itemId: item.id, area: vistaRef.current })
      return
    }
    const area = vistaRef.current
    const clave = area + ':' + item.id
    optRef.current.set(clave, { listo, en: Date.now(), hasta: Date.now() + 8000 })
    repintar()
    const previa = enVueloRef.current.get(clave) || Promise.resolve()
    const p = previa
      .then(() => rpc(listo ? 'marcar_salida' : 'deshacer_salida', { p_item_ids: [item.id], p_area: area === SIN_AREA ? null : area }))
      .then(() => { reanudar() })
      .catch(e => { optRef.current.delete(clave); avisar(mensajeError(e)) })
      .finally(() => { if (enVueloRef.current.get(clave) === p) enVueloRef.current.delete(clave); cargarRef.current?.() })
    enVueloRef.current.set(clave, p)
  }
  const marcarSalio = (item, c) => cambiarSalida(item, c, true)
  const deshacer = (item, c) => cambiarSalida(item, c, false)
  const abrirAnular = (item, c) => {
    // Lo vendido en el mostrador ya está cobrado: el servidor no deja anular una cuenta cerrada.
    if (c.canal === 'mostrador') { avisar(tOr('cocina.mostradorCobrado', 'Esa venta ya está cobrada. Para anularla registra una devolución en Caja.')); return }
    setAnulando({ id: item.id, cuentaId: c.cuenta_id, nombre: item.nombre }); setMotivo('')
  }
  const cerrarAnular = () => { setAnulando(null); setMotivo('') }
  const pedirAnulacion = () => {
    const item = anulando
    const txt = motivo.trim()
    if (!item || !txt || ocupado) return
    setOcupado(item.id)
    cerrarAnular()
    if (!conectado) {
      try {
        d({ t: 'cocina-anular', cuentaId: item.cuentaId, itemId: item.id, motivo: txt, usuario })
        cargarRef.current?.()
      } catch (e) { avisar(mensajeError(e)) } finally { setOcupado('') }
      return
    }
    rpc('pedir_anulacion', { p_item_id: item.id, p_motivo: txt })
      .then(() => { cargarRef.current?.(); reanudar() })
      .catch(e => avisar(mensajeError(e)))
      .finally(() => setOcupado(''))
  }
  const resolver = (item, c, aprobar) => accion(item, () => conectado
    ? rpc('resolver_anulacion', { p_item_id: item.id, p_aprobar: aprobar, p_motivo: null })
    : d({ t: 'cocina-resolver', cuentaId: c.cuenta_id, itemId: item.id, aprobar, usuario }))

  const filas = useMemo(() => {
    const out = {}
    areasMostradas.forEach(a => {
      const enCurso = [], sacadas = []
      ;(colas[a] || []).forEach(c => {
        const items = c.items || []
        const pend = items.filter(i => i.estado !== 'listo')
        if (pend.length) {
          const tiempos = pend.map(i => ms(i.enviada_en)).filter(Boolean)
          enCurso.push({ ...c, area: a, desde: tiempos.length ? Math.min(...tiempos) : ms(c.enviada_en) })
        } else if (items.length) {
          const salidas = items.map(i => ms(i.listo_en)).filter(Boolean)
          sacadas.push({ ...c, area: a, salioEn: salidas.length ? Math.max(...salidas) : null })
        }
      })
      enCurso.sort((x, y) => (x.desde || 0) - (y.desde || 0))
      sacadas.sort((x, y) => (y.salioEn || 0) - (x.salioEn || 0))
      out[a] = { enCurso, sacadas }
    })
    return out
  }, [colas, areasMostradas])
  const totalSacadas = areasMostradas.reduce((n, a) => n + (filas[a]?.sacadas.length || 0), 0)

  // «Total»: lo que falta sacar sumado entre TODAS las comandas, por producto y separado por indicación
  // (término, salsa…). Con el salón lleno no caben todas las comandas en pantalla: esto da la cuenta de un vistazo.
  const totales = useMemo(() => {
    const por = new Map()
    let unidades = 0
    areasMostradas.forEach(a => (filas[a]?.enCurso || []).forEach(c => (c.items || []).forEach(it => {
      if (it.estado !== 'enviado') return
      const q = Number(it.qty) || 1
      const nombre = String(it.nombre || '').trim()
      const e = por.get(nombre) || { nombre, qty: 0, notas: new Map() }
      const nota = String(it.nota || '').trim()
      e.qty += q
      e.notas.set(nota, (e.notas.get(nota) || 0) + q)
      por.set(nombre, e)
      unidades += q
    })))
    const lista = [...por.values()].sort((x, y) => y.qty - x.qty || x.nombre.localeCompare(y.nombre))
    return { lista, unidades }
  }, [filas, areasMostradas])
  const hayComandas = areasMostradas.some(a => (filas[a]?.enCurso || []).length > 0)

  // Cuántos ítems quedan por sacar en cada área: el contador rojo del botón, como en las
  // notificaciones de una app. Se lee del store, no de la cola, para poder contar los otros.
  const pendientes = useMemo(() => pendientesPorGrupo(s.cuentas, s.productos, s.config), [s.cuentas, s.productos, s.config])
  const porEntregar = useMemo(() => badgeDirecta(s.cuentas, s.productos, s.config), [s.cuentas, s.productos, s.config])

  if (!permitido) return <div className="cocina adm-panel"><Aviso icono="🔒">{tOr('cocina.sinPermiso', 'Esta pantalla no está habilitada para tu rol.')}</Aviso></div>

  const nombreArea = a => (a === SIN_AREA ? tOr('cocina.sinArea', 'Sin área') : (grupos.find(g => g.id === a)?.nombre || tOr('cocina.area.' + a, a)))
  const icono = a => (a === SIN_AREA ? '⚠️' : a === 'cocina' ? '🍳' : a === 'barra' ? '🍹' : a === GRUPO_DIRECTA ? '🛒' : '🍽️')
  const tabs = [...idsVisibles, ...(verSinArea && ((colas[SIN_AREA] || []).length > 0 || vista === SIN_AREA) ? [SIN_AREA] : [])]
  const badge = v => (v === GRUPO_DIRECTA ? porEntregar : pendientes[v] || 0)
  const nivel = desde => {
    if (!desde) return ''
    const min = (ahora - desde) / 60000
    return min >= URGENTE_MIN ? ' rojo' : min >= AMARILLO_MIN ? ' ambar' : ''
  }
  const tituloMesa = c => `${c.mesa || tOr('cocina.mostrador', 'Mostrador')}${c.etiqueta || ''}`
  // Los cuatro datos que se leen en la comanda, en texto plano y sin distintivos de color:
  // salón (o canal, si no es mesa), mesa, quién envió y la hora. Igual que en el papel.
  const datosCuenta = c => {
    const enStore = (s.cuentas || []).find(x => x.id === c.cuenta_id)
    const ids = enStore?.mesaIds || []
    // Lo que trae la cola del servidor manda: un equipo de Despacho quieto no tiene las cuentas nuevas en su store local.
    const canal = c.canal === 'llevar' ? 'llevar' : (enStore?.canal || c.canal || (c.mesa ? '' : 'mostrador'))
    const zonaId = (s.mesas || []).find(x => ids.includes(x.id))?.zona
    const salon = canal === 'llevar' ? t('cocina.canalLlevar')
      : canal === 'mostrador' ? t('cocina.canalMostrador')
        : ((s.zonas || []).find(z => z.id === zonaId)?.nombre || '')
    return { canal, salon, mesero: c.mesero || enStore?.abiertaPor || c.abiertaPor || '' }
  }

  const renderItem = (it, c) => {
    const area = c.area
    const listo = it.estado === 'listo'
    const anulacion = it.estado === 'anulacion'
    const otras = (it.areas || []).filter(x => x !== area)
    return (
      <li key={it.id} className={'ck-item' + (listo ? ' listo' : '') + (anulacion ? ' anul' : '')}>
        <div className="ck-item-fila">
          <span className="ck-qty">{it.qty}</span>
          <div className="ck-item-cuerpo">
            <b className="ck-nombre">{it.nombre}</b>
            {otras.length > 0 && <span className="ck-combo" title={tOr('areas.title', 'Áreas donde se imprime este artículo')}>+ {otras.map(nombreArea).join(', ')}</span>}
            {it.nota && <div className="ck-nota">📝 {it.nota}</div>}
            {listo && it.listo_en && <small className="ck-listo-hora">✓ {tOr('cocina.salio', 'Salió')} {hora(it.listo_en)}</small>}
          </div>
          <div className="ck-item-acc">
            {!anulacion && !listo && (
              <button type="button" className="ck-check" onClick={() => marcarSalio(it, c)}
                title={tOr('cocina.yaSalio', 'Ya salió')} aria-label={`${tOr('cocina.yaSalio', 'Ya salió')}: ${it.nombre}`}>✓</button>
            )}
            {listo && (
              <button type="button" className="ck-mini ghost" onClick={() => deshacer(it, c)}
                title={tOr('cocina.deshacer', 'Deshacer')} aria-label={`${tOr('cocina.deshacer', 'Deshacer')}: ${it.nombre}`}>↩</button>
            )}
            {!anulacion && !listo && (
              <button type="button" className="ck-mini danger" disabled={ocupado === it.id} onClick={() => abrirAnular(it, c)}
                title={tOr('cocina.anular', 'Anular')} aria-label={`${tOr('cocina.anular', 'Anular')}: ${it.nombre}`}>⊘</button>
            )}
          </div>
        </div>

        {anulacion && (
          <div className="ck-anul-block">
            <b>⛔ {tOr('cocina.quiereAnular', 'Quiere anular')}: {it.anulacion_motivo || tOr('cocina.sinMotivo', 'sin motivo')}</b>
            {puedeAutorizar ? (
              <div className="ck-anul-acc">
                <button type="button" className="cocina-btn success" disabled={ocupado === it.id} onClick={() => resolver(it, c, true)}>✓ {tOr('cocina.aprobar', 'Aprobar')}</button>
                <button type="button" className="cocina-btn danger" disabled={ocupado === it.id} onClick={() => resolver(it, c, false)}>✕ {tOr('cocina.rechazar', 'Rechazar')}</button>
              </div>
            ) : <small className="ck-espera">⏳ {tOr('cocina.esperandoCaja', 'Esperando autorización de caja')}</small>}
          </div>
        )}

        {anulando?.id === it.id && (
          <div className="ck-anul-panel" role="group" aria-label={tOr('cocina.anular', 'Anular')}>
            <b>{tOr('cocina.motivoTitulo', 'Motivo de anulación')} · {it.nombre}</b>
            <div className="ck-motivos">
              {MOTIVOS.map(m => (
                <button key={m.clave} type="button" className={'ck-motivo' + (motivo === tOr(m.clave, m.txt) ? ' on' : '')} onClick={() => setMotivo(tOr(m.clave, m.txt))}>{tOr(m.clave, m.txt)}</button>
              ))}
            </div>
            <input name="motivo" autoFocus className="ck-motivo-txt" maxLength={120} value={motivo} placeholder={tOr('cocina.motivoPlace', 'Escribe o elige un motivo…')}
              onChange={e => setMotivo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') pedirAnulacion(); if (e.key === 'Escape') cerrarAnular() }} />
            <div className="ck-anul-acc">
              <button type="button" className="cocina-btn danger" disabled={!motivo.trim() || ocupado === it.id} onClick={pedirAnulacion}>{tOr('cocina.pedirAnulacion', 'Pedir anulación')}</button>
              <button type="button" className="cocina-btn ghost" onClick={cerrarAnular}>{tOr('comun.cancelar', 'Cancelar')}</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const renderComanda = c => {
    const clave = claveComanda(c)
    const pendientes = (c.items || []).filter(i => i.estado === 'enviado').length
    const nueva = recien[clave] && ahora - recien[clave] < 8000
    const { salon, mesero } = datosCuenta(c)
    const tandas = agruparTandas(c.items, ordenRef.current)
    const cuando = c.desde || ms(c.enviada_en)
    // Encabezado de la comanda: «Salón: x  Mesa: x  Enviado por: x». En mostrador / para llevar no hay mesa:
    // el canal ya sale como salón y no se repite como «Mesa: Mostrador».
    const campos = [
      [tOr('cocina.lblSalon', 'Salón'), salon],
      [tOr('cocina.lblMesa', 'Mesa'), c.mesa ? tituloMesa(c) : ''],
      [tOr('cocina.lblEnviadoPor', 'Enviado por'), mesero],
    ].filter(([, v]) => v)
    return (
      <article key={clave} className={'ck-card' + nivel(c.desde) + (nueva ? ' nueva' : '')}>
        <header className="ck-cab">
          <div className="ck-linea">
            {campos.map(([k, v]) => <span key={k} className="ck-campo"><small>{k}:</small> <b>{v}</b></span>)}
          </div>
          {Number(c.comensales) > 0 && <span className="ck-tag" title={tOr('cocina.comensales', 'Comensales')}>👥 {c.comensales}</span>}
          <span className="ck-sp" />
          <span className={'ck-timer' + nivel(c.desde)} title={cuando ? `${tOr('cocina.entro', 'Entró a las')} ${hora(cuando)}` : ''}>⏱ {cronometro(c.desde, ahora)}</span>
        </header>
        <div className="ck-meta">
          {pendientes > 0 ? <span className="ck-tag pend">{tOr('cocina.porSalir', `Por salir: ${pendientes}`, { n: pendientes })}</span> : <span />}
          {cuando > 0 && <span className="ck-hora"><small>{tOr('cocina.lblHora', 'Hora')}:</small> <b>{hora(cuando)}</b></span>}
        </div>
        {tandas.map((tn, ix) => {
          const pend = tn.items.filter(i => i.estado !== 'listo')
          const tiempos = pend.map(i => ms(i.enviada_en)).filter(Boolean)
          const desdeT = tiempos.length ? Math.min(...tiempos) : null
          return (
            <section key={ix} className="ck-tanda">
              {tandas.length > 1 && (
                <div className={'ck-tanda-cab' + (pend.length ? nivel(desdeT) : ' hecha')}>
                  <b>{ix === 0 ? tOr('cocina.pedidoInicial', 'Pedido inicial') : `➕ ${tOr('cocina.adicion', `Adición ${ix}`, { n: ix })}`}</b>
                  {tn.desde > 0 && <small>{hora(tn.desde)}</small>}
                  <span className="ck-sp" />
                  {pend.length > 0
                    ? <span className={'ck-timer mini' + nivel(desdeT)}>⏱ {cronometro(desdeT, ahora)}</span>
                    : <small className="ck-tanda-ok">✓ {tOr('cocina.tandaCompleta', 'Completa')}</small>}
                </div>
              )}
              <ul className="ck-items">{tn.items.map(it => renderItem(it, c))}</ul>
            </section>
          )
        })}
      </article>
    )
  }

  return (
    <div className="cocina ck">
      <div className="ck-barra">
        <div className="ck-tabs" role="tablist" aria-label={tOr('cocina.areas', 'Áreas')}>
          {tabs.map(v => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} className={'ck-tab' + (vista === v ? ' on' : '')} onClick={() => cambiarVista(v)}
              aria-label={`${t('cocina.vistaDe', { area: nombreArea(v) })}${badge(v) ? ` · ${badge(v)}` : ''}`}>
              {icono(v)} {t('cocina.vistaDe', { area: nombreArea(v) })}
              {badge(v) > 0 && <span className="ck-n" aria-hidden="true">{badge(v) > 99 ? '99+' : badge(v)}</span>}
            </button>
          ))}
        </div>
        <span className="ck-sp" />
        <button type="button" className={'ck-sacadas ck-total-btn' + (totalAbierto ? ' on' : '')} aria-expanded={totalAbierto} onClick={() => setTotalAbierto(v => !v)}
          title={tOr('cocina.totalAyuda', 'Lo que falta sacar, sumado entre todas las comandas y separado por indicación (término, salsa…).')}>
          Σ {tOr('cocina.total', 'Total')}{totales.unidades > 0 && <em>{totales.unidades}</em>}
        </button>
        <button type="button" className={'ck-sacadas' + (sacadasAbierto ? ' on' : '')} aria-expanded={sacadasAbierto} onClick={() => setSacadasAbierto(v => !v)}
          title={tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}>
          ✓ {tOr('cocina.sacadas', 'Sacadas')}{totalSacadas > 0 && <em>{totalSacadas}</em>}
        </button>
        {conectado
          ? <span className={'ck-conexion' + (realtime ? ' rt' : '')} title={tOr('cocina.conexionTitle', 'Actualización automática cada 4 segundos')}>{realtime ? '🟢' : '🔄'}</span>
          : <span className="ck-demo" title={tOr('cocina.demoTitulo', 'La cola se arma con los pedidos guardados en este equipo')}>{tOr('cocina.demo', 'Demo')}</span>}
        <button type="button" className="ck-act ghost" onClick={() => cargarRef.current?.()} disabled={cargando} aria-label={tOr('cocina.actualizar', 'Actualizar')} title={tOr('cocina.actualizar', 'Actualizar')}>
          <span className={'cocina-flecha' + (cargando ? ' spin' : '')} aria-hidden="true">↻</span>
        </button>
      </div>

      {tabs.length > 1 && !hayComandas && <p className="ck-ayuda">{tOr('cocina.areasAyuda', 'Cada pestaña es un área con su impresora (se crean en Configuración → Impresión).')}</p>}

      {aviso && (
        <div className="auth-aviso cocina-aviso" role="alert">
          <span>⚠️ {aviso}</span>
          <button type="button" className="ico" onClick={() => setAviso('')} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button>
        </div>
      )}

      {totalAbierto && (
        <section className="ck-panel-total" aria-label={tOr('cocina.totalTitulo', 'Total por producto')}>
          <header>
            <b>Σ {tOr('cocina.totalTitulo', 'Total por producto')}</b>
            <span className="ck-total-n">{tOr('cocina.totalUnidades', `${totales.unidades} por sacar`, { n: totales.unidades })}</span>
            <span className="ck-sp" />
            <button type="button" className="ico" onClick={() => setTotalAbierto(false)} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button>
          </header>
          {totales.lista.length === 0 ? <p className="ck-vacio-mini">{tOr('cocina.totalVacio', 'No hay nada pendiente por sumar.')}</p> : (
            <ul className="ck-total-grid">
              {totales.lista.map(p => {
                const desglose = [...p.notas.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
                const conDetalle = desglose.length > 1 || desglose[0][0] !== ''
                return (
                  <li key={p.nombre} className="ck-total-p">
                    <div className="ck-total-top"><span className="ck-total-qty">{p.qty}</span><b className="ck-total-nombre">{p.nombre}</b></div>
                    {conDetalle && (
                      <ul className="ck-total-notas">
                        {desglose.map(([nota, q]) => <li key={nota || '_'}><b>{q}</b> {nota || tOr('cocina.sinIndicacion', 'Sin indicación')}</li>)}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {sacadasAbierto && (
        <section className="ck-panel-sacadas" aria-label={tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}>
          <header><b>✓ {tOr('cocina.sacadasTitulo', 'Comandas que ya salieron completas')}</b>
            <button type="button" className="ico" onClick={() => setSacadasAbierto(false)} aria-label={tOr('comun.cerrar', 'Cerrar')}>✕</button></header>
          <p className="ck-ayuda">{tOr('cocina.sacadasAyuda', 'Comandas que ya salieron completas; con ↩ un plato vuelve a preparación.')}</p>
          {totalSacadas === 0 && <p className="ck-vacio-mini">{tOr('cocina.sinSacadas', 'Todavía no hay comandas sacadas.')}</p>}
          {areasMostradas.map(a => (filas[a]?.sacadas.length ? (
            <div key={a} className="ck-sac-grupo">
              {areasMostradas.length > 1 && <h4>{icono(a)} {nombreArea(a)}</h4>}
              <ul>
                {filas[a].sacadas.map(c => (
                  <li key={claveComanda(c)} className="ck-sac">
                    <div className="ck-sac-cab"><b>{tituloMesa(c)}</b><small>{c.salioEn ? `${tOr('cocina.salio', 'Salió')} ${hora(c.salioEn)}` : ''}</small></div>
                    <ul>
                      {(c.items || []).map(it => (
                        <li key={it.id}><span>{it.qty}× {it.nombre}{it.nota ? ` · ${it.nota}` : ''}</span>
                          <button type="button" className="ck-mini ghost" onClick={() => deshacer(it, c)} title={tOr('cocina.deshacer', 'Deshacer')} aria-label={`${tOr('cocina.deshacer', 'Deshacer')}: ${it.nombre}`}>↩</button></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null))}
        </section>
      )}

      {vista !== SIN_AREA && devs.length > 0 && (
        <div className="ck-devs" role="region" aria-label={tOr('cocina.devueltos', 'Platos devueltos')}>
          <p className="ck-ayuda">{tOr('cocina.devueltoAyuda', 'Platos devueltos después de servidos: confírmalos aquí para que descuenten en Caja.')}</p>
          {devs.map(dv => (
            <div key={dv.id} className="ck-dev">
              <b>↩ {tOr('cocina.devuelto', 'Devuelto')}: {dv.qty}× {dv.nombre}</b>
              <span className="ck-dev-sub">{dv.mesa} · {tOr('cocina.devMotivo', 'motivo')}: {dv.motivo}{dv.pedida_por ? ` · ${dv.pedida_por}` : ''} · {hora(dv.pedida_en)}</span>
              <input name="dev-nota" type="text" maxLength={300} value={notasDev[dv.id] || ''} placeholder={tOr('cocina.devNota', 'Comentario (opcional)')}
                onChange={e => setNotasDev(n => ({ ...n, [dv.id]: e.target.value }))} />
              <button type="button" className="success" disabled={ocupado === dv.id} onClick={() => confirmarDev(dv)}>
                {tOr('cocina.devConfirmar', 'Conversado / Confirmado')}
              </button>
            </div>
          ))}
        </div>
      )}
      {vista === SIN_AREA && <Aviso icono="⚠️">{tOr('cocina.sinAreaAviso', 'Estos ítems fueron enviados a un área que ya no existe. Márcalos cuando salgan.')}</Aviso>}
      <div className={'ck-filas' + (areasMostradas.length > 1 ? ' dos' : '')}>
        {areasMostradas.map(a => {
          const { enCurso } = filas[a] || { enCurso: [] }
          return (
            <section key={a} className={'ck-fila area-' + a} aria-label={nombreArea(a)}>
              <header className="ck-fila-cab">
                <h3>{icono(a)} {nombreArea(a)}</h3>
                <span className="ck-cuenta">{enCurso.length}</span>
              </header>
              {enCurso.length === 0 ? (
                <div className="ck-vacio"><b>✅ {tOr('cocina.vacio', 'No hay pedidos por preparar')}</b>
                  <small>{ultimo ? tOr('cocina.ultimoRefresco', `Última actualización a las ${hora(ultimo)}`, { h: hora(ultimo) }) : tOr('cocina.cargando', 'Cargando…')}</small></div>
              ) : <div className="ck-grid">{enCurso.map(renderComanda)}</div>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
