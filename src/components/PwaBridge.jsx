import { useEffect, useRef } from 'react'
import { useStore } from '../context/StoreContext.jsx'
import { useIdioma } from '../i18n/index.jsx'
import { initNotificaciones, notificarLocal, permisoConcedido, cancelarNotificacion } from '../services/notifications'

const MAX_AVISOS_COCINA = 3

export default function PwaBridge() {
  const { s } = useStore()
  const { t } = useIdioma()

  const avisadosRef = useRef(new Set())

  const estadosRef = useRef(new Map())

  const sembradoRef = useRef(false)

  useEffect(() => { initNotificaciones() }, [])

  const nombreCuenta = (c, mesas) => {
    if (c.tipo === 'directa' || (c.mesaIds || []).length === 0) {
      return c.numero ? t('pwa.pedidoNumero', { n: c.numero }) : (c.canal === 'mostrador' ? t('pwa.mostrador') : t('pwa.ventaDirecta'))
    }
    const nombres = c.mesaIds.map((id) => mesas.find((m) => m.id === id)?.nombre || t('pwa.mesa'))
    return nombres.join(' + ')
  }

  useEffect(() => {
    const cuentas = s.cuentas || []
    const mesas = s.mesas || []

    if (!sembradoRef.current) {
      cuentas.forEach((c) => {
        estadosRef.current.set(c.id, c.estado)
        c.items.forEach((i) => { if (i.estado === 'enviado') avisadosRef.current.add(i.id + ':' + (i.enviadoEn || 0)) })
      })
      sembradoRef.current = true
      return
    }

    if (!permisoConcedido()) {

      cuentas.forEach((c) => {
        estadosRef.current.set(c.id, c.estado)
        c.items.forEach((i) => { if (i.estado === 'enviado') avisadosRef.current.add(i.id + ':' + (i.enviadoEn || 0)) })
      })
      return
    }

    const pendientesCocina = []

    cuentas.forEach((c) => {
      const anterior = estadosRef.current.get(c.id)
      estadosRef.current.set(c.id, c.estado)

      const nuevos = []
      c.items.forEach((i) => {
        if (i.estado !== 'enviado') return
        const clave = i.id + ':' + (i.enviadoEn || 0)
        if (avisadosRef.current.has(clave)) return
        avisadosRef.current.add(clave)
        nuevos.push(i)
      })
      if (nuevos.length) pendientesCocina.push({ cuenta: c, nuevos })

      if (c.estado === 'precuenta' && anterior !== 'precuenta') {
        notificarLocal(t('pwa.tituloPorCobrar'), t('pwa.cuerpoPorCobrar', { cuenta: nombreCuenta(c, mesas) }), '#salon', {
          tag: 'precuenta-' + c.id,
          fijar: true,
        })
      }

      if (anterior === 'precuenta' && c.estado !== 'precuenta') {
        cancelarNotificacion('precuenta-' + c.id)
      }
    })

    if (pendientesCocina.length && pendientesCocina.length <= MAX_AVISOS_COCINA) {
      pendientesCocina.forEach(({ cuenta, nuevos }) => {
        const platos = nuevos.map((i) => i.nombre + ' x' + i.qty).join(', ')
        notificarLocal(t('pwa.tituloCocina'), t('pwa.cuerpoCocina', { cuenta: nombreCuenta(cuenta, mesas), platos }), '#cocina', {
          tag: 'cocina-' + cuenta.id,
        })
      })
    } else if (pendientesCocina.length) {
      const total = pendientesCocina.reduce((acc, p) => acc + p.nuevos.length, 0)
      const nombres = pendientesCocina.map((p) => nombreCuenta(p.cuenta, mesas)).join(', ')
      notificarLocal(t('pwa.tituloCocina'), t('pwa.cuerpoCocinaLote', { cuentas: pendientesCocina.length, items: total, nombres }), '#cocina', {
        tag: 'cocina-lote',
      })
    }
  }, [s.cuentas, s.mesas, t])

  return null
}
