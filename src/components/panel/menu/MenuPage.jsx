import { useEffect, useState } from 'react'
import { MONEDA } from '../../../services/config.js'
import { useStore, nuevoId } from '../../../context/StoreContext.jsx'
import { gruposDeComanda, grupoDeSeccion } from '../../../services/printing.js'
import { agotadosHoy, conMarca, conMarcas } from '../../../services/soldOut.js'
import { puede } from '../../../services/permissions'
import { sb } from '../../../services/supabaseClient.js'
import {
  LADO_VISUAL_PX, urlImagenProducto, procesarYGuardarImagen, quitarImagenGuardada,
} from '../../../services/imageUpload.js'
import { useIdioma } from '../../../i18n/index.jsx'
import '../../../styles/admin.css'

function Miniatura({ producto }) {
  const url = urlImagenProducto(producto)
  const inicial = ((producto.nombre || '').trim().charAt(0) || '?').toUpperCase()
  return (
    <span className="adm-thumb" style={{ width: LADO_VISUAL_PX, height: LADO_VISUAL_PX }}>
      {url
        ? <img src={url} alt={`Foto de ${producto.nombre}`} loading="lazy" />
        : <span className="adm-thumb-ini" aria-hidden="true">{inicial}</span>}
    </span>
  )
}

export default function MenuPage({ rol }) {
  const { s, d, modo } = useStore()
  const { t, tOr } = useIdioma()
  const moneda = s.config?.moneda || MONEDA
  const money = n => `${moneda} ${Number(n || 0).toFixed(2)}`

  const [nuevaSeccion, setNuevaSeccion] = useState('')
  const [nuevoGrupo, setNuevoGrupo] = useState('')
  const [renombrarId, setRenombrarId] = useState(null)
  const [nombreTmp, setNombreTmp] = useState('')
  const [grupoTmp, setGrupoTmp] = useState('')
  const [abiertas, setAbiertas] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('pos-menu-abiertas')) || []) } catch { return new Set() }
  })
  const [confSeccion, setConfSeccion] = useState(null)
  const [confProd, setConfProd] = useState(null)
  useEffect(() => { try { sessionStorage.setItem('pos-menu-abiertas', JSON.stringify([...abiertas])) } catch {  } }, [abiertas])
  const [agregarEn, setAgregarEn] = useState(null)
  const [nuevoProd, setNuevoProd] = useState({ nombre: '', precio: '', areas: ['cocina'] })
  const [editandoId, setEditandoId] = useState(null)
  const [editTmp, setEditTmp] = useState({ nombre: '', precio: '', areas: ['cocina'] })
  const [subiendoId, setSubiendoId] = useState(null)
  const [avisoImg, setAvisoImg] = useState(null)
  const [sel, setSel] = useState(() => new Set())
  const [pctTmp, setPctTmp] = useState('')
  const [fijoTmp, setFijoTmp] = useState('')
  const [seccionTmp, setSeccionTmp] = useState('')
  const [areasTmp, setAreasTmp] = useState([])
  const [motivoTmp, setMotivoTmp] = useState('')
  const [agotando, setAgotando] = useState(null)

  const esAdmin = puede(rol, 'gestionar_menu')

  if (!esAdmin) {
    return (
      <div className="adm-panel">
        <div className="adm-aviso">{t('menu.sinPermiso', { rol })}</div>
      </div>
    )
  }

  const secciones = [...s.secciones].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.nombre > b.nombre ? 1 : -1))

  const grupos = gruposDeComanda(s.config)
  const grupoActual = id => grupoDeSeccion(s.config, id)
  const areasIds = grupos.map(g => g.id)
  const asignarGrupo = (seccionId, grupoId) => {
    if (!grupoId || grupoActual(seccionId)?.id === grupoId && s.config?.impresoraPorSeccion?.[seccionId] === grupoId) return
    d({ t: 'cfg~', cambios: { impresoraPorSeccion: { ...(s.config?.impresoraPorSeccion || {}), [seccionId]: grupoId } } })
  }
  const alternar = id => setAbiertas(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const agregarSeccion = e => {
    e.preventDefault()
    const nombre = nuevaSeccion.trim()
    if (!nombre) return
    const id = nuevoId()
    d({ t: 'seccion+', seccion: { id, nombre } })
    asignarGrupo(id, nuevoGrupo || grupos[0]?.id)
    setAbiertas(a => new Set([...a, id]))
    setNuevaSeccion('')
  }

  const empezarRenombrar = sec => { setRenombrarId(sec.id); setNombreTmp(sec.nombre); setGrupoTmp(grupoActual(sec.id)?.id || '') }
  const guardarNombre = e => {
    e.preventDefault()
    const nombre = nombreTmp.trim()
    if (nombre) d({ t: 'seccion~', id: renombrarId, cambios: { nombre } })
    asignarGrupo(renombrarId, grupoTmp)
    setRenombrarId(null)
  }
  const borrarSeccion = sec => {
    d({ t: 'seccion-', id: sec.id })

    d({ t: 'cfg~', cambios: { agotados: conMarcas(s.config, s.productos.filter(p => p.seccionId === sec.id).map(p => p.id), null) } })
    setConfSeccion(null)
    setAbiertas(a => { const n = new Set(a); n.delete(sec.id); return n })
  }

  const mover = (idx, dir) => {
    const a = secciones[idx]
    const b = secciones[idx + dir]
    if (!b) return
    let oa = a.orden ?? idx + 1
    let ob = b.orden ?? idx + 2 + dir
    if (oa === ob) ob = oa + dir
    d({ t: 'seccion~', id: a.id, cambios: { orden: ob } })
    d({ t: 'seccion~', id: b.id, cambios: { orden: oa } })
  }

  const parsearOpciones = txt => [...new Set(String(txt || '').split(/[,;\n]/).map(x => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
  const campoOpciones = (valor, poner) => (
    <input className="adm-opciones" value={valor} maxLength={400} onChange={e => poner(e.target.value)}
      placeholder={t('menu.opcionesPlace')} title={t('menu.opcionesTitle')} aria-label={t('menu.opcionesTitle')} />
  )
  const empezarAgregar = secId => { setAgregarEn(secId); setNuevoProd({ nombre: '', precio: '', opciones: '', areas: [grupoActual(secId)?.id && areasIds.includes(grupoActual(secId).id) ? grupoActual(secId).id : (areasIds[0] || 'cocina')] }) }
  const agregarProducto = e => {
    e.preventDefault()
    const nombre = nuevoProd.nombre.trim()
    const precio = Number(nuevoProd.precio)
    if (!nombre || !Number.isFinite(precio) || precio < 0) return
    d({ t: 'producto+', producto: { nombre, seccionId: agregarEn, precio, areas: nuevoProd.areas, opciones: parsearOpciones(nuevoProd.opciones) } })
    setNuevoProd({ nombre: '', precio: '', opciones: '', areas: [areasIds[0] || 'cocina'] })
    setAgregarEn(null)
  }

  const areasDe = p => (Array.isArray(p.areas) && p.areas.length ? p.areas : null)
  const nombreArea = id => grupos.find(g => g.id === id)?.nombre || tOr('cocina.sinArea', 'Sin área')
  const alternarArea = (lista, setLista, id) => {
    const n = lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]
    if (!n.length) return
    setLista(n)
  }
  const checkboxesAreas = (lista, setLista) => (
    <span className="menu-areas" role="group" aria-label={tOr('areas.label', 'Imprimir en')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '.82rem' }}>
      <span aria-hidden="true">🖨</span>
      {areasIds.map(id => (
        <label key={id} className="menu-area" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title={tOr('areas.ayuda', 'Marca todos los grupos donde se imprime este artículo')}>
          <input type="checkbox" checked={lista.includes(id)} onChange={() => alternarArea(lista, setLista, id)} />
          {nombreArea(id)}
        </label>
      ))}
    </span>
  )

  const areasPorDefecto = p => {
    const base = areasDe(p) || [grupoActual(p.seccionId)?.id]
    const filtradas = base.filter(id => areasIds.includes(id))
    return filtradas.length ? filtradas : [areasIds[0] || 'cocina']
  }
  const empezarEditar = p => { setEditandoId(p.id); setEditTmp({ nombre: p.nombre, precio: String(p.precio), opciones: (p.opciones || []).join(', '), areas: areasPorDefecto(p) }) }
  const guardarProducto = e => {
    e.preventDefault()
    const nombre = editTmp.nombre.trim()
    const precio = Number(editTmp.precio)
    if (nombre && Number.isFinite(precio) && precio >= 0) {
      d({ t: 'producto~', id: editandoId, cambios: { nombre, precio, areas: editTmp.areas, opciones: parsearOpciones(editTmp.opciones) } })
    }
    setEditandoId(null)
  }

  const dispatchFoto = (p, cambios) => {
    const actual = s.productos.find(x => x.id === p.id) || p

    d({ t: 'producto~', id: p.id, cambios: { nombre: actual.nombre, precio: actual.precio, activo: actual.activo, ...cambios } })
  }

  const subirFoto = async (p, e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !esAdmin) return
    setSubiendoId(p.id); setAvisoImg(null)
    try {
      const cambios = await procesarYGuardarImagen({ sb, modo, empresaId: s._empresaId, productoId: p.id, file })
      dispatchFoto(p, cambios)
    } catch (err) {
      setAvisoImg({ id: p.id, msg: err?.message || tOr('menu.errorFoto', 'No se pudo procesar la imagen.') })
    } finally {
      setSubiendoId(null)
    }
  }

  const quitarFoto = async p => {
    if (!esAdmin) return
    setSubiendoId(p.id); setAvisoImg(null)
    try {
      const actual = s.productos.find(x => x.id === p.id) || p
      const cambios = await quitarImagenGuardada({ sb, modo, empresaId: s._empresaId, productoId: p.id, imagen_path: actual.imagen_path })
      dispatchFoto(p, cambios)
    } catch (err) {
      setAvisoImg({ id: p.id, msg: err?.message || tOr('menu.errorQuitarFoto', 'No se pudo quitar la imagen.') })
    } finally {
      setSubiendoId(null)
    }
  }

  const agotados = agotadosHoy(s.config)
  const marcarAgotado = (ids, marca) => d({ t: 'cfg~', cambios: { agotados: conMarcas(s.config, ids, marca) } })

  const redondear = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
  const idsSel = () => s.productos.filter(p => sel.has(p.id)).map(p => p.id)
  const alternarSel = id => setSel(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selSeccion = (secId, on) => setSel(a => {
    const n = new Set(a)
    s.productos.filter(p => p.seccionId === secId).forEach(p => { if (on) n.add(p.id); else n.delete(p.id) })
    return n
  })
  const aplicarASeleccion = cambios => idsSel().forEach(id => d({ t: 'producto~', id, cambios }))
  const aplicarPorcentaje = () => {
    const pct = Number(pctTmp)
    if (!Number.isFinite(pct) || pct === 0 || pct <= -100) return
    s.productos.filter(p => sel.has(p.id)).forEach(p => d({ t: 'producto~', id: p.id, cambios: { precio: redondear(Math.max(0, p.precio * (1 + pct / 100))) } }))
    setPctTmp('')
  }
  const aplicarPrecioFijo = () => {
    const v = Number(fijoTmp)
    if (!Number.isFinite(v) || v < 0) return
    aplicarASeleccion({ precio: redondear(v) })
    setFijoTmp('')
  }
  const aplicarSeccion = () => { if (seccionTmp) { aplicarASeleccion({ seccionId: seccionTmp }); setSeccionTmp('') } }
  const aplicarAreas = () => { if (areasTmp.length) aplicarASeleccion({ areas: areasTmp }) }

  return (
    <div className="adm-panel">
      <div className="adm-cab">
        <h2>{t('menu.titulo')}</h2>
        <form className="adm-fila" onSubmit={agregarSeccion}>
          <input value={nuevaSeccion} onChange={e => setNuevaSeccion(e.target.value)} placeholder={t('menu.nuevaSeccionPlaceholder')} />
          <label className="menu-grupo" title={t('menu.imprimirEnTitle')}>🖨
            <select value={nuevoGrupo || grupos[0]?.id || ''} onChange={e => setNuevoGrupo(e.target.value)} aria-label={t('menu.imprimirEn')}>
              {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </label>
          <button type="submit" className="success">{t('menu.masSeccion')}</button>
        </form>
      </div>
      {secciones.length > 0 && (
        <div className="adm-fila menu-barra">
          <button type="button" className="ghost" onClick={() => setAbiertas(new Set(secciones.map(x => x.id)))}>▾ {t('menu.expandirTodo')}</button>
          <button type="button" className="ghost" onClick={() => setAbiertas(new Set())}>▸ {t('menu.contraerTodo')}</button>
          <span className="adm-chip">{t('menu.seccionesAbiertas', { a: abiertas.size, n: secciones.length })}</span>
          {Object.keys(agotados).length > 0 && <span className="adm-chip adm-chip-agotado" title={t('agotado.contadorTitle')}>🚫 {t('agotado.contador', { n: Object.keys(agotados).length })}</span>}
        </div>
      )}

      {sel.size > 0 && (
        <div className="adm-masivo">
          <span className="adm-chip">{t('menu.masivoSel', { n: sel.size })}</span>
          <span className="adm-masivo-grupo">
            <input className="adm-num" type="number" step="0.1" value={pctTmp} onChange={e => setPctTmp(e.target.value)} placeholder={t('menu.masivoPorcentaje')} aria-label={t('menu.masivoPorcentaje')} />
            <button type="button" className="ghost" onClick={aplicarPorcentaje}>{t('menu.masivoAplicar')}</button>
            <input className="adm-num" type="number" min="0" step="0.01" value={fijoTmp} onChange={e => setFijoTmp(e.target.value)} placeholder={t('menu.masivoFijo')} aria-label={t('menu.masivoFijo')} />
            <button type="button" className="ghost" onClick={aplicarPrecioFijo}>{t('menu.masivoAplicar')}</button>
          </span>
          <span className="adm-masivo-grupo">
            <select value={seccionTmp} onChange={e => setSeccionTmp(e.target.value)} aria-label={t('menu.masivoSeccion')}>
              <option value="">{t('menu.masivoSeccion')}</option>
              {secciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <button type="button" className="ghost" onClick={aplicarSeccion}>{t('menu.masivoAplicar')}</button>
          </span>
          <span className="adm-masivo-grupo">
            {checkboxesAreas(areasTmp, setAreasTmp)}
            <button type="button" className="ghost" onClick={aplicarAreas} disabled={!areasTmp.length}>{t('menu.masivoAplicar')}</button>
          </span>
          <button type="button" className="success" onClick={() => aplicarASeleccion({ activo: true })}>{t('menu.activar')}</button>
          <button type="button" className="warning" onClick={() => aplicarASeleccion({ activo: false })}>{t('menu.desactivar')}</button>
          <span className="adm-masivo-grupo">
            <input value={motivoTmp} maxLength={60} onChange={e => setMotivoTmp(e.target.value)} placeholder={t('agotado.motivoPlace')} aria-label={t('agotado.motivoPlace')} />
            <button type="button" className="danger" onClick={() => { marcarAgotado(idsSel(), { motivo: motivoTmp }); setMotivoTmp('') }}>{t('agotado.hoy')}</button>
            <button type="button" className="ghost" onClick={() => marcarAgotado(idsSel(), null)}>{t('agotado.disponible')}</button>
          </span>
          <span className="sp" />
          <button type="button" className="ghost" onClick={() => setSel(new Set())}>✕ {t('menu.masivoLimpiar')}</button>
        </div>
      )}

      {secciones.map((sec, i) => {
        const prods = s.productos.filter(p => p.seccionId === sec.id)
        const activos = prods.filter(p => p.activo).length
        const abierta = abiertas.has(sec.id) || renombrarId === sec.id
        return (
          <section key={sec.id} className="adm-card">
            <header className="adm-card-cab menu-sec-cab">
              {renombrarId === sec.id ? (
                <form className="adm-fila" onSubmit={guardarNombre}>
                  <input autoFocus value={nombreTmp} onChange={e => setNombreTmp(e.target.value)} />
                  <label className="menu-grupo" title={t('menu.imprimirEnTitle')}>🖨
                    <select value={grupoTmp} onChange={e => setGrupoTmp(e.target.value)} aria-label={t('menu.imprimirEn')}>
                      {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
                    </select>
                  </label>
                  <button type="submit" className="success">{t('comun.guardar')}</button>
                  <button type="button" className="ghost" onClick={() => setRenombrarId(null)}>{t('comun.cancelar')}</button>
                </form>
              ) : (
                <>
                  <button type="button" className="menu-toggle" aria-expanded={abierta} onClick={() => alternar(sec.id)}>
                    <span className="menu-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
                    <h3>{sec.nombre}</h3>
                  </button>
                  <span className="adm-chip">{t('menu.activos', { activos, total: prods.length })}</span>
                  {grupoActual(sec.id) && <span className="adm-chip menu-chip-imp" title={t('menu.imprimirEnTitle')}>🖨 {grupoActual(sec.id).nombre}</span>}
                  <span className="sp" />
                  <span className="cab-acciones">
                    <button type="button" className="ghost" title={t('menu.todoSeccion')} aria-label={t('menu.todoSeccion')}
                      onClick={() => selSeccion(sec.id, !(prods.length && prods.every(p => sel.has(p.id))))}>☑</button>
                    <button type="button" className="ghost" title={t('menu.subir')} disabled={i === 0} onClick={() => mover(i, -1)}>▲</button>
                    <button type="button" className="ghost" title={t('menu.bajar')} disabled={i === secciones.length - 1} onClick={() => mover(i, 1)}>▼</button>
                    <button type="button" className="info" onClick={() => empezarRenombrar(sec)}>{t('comun.editar')}</button>
                    {confSeccion === sec.id ? (
                      <>
                        <span className="imp-dato">{t('menu.confirmarEliminarSeccion', { n: prods.length })}</span>
                        <button type="button" className="danger solid" onClick={() => borrarSeccion(sec)}>{t('comun.confirmar')}</button>
                        <button type="button" className="ghost" onClick={() => setConfSeccion(null)}>{t('comun.cancelar')}</button>
                      </>
                    ) : <button type="button" className="danger" onClick={() => setConfSeccion(sec.id)}>{t('comun.eliminar')}</button>}
                  </span>
                </>
              )}
            </header>

            {abierta && <>
            <ul className="adm-lista">
              {prods.length === 0 && <li className="adm-vacio">{t('menu.sinProductos')}</li>}
              {prods.map(p => (
                <li key={p.id} className={'adm-prod' + (p.activo ? '' : ' inactivo') + (agotados[p.id] ? ' agotado' : '') + (sel.has(p.id) ? ' sel' : '')}>
                  <input type="checkbox" className="adm-sel" checked={sel.has(p.id)} onChange={() => alternarSel(p.id)} aria-label={t('menu.seleccionar')} />
                  <Miniatura producto={p} />
                  {editandoId === p.id ? (
                    <form className="adm-fila" onSubmit={guardarProducto}>
                      <input autoFocus value={editTmp.nombre} onChange={e => setEditTmp({ ...editTmp, nombre: e.target.value })} placeholder={t('menu.nombre')} />
                      <input className="adm-precio" type="number" min="0" step="0.01" value={editTmp.precio}
                        onChange={e => setEditTmp({ ...editTmp, precio: e.target.value })} placeholder={t('menu.precio')} />
                      {checkboxesAreas(editTmp.areas, a => setEditTmp(x => ({ ...x, areas: a })))}
                      {campoOpciones(editTmp.opciones, v => setEditTmp(x => ({ ...x, opciones: v })))}
                      <button type="submit" className="success">{t('comun.guardar')}</button>
                      <button type="button" className="ghost" onClick={() => setEditandoId(null)}>{t('comun.cancelar')}</button>
                    </form>
                  ) : (
                    <>
                      <span className="adm-prod-nombre">{p.nombre}{p.activo ? '' : t('menu.oculto')}{agotados[p.id] ? ` ${t('agotado.badge')}` : ''}</span>
                      <span className="adm-prod-precio">{money(p.precio)}</span>
                      <span className="adm-chip menu-chip-areas" title={areasDe(p) ? tOr('areas.title', 'Áreas donde se imprime este artículo') : tOr('areas.porSeccion', 'Sin áreas propias: usa el grupo de la sección')}>
                        {areasDe(p)
                          ? areasDe(p).map(nombreArea).join(' + ')
                          : `${grupoActual(p.seccionId)?.nombre ?? '—'} · ${tOr('areas.porSeccionCorto', 'por sección')}`}
                      </span>
                      {(p.opciones || []).length > 0 && <span className="adm-chip menu-chip-areas" title={t('menu.opcionesTitle')}>✎ {p.opciones.length}</span>}
                      <button type="button" className="info" onClick={() => empezarEditar(p)}>{t('comun.editar')}</button>
                      <button type="button" className={p.activo ? 'warning' : 'success'} onClick={() => d({ t: 'producto~', id: p.id, cambios: { activo: !p.activo } })}>
                        {p.activo ? t('menu.desactivar') : t('menu.activar')}
                      </button>
                      {agotando === p.id ? (
                        <>
                          <input className="adm-motivo" autoFocus maxLength={60} value={motivoTmp} onChange={e => setMotivoTmp(e.target.value)}
                            placeholder={t('agotado.motivoPlace')} aria-label={t('agotado.motivoPlace')} />
                          <button type="button" className="danger solid" onClick={() => { marcarAgotado([p.id], { motivo: motivoTmp }); setMotivoTmp(''); setAgotando(null) }}>{t('comun.confirmar')}</button>
                          <button type="button" className="ghost" onClick={() => { setAgotando(null); setMotivoTmp('') }}>{t('comun.cancelar')}</button>
                        </>
                      ) : (
                        <button type="button" className={agotados[p.id] ? 'success' : 'danger'}
                          title={agotados[p.id]?.motivo || undefined}
                          onClick={() => { if (agotados[p.id]) marcarAgotado([p.id], null); else { setMotivoTmp(''); setAgotando(p.id) } }}>
                          {agotados[p.id] ? t('agotado.disponible') : t('agotado.hoy')}
                        </button>
                      )}
                      {confProd === p.id ? (
                        <>
                          <span className="imp-dato">{t('menu.confirmarEliminar', { nombre: p.nombre })}</span>
                          <button type="button" className="danger solid" onClick={() => { d({ t: 'producto-', id: p.id }); d({ t: 'cfg~', cambios: { agotados: conMarca(s.config, p.id, null) } }); setConfProd(null) }}>{t('comun.confirmar')}</button>
                          <button type="button" className="ghost" onClick={() => setConfProd(null)}>{t('comun.cancelar')}</button>
                        </>
                      ) : <button type="button" className="danger" onClick={() => setConfProd(p.id)}>{t('comun.eliminar')}</button>}
                      {esAdmin && (
                        <div className="adm-prod-img">
                          {subiendoId === p.id ? (
                            <span className="adm-spinner" role="status">
                              <span className="adm-spinner-aro" aria-hidden="true" />
                              {tOr('menu.procesandoFoto', 'Procesando foto…')}
                            </span>
                          ) : (
                            <>
                              <label className="adm-btn-foto">
                                <input type="file" accept="image/*" onChange={e => subirFoto(p, e)} />
                                {p.imagen_path || p.imagen_dataurl ? tOr('menu.cambiarFoto', 'Cambiar foto') : tOr('menu.subirFoto', 'Subir foto')}
                              </label>
                              {urlImagenProducto(p) && (
                                <button type="button" className="ghost" onClick={() => quitarFoto(p)}>
                                  {tOr('menu.quitarFoto', 'Quitar foto')}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {avisoImg && avisoImg.id === p.id && <div className="adm-img-aviso">{avisoImg.msg}</div>}
                    </>
                  )}
                </li>
              ))}
            </ul>

            {agregarEn === sec.id ? (
              <form className="adm-fila adm-nuevo" onSubmit={agregarProducto}>
                <input autoFocus value={nuevoProd.nombre} onChange={e => setNuevoProd({ ...nuevoProd, nombre: e.target.value })} placeholder={t('menu.nombreProducto')} />
                <input className="adm-precio" type="number" min="0" step="0.01" value={nuevoProd.precio}
                  onChange={e => setNuevoProd({ ...nuevoProd, precio: e.target.value })} placeholder={t('menu.precioMoneda', { moneda })} />
                {checkboxesAreas(nuevoProd.areas, a => setNuevoProd(x => ({ ...x, areas: a })))}
                {campoOpciones(nuevoProd.opciones, v => setNuevoProd(x => ({ ...x, opciones: v })))}
                <button type="submit" className="success">{t('menu.agregar')}</button>
                <button type="button" className="ghost" onClick={() => setAgregarEn(null)}>{t('comun.cancelar')}</button>
              </form>
            ) : (
              <button type="button" className="adm-agregar" onClick={() => empezarAgregar(sec.id)}>{t('menu.productoEnSeccion', { seccion: sec.nombre })}</button>
            )}
            </>}
          </section>
        )
      })}
    </div>
  )
}
