import { useMemo, useRef, useState } from 'react'
import { importarEmpresa, leerArchivoRespaldo, validarSnapshot } from '../../../services/super/superApi.js'
import { useIdioma } from '../../../i18n/index.jsx'
import './SuperPage.css'

export default function ImportBlock({ ocupado = false, onEntrar }) {
  const { tOr } = useIdioma()
  const [crudo, setCrudo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [clave, setClave] = useState('')
  const [archivo, setArchivo] = useState('')
  const [errorArchivo, setErrorArchivo] = useState('')
  const [creando, setCreando] = useState(false)
  const [creada, setCreada] = useState(null)
  const [error, setError] = useState('')
  const [progreso, setProgreso] = useState('')
  const zipRef = useRef(null)
  const entrada = useRef(null)

  const datos = useMemo(() => {
    const t = crudo.trim()
    if (!t) return { ok: false, problemas: [tOr('super.importar.sinJson', 'Pega el JSON exportado o elige un archivo .json.')], resumen: null }
    let leido
    try { leido = JSON.parse(t) } catch { return { ok: false, problemas: [tOr('super.importar.noEsJson', 'El texto no es JSON válido.')], resumen: null } }
    return validarSnapshot(leido)
  }, [crudo, tOr])

  const ocupadisimo = ocupado || creando

  const cargarArchivo = async f => {
    setErrorArchivo(''); setError('')
    try {
      const { datos: leido, zip } = await leerArchivoRespaldo(f)
      zipRef.current = zip
      setCrudo(JSON.stringify(leido, null, 2))
      setArchivo(f.name)
      setCreada(null)
      if (!codigo) {
        const orig = String(leido?.empresa?.codigo || leido?.empresa?.nombre || '').trim()
        if (orig) setCodigo(`${orig}-2`)
      }
    } catch (e) {
      setErrorArchivo(e?.message || tOr('super.importar.errorArchivo', 'No se pudo leer el archivo.'))
    }
  }

  const ejecutar = async () => {
    if (!datos.ok) return
    setError(''); setCreando(true)
    try {
      const { id, fotos } = await importarEmpresa(JSON.parse(crudo), codigo, clave, {
        zip: zipRef.current,
        onProgreso: (h, t) => setProgreso(tOr('super.importar.subiendoFotos', `Subiendo fotos… ${h}/${t}`, { hechas: h, total: t })),
      })
      setCreada({ id, nombre: datos.resumen.nombre, codigo: codigo.trim().toLowerCase(), fotos })
    } catch (e) {
      setError(e?.message || tOr('super.importar.errorImport', 'No se pudo importar la empresa.'))
    } finally { setCreando(false); setProgreso('') }
  }

  const r = datos.resumen

  return (
    <section className="panel super-bloque">
      <div className="super-titulo-bloque">
        <h3>{tOr('super.importar.titulo', 'Importar una empresa (respaldo .json)')}</h3>
        <span className="sp" />
        <span className="super-chip">{tOr('super.importar.chip', 'crea la empresa en ESTA base, con código nuevo')}</span>
      </div>
      <p className="super-ayuda">
        {tOr('super.importar.ayuda', 'Sirve para que un cliente del plan gratuito suba a un plan de pago llevándose todos sus datos: exportamos su snapshot y lo importamos donde corres. Los usuarios que no existan se crean con la clave inicial que indiques (por defecto pos12345).')}
      </p>

      <div className="super-campo">
        <span>{tOr('super.importar.archivo', 'Archivo exportado')}</span>
        <div className="barra">
          <input name="file" ref={entrada} type="file" accept="application/json,.json,application/zip,.zip" style={{ flex: 1, minWidth: 220 }}
            disabled={ocupadisimo} onChange={e => cargarArchivo(e.target.files?.[0])} />
          {archivo && <span className="super-chip">{archivo}</span>}
          {crudo && (
            <button type="button" className="super-ghost" disabled={ocupadisimo}
              onClick={() => { zipRef.current = null; setCrudo(''); setArchivo(''); setCreada(null); setError(''); setErrorArchivo('') }}>
              {tOr('super.importar.limpiar', 'Limpiar')}
            </button>
          )}
        </div>
        {errorArchivo && <div className="super-error" role="alert">⚠️ {errorArchivo}</div>}
      </div>

      <label className="super-campo">
        <span>{tOr('super.importar.pegar', '…o pega el JSON aquí')}</span>
        <textarea name="crudo" value={crudo} disabled={ocupadisimo} spellCheck={false}
          placeholder='{ "empresa": { "nombre": "…" }, "zonas": [], "mesas": [], "productos": [] }'
          onChange={e => { zipRef.current = null; setCrudo(e.target.value); setCreada(null); setError('') }} />
      </label>

      {!datos.ok
        ? <div className="super-error" role="alert">⚠️ {datos.problemas.join(' · ')}</div>
        : (
          <div className="super-bloque">
            <div className="super-fila-num">
              <b>{tOr('super.importar.vaAImportar', 'Se va a importar:')}</b>
              <span className="super-chip">{r.nombre}</span>
              <span className="super-chip">{tOr('super.importar.codigoOriginal', 'código original')}: {r.codigoOriginal}</span>
              <span className="super-chip">{tOr('super.importar.moneda', 'moneda')}: {r.moneda}</span>
            </div>
            <div className="super-resumen">
              <span className="super-chip">{r.zonas} {tOr('super.importar.zonas', 'zonas')}</span>
              <span className="super-chip">{r.mesas} {tOr('super.importar.mesas', 'mesas')}</span>
              <span className="super-chip">{r.secciones} {tOr('super.importar.secciones', 'secciones')}</span>
              <span className="super-chip">{r.productos} {tOr('super.importar.productos', 'productos')}</span>
              <span className="super-chip">{r.cuentas} {tOr('super.importar.cuentas', 'cuentas')}</span>
              <span className="super-chip">{r.items} {tOr('super.importar.items', 'ítems')}</span>
              <span className="super-chip">{r.pagos} {tOr('super.importar.pagos', 'pagos')}</span>
              <span className="super-chip">{r.turnos} {tOr('super.importar.turnos', 'turnos')}</span>
              <span className="super-chip">{r.equipo} {tOr('super.importar.equipo', 'personas del equipo')}</span>
              <span className="super-chip">{r.insumos} {tOr('super.importar.insumos', 'insumos')}</span>
              <span className="super-chip">{r.recetas} {tOr('super.importar.recetas', 'recetas')}</span>
              <span className="super-chip">{r.devoluciones} {tOr('super.importar.devoluciones', 'devoluciones')}</span>
              {r.proveedores > 0 && <span className="super-chip">{r.proveedores} {tOr('super.importar.proveedores', 'proveedores')}</span>}
              {r.costos > 0 && <span className="super-chip">{r.costos} {tOr('super.importar.costos', 'costos de plato')}</span>}
              {r.deudas > 0 && <span className="super-chip">{r.deudas} {tOr('super.importar.deudas', 'cuentas por pagar')}</span>}
              {r.alertas > 0 && <span className="super-chip">{r.alertas} {tOr('super.importar.alertas', 'alertas')}</span>}
              <span className="super-chip">{zipRef.current ? r.fotos : 0} {tOr('super.importar.fotos', 'fotos')}</span>
            </div>
            <p className="super-ayuda">
              {zipRef.current
                ? tOr('super.importar.notaZip', 'Respaldo completo (.zip): se recrea todo, con las fotos de productos y los comprobantes QR.')
                : tOr('super.importar.notaJson', 'Con un .json se recrea todo menos las fotos (productos y comprobantes quedan sin imagen). Para llevarte las fotos, exporta «Completo (.zip)».')}
            </p>
          </div>
        )}

      <div className="super-dos">
        <label className="super-campo">
          <span>{tOr('super.importar.codigoNuevo', 'Código nuevo de la empresa')}</span>
          <input name="codigo" value={codigo} disabled={ocupadisimo} placeholder="cafe-nuevo"
            onChange={e => { setCodigo(e.target.value); setCreada(null) }} />
        </label>
        <label className="super-campo">
          <span>{tOr('super.importar.claveInicial', 'Clave inicial de los usuarios recreados (opcional)')}</span>
          <input name="clave" value={clave} disabled={ocupadisimo} placeholder="pos12345" onChange={e => setClave(e.target.value)} />
        </label>
      </div>

      {error && <div className="super-error" role="alert">⚠️ {error}</div>}

      <div className="barra">
        <button type="button" className="primary" disabled={!datos.ok || !codigo.trim() || ocupadisimo} onClick={ejecutar}>
          {creando ? (progreso || tOr('super.importar.importando', 'Importando…')) : tOr('super.importar.boton', 'Importar empresa')}
        </button>
        <span className="sp" />
        <span className="super-ayuda">{tOr('super.importar.codigosRepetidos', 'La base rechaza códigos repetidos.')}</span>
      </div>

      {creada && (
        <div className="super-ok">
          ✅ {tOr('super.importar.creadaAntes', 'Empresa')} <b>«{creada.nombre}»</b> {tOr('super.importar.creadaDespues', 'creada con el código')} <b>{creada.codigo}</b>.{' '}
          <button type="button" className="super-ghost" style={{ marginLeft: 8 }} disabled={ocupadisimo}
            onClick={() => onEntrar?.({ id: creada.id, nombre: creada.nombre, mesas: 0, productos: 0, cuentas: 0 })}>
            {tOr('super.importar.entrarAhora', 'Entrar ahora')}
          </button>
          {creada.fotos?.fallidas?.length > 0 && (
            <div className="super-error" role="alert" style={{ marginTop: 6 }}>⚠️ {tOr('super.importar.fotosFallidas', `No se pudieron subir ${creada.fotos.fallidas.length} foto(s).`, { n: creada.fotos.fallidas.length })} {creada.fotos.fallidas.slice(0, 3).join(' · ')}</div>
          )}
          <div className="super-ayuda" style={{ marginTop: 6 }}>{tOr('super.importar.idNuevo', 'Identificador nuevo')}: <code>{creada.id}</code></div>
        </div>
      )}
    </section>
  )
}
