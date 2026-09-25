import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base relativo: funciona no GitHub Pages (project site) e em localhost
export default defineConfig({
  plugins: [react()],
  base: './',
})
