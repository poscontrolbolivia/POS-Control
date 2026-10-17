import { useEffect, useState } from 'react'
import { useStore, nuevoId } from '../../services/store.jsx'
import { gruposDeComanda, grupoDeSeccion } from '../../services/impresion.js'
import { puede } from '../../services/permisos'
import { sb } from '../../services/supabase.js'
import {
  LADO_VISUAL_PX, urlImagenProducto, procesarYGuardarImagen, quitarImagenGuardada,
} from '../../services/imagenProducto.js'
import { useIdioma } from '../../i18n/index.jsx'
import './admin.css'

// Miniato cuadrado 45×45 con fallback a la inicial del producto (no desalinea la fila
// cuando falta la imagen: el hueco siempre mide lo mismo).
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

// Gestión del menú: secciones (agregar / renombrar / reordenar) y productos por sección.
// Los NOMBRES de sección y producto son datos del negocio: no se traducen nunca.
// Props: { rol }
export default function MenuAdmin({ rol }) {
  const { s, d, modo } = useStore()
  const { t, tOr } = useIdioma()
  const moneda = s.config?.moneda || 'Bs'
  const money = n => `${moneda} ${Number(n || 0).toFixed(2)}`

  const [nuevaSeccion, setNuevaSeccion] = useState('')
  const [nuevoGrupo, setNuevoGrupo] = useState('')        // grupo de impresión de la sección que se crea
  const [renombrarId, setRenombrarId] = useState(null)   // sección en edición de nombre
  const [nombreTmp, setNombreTmp] = useState('')
  const [grupoTmp, setGrupoTmp] = useState('')           // grupo de impresión mientras se edita la sección
  const [abiertas, setAbiertas] = useState(() => {       // secciones desplegadas (el resto, recogidas)
    try { return new Set(JSON.parse(sessionStorage.getItem('pos-menu-abiertas')) || []) } catch { return new Set() }
  })
  const [confSeccion, setConfSeccion] = useState(null)   // sección con la confirmación de borrado abierta
  const [confProd, setConfProd] = useState(null)         // producto con la confirmación de borrado abierta
  useEffect(() => { try { sessionStorage.setItem('pos-menu-abiertas', JSON.stringify([...abiertas])) } catch { /* sin almacenamiento */ } }, [abiertas])
  const [agregarEn, setAgregarEn] = useState(null)        // seccionId con formulario abierto
  const [nuevoProd, setNuevoProd] = useState({ nombre: '', precio: '' })
  const [editandoId, setEditandoId] = useState(null)      // producto en edición inline
  const [editTmp, setEditTmp] = useState({ nombre: '', precio: '' })
  const [subiendoId, setSubiendoId] = useState(null)       // producto cuyo foto se está procesando
  const [avisoImg, setAvisoImg] = useState(null)           // { id, msg } error de foto (español)

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
  const asignarGrupo = (seccionId, grupoId) => {
    if (!grupoId || grupoActual(seccionId)?.id === grupoId && s.config?.impresoraPorSeccion?.[seccionId] === grupoId) return
    d({ t: 'cfg~', cambios: { impresoraPorSeccion: { ...(s.config?.impresoraPorSeccion || {}), [seccionId]: grupoId } } })
  }
  const alternar = id => setAbiertas(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const agregarSeccion = e => {
    e.preventDefault()
    const nombre = nuevaSeccion.trim()
    if (!nombre) return
    const id = nuevoId() // el id se genera aquí para poder asignarle su grupo de impresión de inmediato
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
  const borrarSeccion = sec => { d({ t: 'seccion-', id: sec.id }); setConfSeccion(null); setAbiertas(a => { const n = new Set(a); n.delete(sec.id); return n }) }

  const mover = (idx, dir) => {
    const a = secciones[idx]
    const b = secciones[idx + dir]
    if (!b) return
    let oa = a.orden ?? idx + 1
    let ob = b.orden ?? idx + 2 + dir
    if (oa === ob) ob = oa + dir // evita intercambios entre ordenes duplicados
    d({ t: 'seccion~', id: a.id, cambios: { orden: ob } })
    d({ t: 'seccion~', id: b.id, cambios: { orden: oa } })
  }

  const empezarAgregar = secId => { setAgregarEn(secId); setNuevoProd({ nombre: '', precio: '' }) }
  const agregarProducto = e => {
    e.preventDefault()
    const nombre = nuevoProd.nombre.trim()
    const precio = Number(nuevoProd.precio)
    if (!nombre || !Number.isFinite(precio) || precio < 0) return
    d({ t: 'producto+', producto: { nombre, seccionId: agregarEn, precio } })
    setNuevoProd({ nombre: '', precio: '' })
    setAgregarEn(null)
  }

  const empezarEditar = p => { setEditandoId(p.id); setEditTmp({ nombre: p.nombre, precio: String(p.precio) }) }
  const guardarProducto = e => {
    e.preventDefault()
    const nombre = editTmp.nombre.trim()
    const precio = Number(editTmp.precio)
    if (nombre && Number.isFinite(precio) && precio >= 0) {
      d({ t: 'producto~', id: editandoId, cambios: { nombre, precio } })
    }
    setEditandoId(null)
  }

  // Foto de artículo. El permiso real es 'gestionar_menu' (solo admin lo tiene en permisos.js;
  // no existe un permiso específico de imágenes). Las fotos se comprimen en el navegador antes
  // de subirse y nunca superan el límite del bucket.
  const dispatchFoto = (p, cambios) => {
    const actual = s.productos.find(x => x.id === p.id) || p
    // Se mandan también nombre/precio/activo: en modo Supabase el adaptador aún NO mapea
    // imagen_path en su UPDATE, y así el PATCH que dispara 'producto~' nunca queda vacío.
    d({ t: 'producto~', id: p.id, cambios: { nombre: actual.nombre, precio: actual.precio, activo: actual.activo, ...cambios } })
  }

  const subirFoto = async (p, e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''   // permite volver a elegir el mismo archivo si se cancela/error
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
                </>
              )}
            </header>

            {abierta && <>
            <ul className="adm-lista">
              {prods.length === 0 && <li className="adm-vacio">{t('menu.sinProductos')}</li>}
              {prods.map(p => (
                <li key={p.id} className={'adm-prod' + (p.activo ? '' : ' inactivo')}>
                  <Miniatura producto={p} />
                  {editandoId === p.id ? (
                    <form className="adm-fila" onSubmit={guardarProducto}>
                      <input autoFocus value={editTmp.nombre} onChange={e => setEditTmp({ ...editTmp, nombre: e.target.value })} placeholder={t('menu.nombre')} />
                      <input className="adm-precio" type="number" min="0" step="0.50" value={editTmp.precio}
                        onChange={e => setEditTmp({ ...editTmp, precio: e.target.value })} placeholder={t('menu.precio')} />
                      <button type="submit" className="success">{t('comun.guardar')}</button>
                      <button type="button" className="ghost" onClick={() => setEditandoId(null)}>{t('comun.cancelar')}</button>
                    </form>
                  ) : (
                    <>
                      <span className="adm-prod-nombre">{p.nombre}{p.activo ? '' : t('menu.oculto')}</span>
                      <span className="adm-prod-precio">{money(p.precio)}</span>
                      <button type="button" className="info" onClick={() => empezarEditar(p)}>{t('comun.editar')}</button>
                      <button type="button" className={p.activo ? 'warning' : 'success'} onClick={() => d({ t: 'producto~', id: p.id, cambios: { activo: !p.activo } })}>
                        {p.activo ? t('menu.desactivar') : t('menu.activar')}
                      </button>
                      {confProd === p.id ? (
                        <>
                          <span className="imp-dato">{t('menu.confirmarEliminar', { nombre: p.nombre })}</span>
                          <button type="button" className="danger solid" onClick={() => { d({ t: 'producto-', id: p.id }); setConfProd(null) }}>{t('comun.confirmar')}</button>
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
                <input className="adm-precio" type="number" min="0" step="0.50" value={nuevoProd.precio}
                  onChange={e => setNuevoProd({ ...nuevoProd, precio: e.target.value })} placeholder={t('menu.precioMoneda', { moneda })} />
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
