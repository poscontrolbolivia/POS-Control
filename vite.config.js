import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const BUILD_ID = String(Date.now())
const VERSION = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')).version

const versionJson = () => ({
  name: 'pos-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
  },
})

export default defineConfig({
  plugins: [react(), versionJson()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(VERSION) },
})
