import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDialogo } from './useDialogo'

function Dialogo({ titulo, onClose, children }) {
  const { ref, tituloId } = useDialogo(onClose)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId}>
      <h2 id={tituloId}>{titulo}</h2>
      {children}
    </div>
  )
}

// Una página con un botón que abre un diálogo con tres controles.
function Pagina({ onCerrado = () => {} }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && (
        <Dialogo titulo="Mi diálogo" onClose={() => { setAbierto(false); onCerrado() }}>
          <button>Primero</button>
          <input aria-label="Medio" />
          <button>Último</button>
        </Dialogo>
      )}
    </>
  )
}

describe('useDialogo', () => {
  it('al abrirse, el foco pasa al diálogo, que se anuncia por su título', async () => {
    const user = userEvent.setup()
    render(<Pagina />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))

    const dialogo = screen.getByRole('dialog', { name: 'Mi diálogo' })
    expect(dialogo).toHaveFocus()
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
  })

  it('el primer Tab va al primer control', async () => {
    const user = userEvent.setup()
    render(<Pagina />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus()
  })

  it('Tab no sale del diálogo: del último vuelve al primero', async () => {
    const user = userEvent.setup()
    render(<Pagina />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    screen.getByRole('button', { name: 'Último' }).focus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Abrir' })).not.toHaveFocus()
  })

  it('Shift+Tab desde el primero va al último', async () => {
    const user = userEvent.setup()
    render(<Pagina />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    screen.getByRole('button', { name: 'Primero' }).focus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus()
  })

  it('Shift+Tab desde el propio diálogo también queda adentro', async () => {
    const user = userEvent.setup()
    render(<Pagina />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus()
  })

  it('Escape cierra el diálogo y el foco vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup()
    const onCerrado = vi.fn()
    render(<Pagina onCerrado={onCerrado} />)
    const abrir = screen.getByRole('button', { name: 'Abrir' })
    await user.click(abrir)
    await user.keyboard('{Escape}')

    expect(onCerrado).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(abrir).toHaveFocus()
  })

  it('un diálogo sin controles retiene el foco (Tab no se escapa a la página)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>Fondo</button>
        <Dialogo titulo="Vacío" onClose={() => {}} />
      </>
    )
    const dialogo = screen.getByRole('dialog', { name: 'Vacío' })
    await user.tab()
    expect(dialogo).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Fondo' })).not.toHaveFocus()
  })

  describe('un diálogo encima de otro', () => {
    // El de arriba se abre DESPUÉS, como en la app (ej.: confirmar el borrado de una
    // especialidad desde el modal de alta).
    function Anidados({ cerrarAbajo, cerrarArriba }) {
      const [arriba, setArriba] = useState(false)
      return (
        <Dialogo titulo="Abajo" onClose={cerrarAbajo}>
          <button onClick={() => setArriba(true)}>Abrir el de arriba</button>
          {arriba && (
            <Dialogo titulo="Arriba" onClose={() => { setArriba(false); cerrarArriba() }}>
              <button>Botón de arriba</button>
            </Dialogo>
          )}
        </Dialogo>
      )
    }

    it('Escape cierra solo el de arriba', async () => {
      const user = userEvent.setup()
      const cerrarAbajo = vi.fn()
      const cerrarArriba = vi.fn()
      render(<Anidados cerrarAbajo={cerrarAbajo} cerrarArriba={cerrarArriba} />)
      await user.click(screen.getByRole('button', { name: 'Abrir el de arriba' }))
      await user.keyboard('{Escape}')

      expect(cerrarArriba).toHaveBeenCalledTimes(1)
      expect(cerrarAbajo).not.toHaveBeenCalled()
    })

    it('al cerrar el de arriba, Escape vuelve a cerrar el de abajo', async () => {
      const user = userEvent.setup()
      const cerrarAbajo = vi.fn()
      render(<Anidados cerrarAbajo={cerrarAbajo} cerrarArriba={() => {}} />)
      await user.click(screen.getByRole('button', { name: 'Abrir el de arriba' }))
      await user.keyboard('{Escape}')
      await user.keyboard('{Escape}')
      expect(cerrarAbajo).toHaveBeenCalledTimes(1)
    })

    it('Tab queda dentro del de arriba', async () => {
      const user = userEvent.setup()
      render(<Anidados cerrarAbajo={() => {}} cerrarArriba={() => {}} />)
      await user.click(screen.getByRole('button', { name: 'Abrir el de arriba' }))
      const arriba = screen.getByRole('dialog', { name: 'Arriba' })

      await user.tab()
      await user.tab()
      await user.tab()
      expect(arriba.contains(document.activeElement)).toBe(true)
    })
  })
})
