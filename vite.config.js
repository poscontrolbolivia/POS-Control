import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Identificador de ESTA compilación: la app lo compara con /version.json (que se publica con cada
// build) para avisar «hay una versión nueva» sin depender del service worker.
const BUILD_ID = String(Date.now())

const versionJson = () => ({
  name: 'pos-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
  },
})

export default defineConfig({
  plugins: [react(), versionJson()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
