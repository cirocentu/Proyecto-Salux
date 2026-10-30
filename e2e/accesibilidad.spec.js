import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { abrirApp, TEMAS } from './api.js'

// Guardia de regresión de accesibilidad (WCAG 2.1/2.2 AA). Corre en Chromium real porque el
// contraste y el tamaño de los objetivos solo se pueden medir con estilos y geometría reales.
// Si falla, el mensaje dice QUÉ regla y QUÉ elemento: arreglá la pantalla, no la prueba.

const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const VISTAS = {
  paciente: [['Inicio', 'Inicio'], ['Mis turnos', 'Mis turnos'], ['Historial', 'Historial']],
  medico: [['Inicio', 'Inicio'], ['Mi agenda', 'Mi agenda'], ['Mi disponibilidad', 'Mi disponibilidad']],
  admin: [['Inicio', 'Inicio'], ['Administración', 'Administración']],
}

const principal = (page) => page.getByRole('navigation', { name: 'Principal' }).first()

async function esperarEstable(page) {
  await page.waitForLoadState('networkidle')
  // Sin animaciones ni transiciones (la app las apaga con "reducir animaciones") el color
  // medido es el definitivo. Un respiro para que React termine de pintar.
  await page.waitForTimeout(250)
}

async function auditar(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze()
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

for (const rol of Object.keys(VISTAS)) {
  for (const tema of Object.keys(TEMAS)) {
    test(`axe: ${rol} · tema ${tema} · todas las vistas`, async ({ page }) => {
      await abrirApp(page, rol, tema)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      for (const [boton, titulo] of VISTAS[rol]) {
        await principal(page).getByRole('button', { name: boton }).click()
        await expect(page).toHaveTitle(`${titulo} — Salux`)
        await esperarEstable(page)
        expect(await auditar(page), `vista "${titulo}"`).toEqual([])
      }
    })
  }
}

// Pantallas que se abren desde una vista: pestañas y ventanas modales. Cada una se audita
// con el mismo conjunto de reglas.
const EXTRAS = {
  paciente: [
    ['perfil', async (page) => { await page.getByTitle('Ver mi perfil').click() }],
    ['solicitar turno', async (page) => { await principal(page).getByRole('button', { name: 'Solicitar turno' }).click() }],
  ],
  medico: [
    ['perfil', async (page) => { await page.getByTitle('Ver mi perfil').click() }],
  ],
  admin: [
    ['pestaña médicos', async (page) => { await page.getByRole('main').getByRole('button', { name: 'Médicos', exact: true }).click() }],
    ['alta de especialidad / médico', async (page) => { await page.getByRole('button', { name: '+ Especialidad / Médico' }).click() }],
    ['perfil', async (page) => { await page.getByTitle('Ver mi perfil').click() }],
  ],
}

for (const rol of Object.keys(EXTRAS)) {
  for (const tema of Object.keys(TEMAS)) {
    test(`axe: ${rol} · tema ${tema} · pestañas y ventanas`, async ({ page }) => {
      await abrirApp(page, rol, tema)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      if (rol === 'admin') await principal(page).getByRole('button', { name: 'Administración' }).click()
      for (const [nombre, abrir] of EXTRAS[rol]) {
        await abrir(page)
        await esperarEstable(page)
        expect(await auditar(page), nombre).toEqual([])
        if (await page.getByRole('dialog').count()) {
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
      }
    })
  }
}

for (const tema of ['oscuro', 'claro']) {
  test(`axe: pantalla de acceso · tema del sistema ${tema}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema === 'oscuro' ? 'dark' : 'light' })
    await abrirApp(page, null)
    await expect(page.getByRole('main')).toBeVisible()
    await esperarEstable(page)
    expect(await auditar(page)).toEqual([])
  })
}

test.describe('teclado y orientación', () => {
  test('el primer Tab ofrece "Saltar al contenido" y lleva al <main>', async ({ page }) => {
    await abrirApp(page, 'paciente')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Tab')
    const salto = page.getByRole('link', { name: 'Saltar al contenido' })
    await expect(salto).toBeFocused()
    await expect(salto).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('#contenido-principal')).toBeFocused()
  })

  test('el menú marca la vista actual con aria-current y tiene nombre', async ({ page }) => {
    await abrirApp(page, 'paciente')
    const menu = principal(page)
    await expect(menu.getByRole('button', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await menu.getByRole('button', { name: 'Historial' }).click()
    await expect(menu.getByRole('button', { name: 'Historial' })).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByRole('button', { name: 'Inicio' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('al cambiar de vista cambia el título de la pestaña y el foco va al título', async ({ page }) => {
    await abrirApp(page, 'paciente')
    await expect(page).toHaveTitle('Inicio — Salux')
    await principal(page).getByRole('button', { name: 'Mis turnos' }).click()
    await expect(page).toHaveTitle('Mis turnos — Salux')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  })

  test('al cargar la app el foco NO se roba hacia el título', async ({ page }) => {
    await abrirApp(page, 'paciente')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused()
  })

  test('el logo y las tarjetas del inicio se usan solo con teclado', async ({ page }) => {
    await abrirApp(page, 'paciente')
    await principal(page).getByRole('button', { name: 'Historial' }).click()
    await page.getByRole('button', { name: 'Salux, ir al inicio' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveTitle('Inicio — Salux')

    const tarjeta = page.getByRole('main').getByRole('button', { name: /^Mis turnos/ })
    await tarjeta.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveTitle('Mis turnos — Salux')
  })

  test('la tarjeta enfocada muestra un anillo de foco visible', async ({ page }) => {
    await abrirApp(page, 'paciente', 'claro')
    await page.getByRole('main').getByRole('button', { name: /^Historial/ }).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const sombra = await page.getByRole('main').getByRole('button', { name: /^Historial/ })
      .evaluate((b) => getComputedStyle(b.closest('div[class*="relative"]')).boxShadow)
    expect(sombra).not.toBe('none')
  })
})

test.describe('tamaño de los objetivos táctiles (WCAG 2.2 · 2.5.8)', () => {
  for (const rol of Object.keys(VISTAS)) {
    test(`${rol}: todo control visible mide al menos 24×24 px`, async ({ page }) => {
      await abrirApp(page, rol)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      for (const [boton] of VISTAS[rol]) {
        await principal(page).getByRole('button', { name: boton }).click()
        await esperarEstable(page)
        const chicos = await page.evaluate(() => {
          const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem]'
          return [...document.querySelectorAll(sel)]
            .filter((el) => !el.closest('[aria-hidden=true]'))
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            // Los enlaces dentro de un texto y los controles ocultos (sr-only, fuera de pantalla) están exceptuados.
            .filter(({ el, r }) => r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden')
            .filter(({ r }) => r.width < 24 || r.height < 24)
            .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`)
        })
        expect(chicos, `vista "${boton}"`).toEqual([])
      }
    })
  }
})
