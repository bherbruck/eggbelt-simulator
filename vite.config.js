import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/eggbelt-simulator/' : '/',
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
}))
