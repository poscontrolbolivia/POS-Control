import { useRef, useState } from 'react'
import { importarEmpresa, leerArchivoRespaldo, validarSnapshot } from '../../../services/super/superApi.js'
import { useIdioma } from '../../../i18n/index.jsx'
import './SuperPage.css'

// Importar una empresa = elegir UN archivo. Las instrucciones dicen qué debe contener; el resto se deduce.
export default function ImportBlock({ ocupado = false, onEntrar }) {
  const { tOr } = useIdioma()
  const [datos, setDatos] = useState(null)
  const [revision, setRevision] = useState(null)
  const [archivo, setArchivo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [errorArchivo, setErrorArchivo] = useState('')
  const [creando, setCreando] = useState(false)
  const [creada, setCreada] = useState(null)
  const [error, setError] = useState('')
  const [progreso, setProgreso] = useState('')
  const zipRef = useRef(null)
  const entrada = useRef(null)

  const ocupadisimo = ocupado || creando

  const limpiar = () => {
    zipRef.current = null
    setDatos(null); setRevision(null); setArchivo(''); setCodigo(''); setError(''); setErrorArchivo('')
    if (entrada.current) entrada.current.value = ''
  }

  const cargarArchivo = async f => {
    if (!f) return
    limpiar(); setCreada(null)
    try {
      const { datos: leido, zip } = await leerArchivoRespaldo(f)
      const rev = validarSnapshot(leido)
      zipRef.current = zip
      setDatos(leido); setRevision(rev); setArchivo(f.name)
      const orig = String(leido?.empresa?.codigo || leido?.empresa?.nombre || '').trim()
      if (orig) setCodigo(`${orig}-2`)
    } catch (e) {
      setErrorArchivo(e?.message || tOr('super.importar.errorArchivo', 'No se pudo leer el archivo.'))
    }
  }

  const ejecutar = async () => {
    if (!revision?.ok) return
    setError(''); setCreando(true)
    try {
      const { id, fotos } = await importarEmpresa(datos, codigo, '', {
        zip: zipRef.current,
        onProgreso: (h, t) => setProgreso(tOr('super.importar.subiendoFotos', `Subiendo fotos… ${h}/${t}`, { hechas: h, total: t })),
      })
      setCreada({ id, nombre: revision.resumen.nombre, codigo: codigo.trim().toLowerCase(), fotos })
      limpiar()
    } catch (e) {
      setError(e?.message || tOr('super.importar.errorImport', 'No se pudo importar la empresa.'))
    } finally { setCreando(false); setProgreso('') }
  }

  const r = revision?.resumen

  return (
    <section className="panel super-bloque">
      <div className="super-titulo-bloque">
        <h3>{tOr('super.importar.titulo', 'Importar una empresa')}</h3>
      </div>

      <div className="super-instrucciones">
        <p className="super-ayuda"><b>{tOr('super.importar.queArchivo', '¿Qué archivo elegir?')}</b></p>
        <ul className="super-ayuda">
          <li>{tOr('super.importar.ins1', 'Un respaldo creado en esta misma pantalla con «Exportar» (.json) o «Completo (.zip)».')}</li>
          <li>{tOr('super.importar.ins2', 'Debe traer los datos de la empresa: nombre, zonas, mesas, carta, cuentas y equipo.')}</li>
          <li>{tOr('super.importar.ins3', 'El .zip incluye también las fotos; con el .json la empresa se crea igual, pero sin fotos.')}</li>
          <li>{tOr('super.importar.ins4', 'Se crea como una empresa NUEVA con otro código; la original no se toca. Los usuarios que falten entran con la clave pos12345.')}</li>
        </ul>
      </div>

      <div className="super-centro" style={{ justifyContent: 'flex-start' }}>
        <input name="file" ref={entrada} type="file" hidden accept="application/json,.json,application/zip,.zip"
          onChange={e => cargarArchivo(e.target.files?.[0])} />
        <button type="button" className="primary" disabled={ocupadisimo} onClick={() => entrada.current?.click()}>
          📁 {archivo ? tOr('super.importar.otroArchivo', 'Elegir otro archivo') : tOr('super.importar.elegir', 'Seleccionar archivo')}
        </button>
        {archivo && <span className="super-chip">{archivo}</span>}
      </div>

      {errorArchivo && <div className="super-error" role="alert">⚠️ {errorArchivo}</div>}
      {revision && !revision.ok && <div className="super-error" role="alert">⚠️ {revision.problemas.join(' · ')}</div>}

      {revision?.ok && (
        <div className="super-bloque">
          <div className="super-resumen">
            <b>{r.nombre}</b>
            <span className="super-chip">{r.mesas} {tOr('super.importar.mesas', 'mesas')}</span>
            <span className="super-chip">{r.productos} {tOr('super.importar.productos', 'productos')}</span>
            <span className="super-chip">{r.cuentas} {tOr('super.importar.cuentas', 'cuentas')}</span>
            <span className="super-chip">{r.equipo} {tOr('super.importar.equipo', 'personas del equipo')}</span>
            <span className="super-chip">{zipRef.current ? r.fotos : 0} {tOr('super.importar.fotos', 'fotos')}</span>
          </div>
          <label className="super-campo">
            <span>{tOr('super.importar.codigoNuevo', 'Código nuevo de la empresa')}</span>
            <input name="codigo" value={codigo} disabled={ocupadisimo} placeholder="cafe-nuevo"
              onChange={e => { setCodigo(e.target.value); setError('') }} />
            <span className="super-ayuda">{tOr('super.importar.codigosRepetidos', 'La base rechaza códigos repetidos.')}</span>
          </label>
          {error && <div className="super-error" role="alert">⚠️ {error}</div>}
          <div className="super-centro" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="primary" disabled={!codigo.trim() || ocupadisimo} onClick={ejecutar}>
              {creando ? (progreso || tOr('super.importar.importando', 'Importando…')) : tOr('super.importar.boton', 'Importar empresa')}
            </button>
            <button type="button" className="super-ghost" disabled={ocupadisimo} onClick={limpiar}>{tOr('super.importar.limpiar', 'Cancelar')}</button>
          </div>
        </div>
      )}

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
        </div>
      )}
    </section>
  )
}
