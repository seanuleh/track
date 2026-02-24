import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/pb': {
        target: 'http://localhost:8090',
        rewrite: (path) => path.replace(/^\/pb/, ''),
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
