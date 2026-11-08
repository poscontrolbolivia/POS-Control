import { useEffect, useState, useSyncExternalStore } from 'react'
import { conexion } from '../../services/conexionApp.js'
import { useIdioma } from '../../i18n/index.jsx'

// Estado de la conexión para cualquier pantalla: const { enLinea } = useConexion()
export function useConexion() {
  const st = useSyncExternalStore(conexion.subscribe, conexion.get, conexion.get)
  return { enLinea: st.enLinea, desde: st.desde, volvioEn: st.volvioEn }
}

// Franja fija arriba (dentro del encabezado, así se ve aunque se baje la pantalla). Sin conexión: explica qué queda
// bloqueado y deja reintentar. Al volver, confirma unos segundos y desaparece.
export default function AvisoConexion() {
  const { t } = useIdioma()
  const { enLinea, volvioEn } = useConexion()
  const [recien, setRecien] = useState(false)
  useEffect(() => {
    if (!volvioEn || Date.now() - volvioEn > 4000) return undefined
    setRecien(true)
    const id = setTimeout(() => setRecien(false), 4000)
    return () => clearTimeout(id)
  }, [volvioEn])

  if (!enLinea) {
    return (
      <div className="net-aviso net-off" role="alert">
        <b>{t('conexion.sin')}</b>
        <span>{t('conexion.detalle')}</span>
        <button type="button" className="ghost" onClick={() => conexion.revisar()}>{t('conexion.reintentar')}</button>
      </div>
    )
  }
  if (recien) return <div className="net-aviso net-on" role="status">{t('conexion.volvio')}</div>
  return null
}
