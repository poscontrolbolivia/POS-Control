import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
