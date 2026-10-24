import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import { useMoneda } from '../../../services/money.js'
import { limpiarMonto, numMonto, round2 } from '../../../services/format.js'

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const CADUCA_PREGUNTA = 4000

// Fechas del contrato: 'YYYY-MM-DD'. Para "hoy" se usa la fecha local (no UTC), así el filtro
// de vencidas coincide con el calendario del negocio.
const hoyISO = () => {
  const x = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

const RANGO_ESTADO = { vencida: 0, pendiente: 1, pagada: 2 }

export default function CuentasTab({ filtroProveedor, onFiltro, alta = false, onAltaDone }) {
  const { s, d } = useStore()
  const { tOr } = useIdioma()
  const { money } = useMoneda()

  const hoy = hoyISO()
  const deudas = useMemo(() => s.deudas || [], [s.deudas])
  const proveedores = s.proveedores || []
  const provPorId = useMemo(() => new Map(proveedores.map(p => [p.id, p])), [proveedores])
  const activos = useMemo(() => proveedores.filter(p => p.activo !== false), [proveedores])

  const [form, setForm] = useState({ proveedorId: '', concepto: '', monto: '', fecha: hoy, vencimiento: '', nota: '' })
  const [formErr, setFormErr] = useState('')
  const [abono, setAbono] = useState(null)
  const [abonoErr, setAbonoErr] = useState('')
  const [edicion, setEdicion] = useState(null)
  const [editErr, setEditErr] = useState('')
  const [confirmaBorrar, setConfirmaBorrar] = useState(null)
  const timerPregunta = useRef(null)
  const provSelRef = useRef(null)

  useEffect(() => () => clearTimeout(timerPregunta.current), [])

  // La alta de deuda puede pedirse desde la barra de pestañas (esta pestaña arranca oculta): al
  // llegar la señal se enfoca el selector de proveedor para que el formulario quede listo a mano.
  useEffect(() => {
    if (alta) { provSelRef.current?.focus(); onAltaDone?.() }
  }, [alta])

  const nombreProv = id => provPorId.get(id)?.nombre || tOr('inventario.provEliminado', 'Proveedor eliminado')
  const estadoDeuda = de => {
    if (num(de.saldo) <= 0 || de.pagadaEn) return 'pagada'
    if (de.vencimiento && de.vencimiento < hoy) return 'vencida'
    return 'pendiente'
  }
  const etiquetaEstado = e => ({ vencida: tOr('inventario.deudaVencida', 'Vencida'), pendiente: tOr('inventario.deudaPendiente', 'Pendiente'), pagada: tOr('inventario.deudaPagada', 'Pagada') }[e])

  const visibles = useMemo(() => deudas
    .filter(de => !filtroProveedor || de.proveedorId === filtroProveedor)
    .sort((a, b) => {
      const r = RANGO_ESTADO[estadoDeuda(a)] - RANGO_ESTADO[estadoDeuda(b)]
      if (r) return r
      const va = a.vencimiento || '9999-12-31'
      const vb = b.vencimiento || '9999-12-31'
      if (va !== vb) return va < vb ? -1 : 1
      return String(b.fecha || '') < String(a.fecha || '') ? -1 : 1
    }), [deudas, filtroProveedor, hoy])

  const totales = useMemo(() => {
    let total = 0, pagado = 0, pendiente = 0, vencidas = 0
    for (const de of visibles) {
      total += num(de.monto); pagado += num(de.pagado); pendiente += num(de.saldo)
      if (estadoDeuda(de) === 'vencida') vencidas++
    }
    return { total: round2(total), pagado: round2(pagado), pendiente: round2(pendiente), vencidas }
  }, [visibles, hoy])

  const setCampo = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setFormErr('') }
  const registrar = e => {
    e.preventDefault()
    if (!form.proveedorId) { setFormErr(tOr('inventario.deudaFaltaProveedor', 'Elige el proveedor de esta deuda.')); return }
    if (!form.concepto.trim()) { setFormErr(tOr('inventario.deudaFaltaConcepto', 'Describe el concepto: qué se compró.')); return }
    const monto = numMonto(form.monto)
    if (!(monto > 0)) { setFormErr(tOr('inventario.deudaMontoInvalido', 'El monto debe ser un número mayor que 0.')); return }
    setFormErr('')
    d({
      t: 'deuda+',
      deuda: {
        proveedorId: form.proveedorId,
        fecha: form.fecha || hoy,
        vencimiento: form.vencimiento || null,
        concepto: form.concepto.trim(),
        monto,
        nota: form.nota.trim(),
      },
    })
    setForm({ proveedorId: '', concepto: '', monto: '', fecha: hoy, vencimiento: '', nota: '' })
  }

  const cerrarAbono = () => { setAbono(null); setAbonoErr('') }
  const abrirAbono = de => {
    setEdicion(null); setEditErr('')
    setAbono(a => (a && a.id === de.id ? null : { id: de.id, monto: String(round2(num(de.saldo))), nota: '' }))
    setAbonoErr('')
  }
  const confirmarAbono = e => {
    e.preventDefault()
    if (!abono) return
    const de = deudas.find(x => x.id === abono.id)
    const saldo = num(de?.saldo)
    const monto = numMonto(abono.monto)
    if (!(monto > 0)) { setAbonoErr(tOr('inventario.abonoInvalido', 'El abono debe ser un número mayor que 0.')); return }
    if (monto > saldo + 0.005) { setAbonoErr(tOr('inventario.abonoExcede', `El abono no puede superar el saldo (${money(saldo)}).`, { saldo: money(saldo) })); return }
    setAbonoErr('')
    d({ t: 'deuda-abono', id: abono.id, monto: round2(monto), nota: abono.nota.trim() })
    cerrarAbono()
  }

  const cerrarEdicion = () => { setEdicion(null); setEditErr('') }
  const abrirEdicion = de => {
    setAbono(null); setAbonoErr('')
    setEdicion(ed => (ed && ed.id === de.id ? null : {
      id: de.id,
      concepto: de.concepto || '',
      monto: String(de.monto ?? ''),
      fecha: de.fecha || hoy,
      vencimiento: de.vencimiento || '',
      nota: de.nota || '',
    }))
    setEditErr('')
  }
  const guardarEdicion = e => {
    e.preventDefault()
    if (!edicion) return
    if (!edicion.concepto.trim()) { setEditErr(tOr('inventario.deudaFaltaConcepto', 'Describe el concepto: qué se compró.')); return }
    const monto = numMonto(edicion.monto)
    if (!(monto > 0)) { setEditErr(tOr('inventario.deudaMontoInvalido', 'El monto debe ser un número mayor que 0.')); return }
    setEditErr('')
    d({
      t: 'deuda~',
      id: edicion.id,
      cambios: {
        concepto: edicion.concepto.trim(),
        monto,
        fecha: edicion.fecha || hoy,
        vencimiento: edicion.vencimiento || null,
        nota: edicion.nota.trim(),
      },
    })
    cerrarEdicion()
  }

  const cerrarConfirmar = () => { setConfirmaBorrar(null); clearTimeout(timerPregunta.current) }
  const pulsarBorrar = de => {
    clearTimeout(timerPregunta.current)
    setConfirmaBorrar(de.id)
    timerPregunta.current = setTimeout(() => setConfirmaBorrar(null), CADUCA_PREGUNTA)
  }
  const confirmarBorrar = id => {
    d({ t: 'deuda-', id })
    if (abono?.id === id) cerrarAbono()
    if (edicion?.id === id) cerrarEdicion()
    cerrarConfirmar()
  }

  const exportarCSV = () => {
    if (!visibles.length) return
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const cab = [
      tOr('inventario.provColNombre', 'Proveedor'), tOr('inventario.deudaColConcepto', 'Concepto'),
      tOr('inventario.deudaColFecha', 'Fecha'), tOr('inventario.deudaColVencimiento', 'Vencimiento'),
      tOr('inventario.deudaColMonto', 'Monto'), tOr('inventario.provColPagado', 'Pagado'),
      tOr('inventario.deudaColSaldo', 'Saldo'), tOr('inventario.provColEstado', 'Estado'),
      tOr('inventario.colNota', 'Nota'),
    ]
    const filas = visibles.map(de => [
      nombreProv(de.proveedorId), de.concepto || '', de.fecha || '', de.vencimiento || '',
      num(de.monto), num(de.pagado), num(de.saldo), etiquetaEstado(estadoDeuda(de)), de.nota || '',
    ])
    const csv = '\ufeff' + [cab, ...filas].map(f => f.map(esc).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = 'cuentas-por-pagar.csv'
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const provFiltrado = filtroProveedor ? provPorId.get(filtroProveedor) : null

  return (
    <section className="adm-card inv-bloque">
      <div className="adm-card-cab">
        <h3>{tOr('inventario.cuentasTitulo', 'Cuentas por pagar')}</h3>
        <span className="adm-chip">{visibles.length} {tOr('inventario.chipDeudas', 'deuda(s)')}</span>
        <span className="sp" />
        {provFiltrado && (
          <button type="button" className="ghost" onClick={() => onFiltro('')}>
            {nombreProv(provFiltrado.id)} ✕
          </button>
        )}
        <button type="button" className="ghost" disabled={!visibles.length} onClick={exportarCSV}>
          {tOr('inventario.exportar', 'Exportar CSV')}
        </button>
      </div>

      <div className="inv-receta-resumen">
        <span className="adm-chip">{tOr('inventario.deudaTotal', 'Total deuda')}: {money(totales.total)}</span>
        <span className="adm-chip">{tOr('inventario.provPagado', 'Pagado')}: {money(totales.pagado)}</span>
        <span className={'adm-chip' + (totales.pendiente > 0 ? ' inv-chip-alerta' : '')}>
          {tOr('inventario.provPendiente', 'Pendiente')}: {money(totales.pendiente)}
        </span>
        {totales.vencidas > 0 && (
          <span className="adm-chip inv-chip-alerta">🔴 {totales.vencidas} {tOr('inventario.deudaVencidas', 'vencida(s)')}</span>
        )}
      </div>

      <form className="inv-form" onSubmit={registrar}>
        <b>{tOr('inventario.deudaAltaTitulo', 'Registrar una deuda')}</b>
        <div className="inv-campos">
          <label className="adm-campo">
            <span>{tOr('inventario.provNombre', 'Proveedor')}</span>
            <select name="proveedor-id" ref={provSelRef} value={form.proveedorId} onChange={setCampo('proveedorId')}>
              <option value="">{tOr('inventario.elegirProveedor', 'Elige un proveedor')}</option>
              {activos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="adm-campo inv-mov-nota">
            <span>{tOr('inventario.deudaConcepto', 'Concepto')}</span>
            <input name="pista-concepto" value={form.concepto} onChange={setCampo('concepto')} maxLength={120}
              placeholder={tOr('inventario.pistaConcepto', 'p. ej. Compra de carne semanal')} />
          </label>
          <label className="adm-campo">
            <span>{tOr('inventario.deudaMonto', 'Monto')}</span>
            <input name="monto" type="text" inputMode="decimal" autoComplete="off" value={form.monto}
              onChange={e => { setForm(f => ({ ...f, monto: limpiarMonto(e.target.value) })); setFormErr('') }}
              onBlur={() => setForm(f => ({ ...f, monto: f.monto !== '' ? numMonto(f.monto).toFixed(2) : '' }))}
              onFocus={e => e.target.select()} placeholder="0" />
          </label>
          <label className="adm-campo">
            <span>{tOr('inventario.deudaFecha', 'Fecha')}</span>
            <input name="fecha" type="date" value={form.fecha} onChange={setCampo('fecha')} />
          </label>
          <label className="adm-campo">
            <span>{tOr('inventario.deudaVencimiento', 'Vencimiento')} ({tOr('inventario.deudaOpcional', 'opcional')})</span>
            <input name="vencimiento" type="date" value={form.vencimiento} onChange={setCampo('vencimiento')} />
          </label>
          <label className="adm-campo inv-mov-nota">
            <span>{tOr('inventario.nota', 'Nota')}</span>
            <input name="pista-nota-deuda" value={form.nota} onChange={setCampo('nota')} maxLength={140}
              placeholder={tOr('inventario.pistaNotaDeuda', 'opcional: factura, plazo hablado…')} />
          </label>
        </div>
        {formErr && <span className="adm-msg warn">{formErr}</span>}
        {!activos.length && <span className="adm-msg warn">{tOr('inventario.primeroProveedores', 'Primero crea un proveedor activo en la pestaña Proveedores.')}</span>}
        <div className="adm-fila">
          <button type="submit" className="primary" disabled={!activos.length}>＋ {tOr('inventario.deudaRegistrar', 'Registrar deuda')}</button>
        </div>
      </form>

      {!deudas.length
        ? <div className="adm-vacio">{tOr('inventario.vacioDeudas', 'No hay cuentas por pagar registradas. Usa el formulario de arriba para anotar la primera.')}</div>
        : !visibles.length
          ? <div className="adm-vacio">{tOr('inventario.deudasSinCoincidencias', 'Ninguna deuda para este proveedor.')}</div>
          : (
            <div className="inv-lista">
              {visibles.map(de => {
                const saldo = round2(num(de.saldo))
                const est = estadoDeuda(de)
                const enAbono = abono?.id === de.id
                const enEdicion = edicion?.id === de.id
                const preguntando = confirmaBorrar === de.id
                return (
                  <div key={de.id} className={'inv-fila' + ((enAbono || enEdicion) ? ' sel' : '')}>
                    <div className="inv-datos">
                      <span className="inv-nombre">{nombreProv(de.proveedorId)}</span>
                      <span className="inv-dato">{de.concepto || '—'}</span>
                      <span className="inv-dato">{tOr('inventario.deudaFecha', 'Fecha')}: {de.fecha || '—'}</span>
                      <span className="inv-dato">{tOr('inventario.deudaVence', 'Vence')}: {de.vencimiento || '—'}</span>
                      <span className="inv-monto">{money(de.monto)}</span>
                      <span className="inv-dato">{tOr('inventario.provPagado', 'Pagado')}: {money(de.pagado)}</span>
                      <span className={'inv-saldo ' + (saldo > 0 ? 'neg' : 'cero')}>{tOr('inventario.deudaSaldo', 'Saldo')}: {money(saldo)}</span>
                      {de.nota && <span className="inv-nota">{de.nota}</span>}
                      <span className={'inv-deuda-estado ' + est}>
                        {est === 'pagada' ? `✓ ${etiquetaEstado(est)}` : etiquetaEstado(est)}
                      </span>
                    </div>
                    <div className="inv-acciones">
                      {est !== 'pagada' && (
                        <button type="button" className="success" onClick={() => abrirAbono(de)}>
                          {enAbono ? tOr('inventario.cerrar', 'Cerrar') : tOr('inventario.deudaAbonar', 'Abonar')}
                        </button>
                      )}
                      <button type="button" className="ghost" onClick={() => (enEdicion ? cerrarEdicion() : abrirEdicion(de))}>
                        {enEdicion ? tOr('inventario.cerrar', 'Cerrar') : tOr('inventario.editar', 'Editar')}
                      </button>
                      {preguntando ? (
                        <>
                          <span className="inv-conf">{tOr('inventario.seguro', '¿Seguro?')}</span>
                          <button type="button" className="danger solid" onClick={() => confirmarBorrar(de.id)}>{tOr('inventario.sisi', 'Sí')}</button>
                          <button type="button" className="ghost" onClick={cerrarConfirmar}>{tOr('inventario.no', 'No')}</button>
                        </>
                      ) : (
                        <button type="button" className="danger" onClick={() => pulsarBorrar(de.id)}>{tOr('inventario.borrar', 'Borrar')}</button>
                      )}
                    </div>

                    {enAbono && (
                      <form className="inv-abono" onSubmit={confirmarAbono}>
                        <b>{tOr('inventario.abonoTitulo', 'Abonar')}: {de.concepto || nombreProv(de.proveedorId)} · {tOr('inventario.deudaSaldo', 'Saldo')} {money(saldo)}</b>
                        <div className="inv-mov-campos">
                          <label className="adm-campo">
                            <span>{tOr('inventario.abonoMonto', 'Monto del abono')}</span>
                            <input name="monto" autoFocus type="text" inputMode="decimal" autoComplete="off" value={abono.monto}
                              onChange={e => { setAbono(a => ({ ...a, monto: limpiarMonto(e.target.value) })); setAbonoErr('') }}
                              onBlur={() => setAbono(a => (a ? { ...a, monto: a.monto !== '' ? numMonto(a.monto).toFixed(2) : '' } : a))}
                              onFocus={e => e.target.select()} placeholder="0" />
                          </label>
                          <label className="adm-campo inv-mov-nota">
                            <span>{tOr('inventario.nota', 'Nota')}</span>
                            <input name="pista-nota-abono" value={abono.nota} onChange={e => setAbono(a => ({ ...a, nota: e.target.value }))}
                              placeholder={tOr('inventario.pistaNotaAbono', 'opcional: transferencia, efectivo…')} />
                          </label>
                        </div>
                        {abonoErr && <span className="adm-msg warn">{abonoErr}</span>}
                        <div className="adm-fila">
                          <button type="submit" className="primary">{tOr('inventario.abonoConfirmar', 'Confirmar abono')}</button>
                          <button type="button" onClick={cerrarAbono}>{tOr('inventario.cancelar', 'Cancelar')}</button>
                        </div>
                      </form>
                    )}

                    {enEdicion && (
                      <form className="inv-edit" onSubmit={guardarEdicion}>
                        <b>{tOr('inventario.editando', 'Editando')}: {de.concepto || nombreProv(de.proveedorId)}</b>
                        <div className="inv-mov-campos">
                          <label className="adm-campo inv-mov-nota">
                            <span>{tOr('inventario.deudaConcepto', 'Concepto')}</span>
                            <input name="concepto" autoFocus value={edicion.concepto} onChange={e => { setEdicion(x => ({ ...x, concepto: e.target.value })); setEditErr('') }} maxLength={120} />
                          </label>
                          <label className="adm-campo">
                            <span>{tOr('inventario.deudaMonto', 'Monto')}</span>
                            <input name="monto" type="text" inputMode="decimal" autoComplete="off" value={edicion.monto}
                              onChange={e => { setEdicion(x => ({ ...x, monto: limpiarMonto(e.target.value) })); setEditErr('') }}
                              onBlur={() => setEdicion(x => (x ? { ...x, monto: x.monto !== '' ? numMonto(x.monto).toFixed(2) : '' } : x))}
                              onFocus={e => e.target.select()} placeholder="0" />
                          </label>
                          <label className="adm-campo">
                            <span>{tOr('inventario.deudaFecha', 'Fecha')}</span>
                            <input name="fecha" type="date" value={edicion.fecha} onChange={e => setEdicion(x => ({ ...x, fecha: e.target.value }))} />
                          </label>
                          <label className="adm-campo">
                            <span>{tOr('inventario.deudaVencimiento', 'Vencimiento')} ({tOr('inventario.deudaOpcional', 'opcional')})</span>
                            <input name="vencimiento" type="date" value={edicion.vencimiento} onChange={e => setEdicion(x => ({ ...x, vencimiento: e.target.value }))} />
                          </label>
                          <label className="adm-campo inv-mov-nota">
                            <span>{tOr('inventario.nota', 'Nota')}</span>
                            <input name="nota" value={edicion.nota} onChange={e => setEdicion(x => ({ ...x, nota: e.target.value }))} maxLength={140} />
                          </label>
                        </div>
                        {editErr && <span className="adm-msg warn">{editErr}</span>}
                        <div className="adm-fila">
                          <button type="submit" className="primary">{tOr('inventario.guardar', 'Guardar')}</button>
                          <button type="button" onClick={cerrarEdicion}>{tOr('inventario.cancelar', 'Cancelar')}</button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      <p className="adm-sub">{tOr('inventario.cuentasAyuda', 'Las vencidas y pendientes aparecen primero; al quedar en saldo 0 la deuda se marca como Pagada.')}</p>
    </section>
  )
}
