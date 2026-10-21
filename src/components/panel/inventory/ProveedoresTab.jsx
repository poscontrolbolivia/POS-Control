import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { useMoneda } from '../../../services/money.js'
import { round2 } from '../../../services/format.js'

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const CADUCA_PREGUNTA = 4000
const PROVEEDOR_VACIO = { nombre: '', telefono: '', email: '', direccion: '', nota: '', activo: true }

export default function ProveedoresTab({ onPagar }) {
  const { s, d } = useStore()
  const { tOr } = useIdioma()
  const { money } = useMoneda()

  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [formErr, setFormErr] = useState('')
  const [buscador, setBuscador] = useState('')
  const [soloPendiente, setSoloPendiente] = useState(false)
  const [confirmaBorrar, setConfirmaBorrar] = useState(null)
  const timerPregunta = useRef(null)

  useEffect(() => () => clearTimeout(timerPregunta.current), [])

  // Deuda y platos vinculados por proveedor: la deuda se saca de s.deudas (saldo ya calculado
  // por el store) y los platos de s.costos, que indica de qué proveedor sale cada producto.
  const resumen = useMemo(() => {
    const porProv = new Map()
    for (const p of s.proveedores || []) porProv.set(p.id, { total: 0, pagado: 0, pendiente: 0, productos: [] })
    for (const de of s.deudas || []) {
      const r = porProv.get(de?.proveedorId)
      if (!r) continue
      r.total += num(de.monto)
      r.pagado += num(de.pagado)
      r.pendiente += num(de.saldo)
    }
    const nombreProd = new Map((s.productos || []).map(p => [p.id, p.nombre]))
    for (const c of s.costos || []) {
      const r = porProv.get(c?.proveedorId)
      const nombre = nombreProd.get(c?.productoId)
      if (r && nombre && !r.productos.includes(nombre)) r.productos.push(nombre)
    }
    for (const r of porProv.values()) { r.total = round2(r.total); r.pagado = round2(r.pagado); r.pendiente = round2(r.pendiente) }
    return porProv
  }, [s.proveedores, s.deudas, s.costos, s.productos])

  const filtro = buscador.trim().toLowerCase()
  const lista = useMemo(() => (s.proveedores || [])
    .filter(p => !filtro || String(p.nombre || '').toLowerCase().includes(filtro))
    .filter(p => !soloPendiente || (resumen.get(p.id)?.pendiente || 0) > 0)
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')), [s.proveedores, filtro, soloPendiente, resumen])

  const nConSaldo = (s.proveedores || []).filter(p => (resumen.get(p.id)?.pendiente || 0) > 0).length

  const cerrarForm = () => { setForm(null); setEditando(null); setFormErr('') }
  const abrirNuevo = () => { setFormErr(''); setEditando(null); setForm({ ...PROVEEDOR_VACIO }) }
  const abrirEditar = p => {
    setFormErr('')
    setEditando(p.id)
    setForm({
      nombre: p.nombre || '',
      telefono: p.telefono || '',
      email: p.email || '',
      direccion: p.direccion || '',
      nota: p.nota || '',
      activo: p.activo !== false,
    })
  }
  const setCampo = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setFormErr('') }

  const guardar = e => {
    e.preventDefault()
    if (!form) return
    if (!form.nombre.trim()) { setFormErr(tOr('inventario.provFaltaNombre', 'Escribe el nombre del proveedor.')); return }
    const datos = {
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim(),
      email: form.email.trim(),
      direccion: form.direccion.trim(),
      nota: form.nota.trim(),
      activo: Boolean(form.activo),
    }
    if (editando) d({ t: 'prov~', id: editando, cambios: datos })
    else d({ t: 'prov+', proveedor: datos })
    cerrarForm()
  }

  const alternarActivo = p => d({ t: 'prov~', id: p.id, cambios: { activo: p.activo === false } })

  const cerrarConfirmar = () => { setConfirmaBorrar(null); clearTimeout(timerPregunta.current) }
  const pulsarBorrar = p => {
    clearTimeout(timerPregunta.current)
    setConfirmaBorrar(p.id)
    timerPregunta.current = setTimeout(() => setConfirmaBorrar(null), CADUCA_PREGUNTA)
  }
  const confirmarBorrar = id => {
    d({ t: 'prov-', id })
    if (editando === id) cerrarForm()
    cerrarConfirmar()
  }

  const exportarCSV = () => {
    if (!lista.length) return
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const cab = [
      tOr('inventario.provColNombre', 'Proveedor'), tOr('inventario.provColContacto', 'Contacto'),
      tOr('inventario.provColPlatos', 'Platos que le compran'), tOr('inventario.provColDeuda', 'Deuda total'),
      tOr('inventario.provColPagado', 'Pagado'), tOr('inventario.provColPendiente', 'Pendiente'),
      tOr('inventario.provColEstado', 'Estado'), tOr('inventario.colNota', 'Nota'),
    ]
    const filas = lista.map(p => {
      const r = resumen.get(p.id) || { total: 0, pagado: 0, pendiente: 0, productos: [] }
      return [
        p.nombre,
        [p.telefono, p.email].filter(Boolean).join(' / '),
        r.productos.join('; '),
        r.total, r.pagado, r.pendiente,
        p.activo !== false ? tOr('inventario.provActivo', 'Activo') : tOr('inventario.provInactivo', 'Inactivo'),
        p.nota || '',
      ]
    })
    const csv = '\ufeff' + [cab, ...filas].map(f => f.map(esc).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = 'proveedores.csv'
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const bloqueForm = form && (
    <form className="inv-form" onSubmit={guardar}>
      <b>{editando ? `${tOr('inventario.editando', 'Editando')}: ${form.nombre}` : tOr('inventario.provAltaTitulo', 'Nuevo proveedor')}</b>
      <div className="inv-campos">
        <label className="adm-campo">
          <span>{tOr('inventario.provNombre', 'Nombre')}</span>
          <input autoFocus value={form.nombre} onChange={setCampo('nombre')} maxLength={80}
            placeholder={tOr('inventario.pistaProvNombre', 'p. ej. Distribuidora La Roca')} />
        </label>
        <label className="adm-campo">
          <span>{tOr('inventario.provTelefono', 'Teléfono')}</span>
          <input type="tel" value={form.telefono} onChange={setCampo('telefono')} maxLength={30} placeholder="70000000" />
        </label>
        <label className="adm-campo">
          <span>{tOr('inventario.provEmail', 'Email')}</span>
          <input type="email" value={form.email} onChange={setCampo('email')} maxLength={60} placeholder="compras@…" />
        </label>
        <label className="adm-campo">
          <span>{tOr('inventario.provDireccion', 'Dirección')}</span>
          <input value={form.direccion} onChange={setCampo('direccion')} maxLength={120}
            placeholder={tOr('inventario.pistaProvDireccion', 'opcional')} />
        </label>
        <label className="adm-campo inv-mov-nota">
          <span>{tOr('inventario.nota', 'Nota')}</span>
          <input value={form.nota} onChange={setCampo('nota')} maxLength={140}
            placeholder={tOr('inventario.pistaProvNota', 'opcional: días de entrega, crédito…')} />
        </label>
        <label className="inv-check">
          <input type="checkbox" checked={Boolean(form.activo)} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
          {tOr('inventario.activo', 'Activo')}
        </label>
      </div>
      {formErr && <span className="adm-msg warn">{formErr}</span>}
      <div className="adm-fila">
        <button type="submit" className="primary">{tOr('inventario.provGuardar', 'Guardar proveedor')}</button>
        <button type="button" onClick={cerrarForm}>{tOr('inventario.cancelar', 'Cancelar')}</button>
      </div>
    </form>
  )

  return (
    <section className="adm-card inv-bloque">
      <div className="adm-card-cab">
        <h3>{tOr('inventario.provTitulo', 'Proveedores')}</h3>
        <span className="adm-chip">
          {lista.length} / {(s.proveedores || []).length} {tOr('inventario.chipProveedores', 'proveedores')}
          {nConSaldo > 0 && <> · {nConSaldo} {tOr('inventario.chipConSaldo', 'con saldo pendiente')}</>}
        </span>
        <span className="sp" />
        <button type="button" className="ghost" disabled={!lista.length} onClick={exportarCSV}>
          {tOr('inventario.exportar', 'Exportar CSV')}
        </button>
        <button type="button" className="teal" disabled={Boolean(form) && !editando} onClick={abrirNuevo}>
          ＋ {tOr('inventario.nuevoProveedor', 'Proveedor')}
        </button>
      </div>

      {form && !editando && bloqueForm}

      {(s.proveedores || []).length > 0 && (
        <div className="inv-filtros">
          <input className="inv-buscador" value={buscador} onChange={e => setBuscador(e.target.value)}
            placeholder={tOr('inventario.provBuscador', 'Buscar proveedor por nombre…')} />
          <button type="button" className={'tab' + (soloPendiente ? ' on' : '')} aria-pressed={soloPendiente}
            onClick={() => setSoloPendiente(v => !v)}>
            {tOr('inventario.provSoloPendiente', 'Solo con saldo pendiente')}
          </button>
        </div>
      )}

      {!(s.proveedores || []).length
        ? <div className="adm-vacio">{tOr('inventario.vacioProveedores', 'Aún no hay proveedores. Crea el primero con «＋ Proveedor».')}</div>
        : !lista.length
          ? <div className="adm-vacio">{tOr('inventario.provSinCoincidencias', 'Ningún proveedor coincide con el filtro.')}</div>
          : (
            <div className="inv-lista">
              {lista.map(p => {
                const r = resumen.get(p.id) || { total: 0, pagado: 0, pendiente: 0, productos: [] }
                const enForm = editando === p.id
                const preguntando = confirmaBorrar === p.id
                return (
                  <div key={p.id} className={'inv-fila' + (enForm ? ' sel' : '')}>
                    <div className="inv-datos">
                      <span className="inv-nombre">{p.nombre}{p.activo === false && <em className="inv-inactivo"> · {tOr('inventario.inactivo', 'inactivo')}</em>}</span>
                      {(p.telefono || p.email) && <span className="inv-dato">📞 {p.telefono || '—'}{p.email ? ` · ✉️ ${p.email}` : ''}</span>}
                      {p.direccion && <span className="inv-dato">📍 {p.direccion}</span>}
                      <span className="inv-dato inv-prod-vinc" title={r.productos.join(', ')}>
                        {r.productos.length} {tOr('inventario.provPlatos', 'plato(s)')}{r.productos.length ? `: ${r.productos.join(', ')}` : ''}
                      </span>
                      <span className="inv-dato">{tOr('inventario.provDeuda', 'Deuda')}: {money(r.total)}</span>
                      <span className="inv-dato">{tOr('inventario.provPagado', 'Pagado')}: {money(r.pagado)}</span>
                      <span className={'inv-saldo ' + (r.pendiente > 0 ? 'neg' : 'cero')}>{tOr('inventario.provPendiente', 'Pendiente')}: {money(r.pendiente)}</span>
                    </div>
                    <div className="inv-acciones">
                      <button type="button" className={p.activo !== false ? 'success' : 'ghost'} onClick={() => alternarActivo(p)}
                        title={tOr('inventario.provToggleActivo', 'Activar / desactivar')}>
                        {p.activo !== false ? tOr('inventario.provActivo', 'Activo') : tOr('inventario.provInactivo', 'Inactivo')}
                      </button>
                      <button type="button" className="ghost" onClick={() => (enForm ? cerrarForm() : abrirEditar(p))}>
                        {enForm ? tOr('inventario.cerrar', 'Cerrar') : tOr('inventario.editar', 'Editar')}
                      </button>
                      <button type="button" className="primary" onClick={() => onPagar(p.id)}>
                        {tOr('inventario.provPagar', 'Pagar')}
                      </button>
                      {preguntando ? (
                        <>
                          <span className="inv-conf">{tOr('inventario.seguro', '¿Seguro?')}</span>
                          <button type="button" className="danger solid" onClick={() => confirmarBorrar(p.id)}>{tOr('inventario.sisi', 'Sí')}</button>
                          <button type="button" className="ghost" onClick={cerrarConfirmar}>{tOr('inventario.no', 'No')}</button>
                        </>
                      ) : (
                        <button type="button" className="danger" onClick={() => pulsarBorrar(p)}>{tOr('inventario.borrar', 'Borrar')}</button>
                      )}
                    </div>

                    {enForm && bloqueForm}
                  </div>
                )
              })}
            </div>
          )}
      <p className="adm-sub">{tOr('inventario.provAyuda', '«Pagar» abre Cuentas por pagar filtrado en este proveedor; el saldo se actualiza con los abonos registrados.')}</p>
    </section>
  )
}
