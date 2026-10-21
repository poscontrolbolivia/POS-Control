import { useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { sb } from '../../../services/supabaseClient.js'
import { useIdioma } from '../../../i18n/index.jsx'
import { comprimirComprobante, subirComprobante, blobADataUrl, urlComprobante } from '../../../services/comprobante.js'

// Opcional: tomar foto, subir una o no poner nada. Avisa al padre con { comprobante, subiendo }.
export default function ComprobanteQr({ valor, onCambio }) {
  const { s, modo } = useStore()
  const { t } = useIdioma()
  const camara = useRef(null)
  const galeria = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [vista, setVista] = useState(null)

  const elegir = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setError(''); setSubiendo(true); onCambio({ comprobante: valor || '', subiendo: true })
    try {
      const blob = await comprimirComprobante(file)
      let ref
      if (modo === 'supabase') ref = await subirComprobante(sb, s._empresaId, blob)
      else ref = await blobADataUrl(blob)
      setVista(await blobADataUrl(blob))
      onCambio({ comprobante: ref, subiendo: false })
    } catch (err) {
      setError(t(err?.message === 'too-big' ? 'comp.pesada' : 'comp.error'))
      onCambio({ comprobante: valor || '', subiendo: false })
    } finally { setSubiendo(false) }
  }
  const quitar = () => { setVista(null); setError(''); onCambio({ comprobante: '', subiendo: false }) }

  return (
    <div className="cq">
      <input name="file" ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={elegir} />
      <input name="file" ref={galeria} type="file" accept="image/*" hidden onChange={elegir} />
      {valor ? (
        <>
          {vista && <img className="cq-mini" src={vista} alt={t('comp.titulo')} />}
          <span className="cq-ok">✓ {t('comp.adjunto')}</span>
          <button type="button" className="ghost" onClick={() => camara.current?.click()} disabled={subiendo}>{t('comp.cambiar')}</button>
          <button type="button" className="danger" onClick={quitar} disabled={subiendo}>{t('comp.quitar')}</button>
        </>
      ) : subiendo ? (
        <span role="status">{t('comp.subiendo')}</span>
      ) : (
        <>
          <button type="button" className="info" onClick={() => camara.current?.click()}>📷 {t('comp.tomar')}</button>
          <button type="button" className="info" onClick={() => galeria.current?.click()}>🖼 {t('comp.subir')}</button>
          <small className="cq-omitir">{t('comp.omitir')}</small>
        </>
      )}
      {error && <small className="cq-error" role="alert">{error}</small>}
    </div>
  )
}

// Botón «ver comprobante» para un pago ya cobrado.
export function VerComprobante({ valor }) {
  const { t } = useIdioma()
  const [cargando, setCargando] = useState(false)
  if (!valor) return null
  const abrir = async () => {
    setCargando(true)
    try { const u = await urlComprobante(sb, valor); if (u) window.open(u, '_blank', 'noopener') } catch { /* sin permiso o no existe */ } finally { setCargando(false) }
  }
  return <button type="button" className="ghost cq-ver" onClick={abrir} disabled={cargando} title={t('comp.ver')}>📎</button>
}
