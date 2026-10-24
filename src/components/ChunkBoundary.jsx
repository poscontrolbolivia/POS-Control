import { Component } from 'react'
import { limpiarCachesApp } from '../services/lazyRetry.js'

// Si una pantalla no carga (versión nueva publicada, sin red…), en vez de quedarse colgada
// muestra un aviso con un botón que limpia la caché de la app y recarga.
export default class ChunkBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  recargar = async () => {
    try { sessionStorage.removeItem('pos-chunk-reload') } catch { /* noop */ }
    await limpiarCachesApp()
    window.location.reload()
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="auth-aviso" role="alert" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <b>No se pudo cargar esta pantalla.</b>
        <span>Probablemente hay una versión nueva de la app. Recarga para actualizarla.</span>
        <button type="button" className="primary" onClick={this.recargar}>Recargar y actualizar</button>
      </div>
    )
  }
}
