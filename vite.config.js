import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/jira-api': {
        target: 'https://vi-tron.atlassian.net',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers['authorization']) {
              proxyReq.setHeader('authorization', req.headers['authorization'])
            }
          })
        },
        rewrite: (path) => path.replace(/^\/jira-api/, '')
      }
    }
  }
})