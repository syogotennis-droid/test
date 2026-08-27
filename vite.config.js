import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readFileSync, writeFileSync } from 'fs'

function swVersionPlugin() {
  return {
    name: 'sw-version-bump',
    closeBundle() {
      try {
        const sw = readFileSync('dist/sw.js', 'utf8')
        writeFileSync('dist/sw.js', sw.replace(/qr-kintai-v[\w-]+/, `qr-kintai-v${Date.now()}`))
      } catch {}
    }
  }
}

export default defineConfig({
  server: {
    https: true,
    host: true
  },
  plugins: [
    basicSsl(),
    react(),
    swVersionPlugin()
  ]
})
