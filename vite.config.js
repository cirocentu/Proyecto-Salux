/* global process */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Los horarios de los turnos se piensan en hora Argentina: los tests corren
// siempre en esa zona, sin importar dónde estén (CI en UTC, tu máquina, etc.).
process.env.TZ = 'America/Argentina/Buenos_Aires'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx'],
    },
  },
})
