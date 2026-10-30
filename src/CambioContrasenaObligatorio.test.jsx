import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({ api: { cambiarContrasena: vi.fn() } }))

import CambioContrasenaObligatorio from './CambioContrasenaObligatorio'
import { api } from './api'

const MEDICO = { id: 5, nombre: 'Dr. House', rol: 'medico', debeCambiarContrasena: true }

function montar() {
  const onCambiada = vi.fn()
  const onLogout = vi.fn()
  render(<CambioContrasenaObligatorio usuario={MEDICO} onCambiada={onCambiada} onLogout={onLogout} />)
  const [actual, nueva, confirmar] = document.querySelectorAll('input[type="password"]')
  return { actual, nueva, confirmar, onCambiada, onLogout }
}

const guardar = () => screen.getByRole('button', { name: 'Guardar y continuar' })

describe('cambio de contraseña obligatorio', () => {
  it('saluda por el nombre y explica por qué aparece', () => {
    montar()
    expect(screen.getByText(/Hola Dr\. House/)).toBeInTheDocument()
    expect(screen.getByText(/contraseña inicial/i, { selector: 'p' })).toBeInTheDocument()
  })

  it('exige al menos 10 caracteres en la contraseña nueva', () => {
    const { nueva, confirmar } = montar()
    expect(nueva).toHaveAttribute('minlength', '10')
    expect(confirmar).toHaveAttribute('minlength', '10')
  })

  it('si la confirmación no coincide, avisa y no llama al servidor', async () => {
    const user = userEvent.setup()
    const { actual, nueva, confirmar, onCambiada } = montar()
    await user.type(actual, 'Inicial-Verde-4482')
    await user.type(nueva, 'Definitiva-Roja-7741')
    await user.type(confirmar, 'Definitiva-Roja-0000')
    await user.click(guardar())

    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(api.cambiarContrasena).not.toHaveBeenCalled()
    expect(onCambiada).not.toHaveBeenCalled()
  })

  it('al cambiarla manda actual y nueva, y libera la cuenta', async () => {
    const user = userEvent.setup()
    api.cambiarContrasena.mockResolvedValue({})
    const { actual, nueva, confirmar, onCambiada } = montar()
    await user.type(actual, 'Inicial-Verde-4482')
    await user.type(nueva, 'Definitiva-Roja-7741')
    await user.type(confirmar, 'Definitiva-Roja-7741')
    await user.click(guardar())

    expect(api.cambiarContrasena).toHaveBeenCalledWith('Inicial-Verde-4482', 'Definitiva-Roja-7741')
    expect(onCambiada).toHaveBeenCalledWith({ ...MEDICO, debeCambiarContrasena: false })
  })

  it('muestra el error del servidor (por ejemplo, contraseña débil) y no libera la cuenta', async () => {
    const user = userEvent.setup()
    api.cambiarContrasena.mockRejectedValue(new Error('Es una contraseña demasiado común'))
    const { actual, nueva, confirmar, onCambiada } = montar()
    await user.type(actual, 'Inicial-Verde-4482')
    await user.type(nueva, 'Password12345')
    await user.type(confirmar, 'Password12345')
    await user.click(guardar())

    expect(await screen.findByText('Es una contraseña demasiado común')).toBeInTheDocument()
    expect(onCambiada).not.toHaveBeenCalled()
    expect(guardar()).toBeEnabled()
  })

  it('permite cerrar sesión sin cambiar la contraseña', async () => {
    const user = userEvent.setup()
    const { onLogout } = montar()
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
