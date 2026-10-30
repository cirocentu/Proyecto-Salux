import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  api: { perfil: vi.fn(), actualizarPerfil: vi.fn(), actualizarPerfilPaciente: vi.fn(), cambiarContrasena: vi.fn(), logoutTodas: vi.fn() },
}))

import PerfilModal from './PerfilModal'
import { api } from './api'

const USUARIO = { id: 1, nombre: 'Ana Gómez', rol: 'paciente' }
const PERFIL_PACIENTE = { id: 1, email: 'ana@correo.com', nombre: 'Ana Gómez', dni: '30123456', rol: 'paciente', obraSocial: 'OSDE', telefono: '1122334455' }
const PERFIL_MEDICO = { id: 3, email: 'house@correo.com', nombre: 'Dr. House', dni: '25111222', rol: 'medico', matricula: 'MP-77', consultorio: '204' }

async function montar(perfil = PERFIL_PACIENTE, usuario = USUARIO) {
  api.perfil.mockResolvedValue({ usuario: perfil })
  const onClose = vi.fn()
  const onActualizado = vi.fn()
  render(<PerfilModal usuario={usuario} onClose={onClose} onActualizado={onActualizado} />)
  await screen.findByText('Datos personales')
  return { onClose, onActualizado }
}

// Las etiquetas no están asociadas a sus campos: se ubican por valor / posición.
const campoNombre = () => screen.getByDisplayValue('Ana Gómez')
const camposContrasena = () => document.querySelectorAll('input[type="password"]')

describe('carga del perfil', () => {
  it('muestra los datos del usuario y su rol', async () => {
    await montar()
    expect(screen.getByText('Paciente')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ana@correo.com')).toBeDisabled()
    expect(screen.getByDisplayValue('30123456')).toBeDisabled()
    expect(campoNombre()).toBeEnabled()
  })

  it('un paciente ve y puede editar obra social y teléfono', async () => {
    await montar()
    expect(screen.getByDisplayValue('OSDE')).toBeEnabled()
    expect(screen.getByDisplayValue('1122334455')).toBeEnabled()
  })

  it('un médico ve matrícula y consultorio solo de lectura, y no los datos de paciente', async () => {
    await montar(PERFIL_MEDICO, { id: 3, nombre: 'Dr. House', rol: 'medico' })
    expect(screen.getByText('Médico')).toBeInTheDocument()
    expect(screen.getByDisplayValue('MP-77')).toBeDisabled()
    expect(screen.getByDisplayValue('204')).toBeDisabled()
    expect(screen.queryByPlaceholderText('Ej: OSDE')).not.toBeInTheDocument()
  })

  it('un error al cargar se muestra en lugar del formulario', async () => {
    api.perfil.mockRejectedValue(new Error('Sin conexión'))
    render(<PerfilModal usuario={USUARIO} onClose={vi.fn()} onActualizado={vi.fn()} />)
    expect(await screen.findByText(/No se pudo cargar tu perfil: Sin conexión/)).toBeInTheDocument()
    expect(screen.queryByText('Datos personales')).not.toBeInTheDocument()
  })

  it('el botón Cerrar cierra el modal', async () => {
    const user = userEvent.setup()
    const { onClose } = await montar()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('datos personales', () => {
  it('un paciente guarda nombre, obra social y teléfono, y se actualiza el usuario de la sesión', async () => {
    const user = userEvent.setup()
    api.actualizarPerfil.mockResolvedValue({})
    api.actualizarPerfilPaciente.mockResolvedValue({})
    const { onActualizado } = await montar()

    const nombre = campoNombre()
    const obraSocial = screen.getByDisplayValue('OSDE')
    await user.clear(nombre)
    await user.type(nombre, 'Ana María Gómez')
    await user.clear(obraSocial)
    await user.type(obraSocial, 'Swiss Medical')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(api.actualizarPerfil).toHaveBeenCalledWith('Ana María Gómez')
    expect(api.actualizarPerfilPaciente).toHaveBeenCalledWith({ obraSocial: 'Swiss Medical', telefono: '1122334455' })
    expect(await screen.findByText('Datos actualizados con éxito.')).toBeInTheDocument()
    expect(onActualizado).toHaveBeenCalledWith({ ...USUARIO, nombre: 'Ana María Gómez' })
  })

  it('un médico solo cambia el nombre (no llama al endpoint de paciente)', async () => {
    const user = userEvent.setup()
    api.actualizarPerfil.mockResolvedValue({})
    await montar(PERFIL_MEDICO, { id: 3, nombre: 'Dr. House', rol: 'medico' })

    const nombre = screen.getByDisplayValue('Dr. House')
    await user.clear(nombre)
    await user.type(nombre, 'Dr. Gregory House')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(api.actualizarPerfil).toHaveBeenCalledWith('Dr. Gregory House')
    expect(api.actualizarPerfilPaciente).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza los cambios, muestra el error y no actualiza la sesión', async () => {
    const user = userEvent.setup()
    api.actualizarPerfil.mockRejectedValue(new Error('El nombre es obligatorio'))
    api.actualizarPerfilPaciente.mockResolvedValue({})
    const { onActualizado } = await montar()

    await user.type(campoNombre(), ' ')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(onActualizado).not.toHaveBeenCalled()
  })
})

describe('cambiar contraseña', () => {
  async function completar(user, actual, nueva, confirmar) {
    const [campoActual, campoNueva, campoConfirmar] = camposContrasena()
    await user.type(campoActual, actual)
    await user.type(campoNueva, nueva)
    await user.type(campoConfirmar, confirmar)
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
  }

  it('si la confirmación no coincide, avisa y no llama al servidor', async () => {
    const user = userEvent.setup()
    await montar()
    await completar(user, 'Actual-Clave-1234', 'Nueva-Clave-5678', 'Nueva-Clave-0000')
    expect(screen.getByText('La confirmación no coincide con la contraseña nueva.')).toBeInTheDocument()
    expect(api.cambiarContrasena).not.toHaveBeenCalled()
  })

  it('cambia la contraseña y limpia los tres campos', async () => {
    const user = userEvent.setup()
    api.cambiarContrasena.mockResolvedValue({})
    await montar()
    await completar(user, 'Actual-Clave-1234', 'Nueva-Clave-5678', 'Nueva-Clave-5678')

    expect(api.cambiarContrasena).toHaveBeenCalledWith('Actual-Clave-1234', 'Nueva-Clave-5678')
    expect(await screen.findByText('Contraseña actualizada con éxito.')).toBeInTheDocument()
    for (const campo of camposContrasena()) expect(campo).toHaveValue('')
  })

  it('muestra el motivo si el servidor la rechaza (clave actual incorrecta)', async () => {
    const user = userEvent.setup()
    api.cambiarContrasena.mockRejectedValue(new Error('La contraseña actual es incorrecta'))
    await montar()
    await completar(user, 'Equivocada-0000', 'Nueva-Clave-5678', 'Nueva-Clave-5678')
    expect(await screen.findByText('La contraseña actual es incorrecta')).toBeInTheDocument()
  })

  it('la contraseña nueva exige al menos 10 caracteres', async () => {
    await montar()
    const [, nueva, confirmar] = camposContrasena()
    expect(nueva).toHaveAttribute('minlength', '10')
    expect(confirmar).toHaveAttribute('minlength', '10')
  })
})

describe('cerrar sesión en todos los dispositivos', () => {
  const botonTodas = () => screen.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' })

  it('pide confirmación y, si se cancela, no hace nada', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar()
    await user.click(botonTodas())
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('todos los dispositivos'))
    expect(api.logoutTodas).not.toHaveBeenCalled()
  })

  it('al confirmar cierra todas las sesiones y recarga la página', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.logoutTodas.mockResolvedValue({})
    await montar()
    await user.click(botonTodas())

    expect(api.logoutTodas).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    vi.unstubAllGlobals()
  })

  it('si falla, muestra el error y no recarga', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.logoutTodas.mockRejectedValue(new Error('Sesión inválida'))
    await montar()
    await user.click(botonTodas())

    expect(await screen.findByText('Sesión inválida')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
