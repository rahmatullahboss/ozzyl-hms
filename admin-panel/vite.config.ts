import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  build: {
    outDir: '../web/dist/admin',
    emptyOutDir: true,
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
