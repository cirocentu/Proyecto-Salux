import { defineConfig, devices } from '@playwright/test'

// Pruebas de accesibilidad en un NAVEGADOR REAL (Chromium). Existen porque jsdom (que usan los
// tests de Vitest) no calcula colores ni geometría: ahí no se puede medir el contraste, el
// tamaño de los botones ni el orden de tabulación. La API se simula (e2e/api.js): no hace
// falta backend ni base de datos.
//
//   npm run test:a11y          # corre todo
//   npm run test:a11y:ui       # modo interactivo para depurar
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Se prueba la app COMPILADA (como en producción), no el servidor de desarrollo.
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
