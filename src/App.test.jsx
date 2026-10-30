import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// La API real se reemplaza entera: estos tests miran qué hace la pantalla, no la red.
vi.mock('./api', () => ({
  api: {
    refrescarSesion: vi.fn(),
    configPublica: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    verificarEmail: vi.fn(),
    reenviarVerificacion: vi.fn(),
    solicitarResetContrasena: vi.fn(),
    resetearContrasena: vi.fn(),
    cambiarContrasena: vi.fn(),
  },
  getUsuarioGuardado: vi.fn(),
  guardarSesion: vi.fn(),
  borrarSesion: vi.fn(),
  actualizarUsuarioGuardado: vi.fn(),
  getPreferenciasAccesibilidad: vi.fn(),
  guardarPreferenciasAccesibilidad: vi.fn(),
}))
vi.mock('./Dashboard', () => ({ default: ({ usuario }) => <div>Panel de {usuario.nombre} ({usuario.rol})</div> }))

import App from './App'
import { api, guardarSesion, borrarSesion, getUsuarioGuardado, getPreferenciasAccesibilidad, guardarPreferenciasAccesibilidad } from './api'

const ANA = { id: 1, nombre: 'Ana Gómez', rol: 'paciente', debeCambiarContrasena: false }

beforeEach(() => {
  getUsuarioGuardado.mockReturnValue(null)
  getPreferenciasAccesibilidad.mockReturnValue({})
  api.refrescarSesion.mockRejectedValue(new Error('Sin sesión'))
  api.configPublica.mockResolvedValue({ data: { requiereVerificacionEmail: false } })
  api.logout.mockResolvedValue({})
})

// Los campos del login no tienen label asociado: se buscan por placeholder.
const campoIdentificador = () => screen.getByPlaceholderText(/30456789 o nombre@email.com/)
const campoContrasena = () => screen.getByPlaceholderText('Ingresá tu contraseña')

async function mostrarLogin() {
  render(<App />)
  await screen.findByRole('button', { name: 'Iniciar sesión' })
}

describe('arranque', () => {
  it('muestra "Cargando..." mientras comprueba si hay sesión', async () => {
    api.refrescarSesion.mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Cargando...')).toBeInTheDocument()
  })

  it('sin sesión válida, muestra el login', async () => {
    await mostrarLogin()
    expect(screen.getByRole('heading', { name: 'Salux' })).toBeInTheDocument()
    expect(borrarSesion).toHaveBeenCalled()
  })

  it('con una sesión que se puede renovar, entra directo al panel', async () => {
    api.refrescarSesion.mockResolvedValue({ token: 'T', usuario: ANA })
    render(<App />)
    expect(await screen.findByText('Panel de Ana Gómez (paciente)')).toBeInTheDocument()
    expect(guardarSesion).toHaveBeenCalledWith('T', ANA)
  })

  it('con un usuario cacheado lo muestra de inmediato, sin pantalla de carga', async () => {
    getUsuarioGuardado.mockReturnValue(ANA)
    api.refrescarSesion.mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Panel de Ana Gómez (paciente)')).toBeInTheDocument()
  })

  it('una cuenta con contraseña inicial ve la pantalla de cambio obligatorio', async () => {
    api.refrescarSesion.mockResolvedValue({ token: 'T', usuario: { ...ANA, rol: 'medico', debeCambiarContrasena: true } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Elegí tu contraseña' })).toBeInTheDocument()
    expect(screen.queryByText(/Panel de/)).not.toBeInTheDocument()
  })
})

describe('login', () => {
  it('ingresa con las credenciales y guarda la sesión', async () => {
    const user = userEvent.setup()
    api.login.mockResolvedValue({ token: 'TOK', usuario: ANA })
    await mostrarLogin()

    await user.type(campoIdentificador(), 'ana@correo.com')
    await user.type(campoContrasena(), 'MiClave-2026x')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(api.login).toHaveBeenCalledWith('ana@correo.com', 'MiClave-2026x')
    expect(await screen.findByText('Panel de Ana Gómez (paciente)')).toBeInTheDocument()
    expect(guardarSesion).toHaveBeenCalledWith('TOK', ANA)
  })

  it('muestra el error del servidor y no entra', async () => {
    const user = userEvent.setup()
    api.login.mockRejectedValue(new Error('Credenciales inválidas'))
    await mostrarLogin()

    await user.type(campoIdentificador(), 'ana@correo.com')
    await user.type(campoContrasena(), 'mala')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument()
    expect(screen.queryByText(/Panel de/)).not.toBeInTheDocument()
  })

  it('deshabilita el botón mientras envía (evita doble envío)', async () => {
    const user = userEvent.setup()
    api.login.mockReturnValue(new Promise(() => {}))
    await mostrarLogin()

    await user.type(campoIdentificador(), 'ana@correo.com')
    await user.type(campoContrasena(), 'MiClave-2026x')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('button', { name: 'Ingresando...' })).toBeDisabled()
  })

  it('el ojito alterna entre ocultar y mostrar la contraseña', async () => {
    const user = userEvent.setup()
    await mostrarLogin()
    expect(campoContrasena()).toHaveAttribute('type', 'password')

    const ojo = campoContrasena().parentElement.querySelector('button')
    await user.click(ojo)
    expect(campoContrasena()).toHaveAttribute('type', 'text')
    await user.click(ojo)
    expect(campoContrasena()).toHaveAttribute('type', 'password')
  })

  it('el enlace de reenviar verificación solo aparece si el servidor la exige', async () => {
    await mostrarLogin()
    expect(screen.queryByText(/Reenviar enlace/)).not.toBeInTheDocument()
  })

  it('con verificación activa permite reenviar el enlace, pidiendo antes el email', async () => {
    const user = userEvent.setup()
    api.configPublica.mockResolvedValue({ data: { requiereVerificacionEmail: true } })
    api.reenviarVerificacion.mockResolvedValue({ message: 'Si la cuenta existe y falta verificarla, te enviamos un nuevo enlace.' })
    await mostrarLogin()

    const boton = await screen.findByText(/Reenviar enlace/)
    await user.click(boton)
    expect(screen.getByText(/Escribí tu email arriba/)).toBeInTheDocument()
    expect(api.reenviarVerificacion).not.toHaveBeenCalled()

    await user.type(campoIdentificador(), 'ana@correo.com')
    await user.click(boton)
    expect(api.reenviarVerificacion).toHaveBeenCalledWith('ana@correo.com')
    expect(await screen.findByText(/te enviamos un nuevo enlace/)).toBeInTheDocument()
  })
})

describe('registro', () => {
  async function completarRegistro(user) {
    await user.click(screen.getByRole('button', { name: 'Crear una cuenta' }))
    await user.type(screen.getByPlaceholderText('Ej: Juan Pérez'), 'Ana Gómez')
    await user.type(screen.getByPlaceholderText('Ej: 30456789'), '30123456')
    await user.type(screen.getByPlaceholderText('Ej: nombre@email.com'), 'ana@correo.com')
    await user.type(screen.getByPlaceholderText('Mínimo 10 caracteres'), 'Zorro-Azul-4721')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
  }

  it('sin verificación de email: crea la cuenta e inicia sesión', async () => {
    const user = userEvent.setup()
    api.register.mockResolvedValue({ ok: true })
    api.login.mockResolvedValue({ token: 'TOK', usuario: ANA })
    await mostrarLogin()
    await completarRegistro(user)

    expect(api.register).toHaveBeenCalledWith({ email: 'ana@correo.com', dni: '30123456', contrasena: 'Zorro-Azul-4721', nomYape: 'Ana Gómez' })
    expect(api.login).toHaveBeenCalledWith('ana@correo.com', 'Zorro-Azul-4721')
    expect(await screen.findByText('Panel de Ana Gómez (paciente)')).toBeInTheDocument()
  })

  it('con verificación de email: avisa, vuelve al login y NO inicia sesión', async () => {
    const user = userEvent.setup()
    api.register.mockResolvedValue({ ok: true, requiereVerificacion: true, message: 'Te enviamos un email para activar tu cuenta.' })
    await mostrarLogin()
    await completarRegistro(user)

    expect(await screen.findByText('Te enviamos un email para activar tu cuenta.')).toBeInTheDocument()
    expect(api.login).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('muestra los errores de validación del servidor', async () => {
    const user = userEvent.setup()
    api.register.mockRejectedValue(new Error('contrasena: Es una contraseña demasiado común'))
    await mostrarLogin()
    await completarRegistro(user)
    expect(await screen.findByText(/demasiado común/)).toBeInTheDocument()
  })

  it('se puede volver del registro al login', async () => {
    const user = userEvent.setup()
    await mostrarLogin()
    await user.click(screen.getByRole('button', { name: 'Crear una cuenta' }))
    await user.click(screen.getByRole('button', { name: 'Ya tengo una cuenta' }))
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })
})

describe('recuperar contraseña', () => {
  it('pide el email y muestra la respuesta del servidor', async () => {
    const user = userEvent.setup()
    api.solicitarResetContrasena.mockResolvedValue({ message: 'Si ese email está registrado, te enviamos un enlace.' })
    await mostrarLogin()

    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    await user.type(screen.getByPlaceholderText('Ej: nombre@email.com'), 'ana@correo.com')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(api.solicitarResetContrasena).toHaveBeenCalledWith('ana@correo.com')
    expect(await screen.findByText(/te enviamos un enlace/)).toBeInTheDocument()
  })

  describe('con el enlace del mail (?reset=TOKEN)', () => {
    beforeEach(() => { window.history.pushState({}, '', '/?reset=TOKEN-DEL-MAIL') })

    it('arranca directo en la pantalla de nueva contraseña', async () => {
      render(<App />)
      expect(await screen.findByRole('button', { name: 'Guardar contraseña nueva' })).toBeInTheDocument()
    })

    it('si las contraseñas no coinciden, no llama al servidor', async () => {
      const user = userEvent.setup()
      render(<App />)
      await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
      const [nueva, confirmar] = document.querySelectorAll('input[type="password"]')
      await user.type(nueva, 'Zorro-Azul-4721')
      await user.type(confirmar, 'Otra-Distinta-9988')
      await user.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }))

      expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument()
      expect(api.resetearContrasena).not.toHaveBeenCalled()
    })

    it('con contraseñas iguales usa el token del enlace, limpia la URL y vuelve al login', async () => {
      const user = userEvent.setup()
      api.resetearContrasena.mockResolvedValue({})
      render(<App />)
      await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
      const [nueva, confirmar] = document.querySelectorAll('input[type="password"]')
      await user.type(nueva, 'Zorro-Azul-4721')
      await user.type(confirmar, 'Zorro-Azul-4721')
      await user.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }))

      expect(api.resetearContrasena).toHaveBeenCalledWith('TOKEN-DEL-MAIL', 'Zorro-Azul-4721')
      expect(await screen.findByText('Contraseña actualizada. Ya podés iniciar sesión.')).toBeInTheDocument()
      expect(window.location.search).toBe('')
      expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
    })

    it('si el enlace venció muestra el error del servidor', async () => {
      const user = userEvent.setup()
      api.resetearContrasena.mockRejectedValue(new Error('El enlace no es válido o ya venció. Pedí uno nuevo.'))
      render(<App />)
      await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
      const [nueva, confirmar] = document.querySelectorAll('input[type="password"]')
      await user.type(nueva, 'Zorro-Azul-4721')
      await user.type(confirmar, 'Zorro-Azul-4721')
      await user.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }))
      expect(await screen.findByText(/ya venció/)).toBeInTheDocument()
    })
  })
})

describe('verificación de email (?verificar=TOKEN)', () => {
  beforeEach(() => { window.history.pushState({}, '', '/?verificar=TOKEN-ACTIVAR') })

  it('confirma el email una sola vez y muestra el resultado', async () => {
    api.verificarEmail.mockResolvedValue({ message: 'Email verificado. Ya podés iniciar sesión.' })
    render(<App />)
    expect(await screen.findByText('Email verificado. Ya podés iniciar sesión.')).toBeInTheDocument()
    expect(api.verificarEmail).toHaveBeenCalledTimes(1)
    expect(api.verificarEmail).toHaveBeenCalledWith('TOKEN-ACTIVAR')
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('si el enlace es inválido muestra el error', async () => {
    api.verificarEmail.mockRejectedValue(new Error('El enlace no es válido o ya venció. Pedí uno nuevo.'))
    render(<App />)
    expect(await screen.findByText(/ya venció/)).toBeInTheDocument()
  })

  it('ofrece ir a iniciar sesión', async () => {
    const user = userEvent.setup()
    api.verificarEmail.mockResolvedValue({ message: 'Email verificado.' })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Ir a iniciar sesión' }))
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })
})

describe('accesibilidad', () => {
  it('el modo adulto mayor se recuerda entre visitas', async () => {
    getPreferenciasAccesibilidad.mockReturnValue({ modoAdultoMayor: true })
    await mostrarLogin()
    expect(screen.getByRole('heading', { name: 'Salux' })).toHaveClass('text-4xl')
  })

  it('al activar el modo adulto mayor se guarda la preferencia y crece el texto', async () => {
    const user = userEvent.setup()
    await mostrarLogin()
    expect(screen.getByRole('heading', { name: 'Salux' })).toHaveClass('text-2xl')

    const interruptor = screen.getByText('Modo adulto mayor').nextElementSibling
    await user.click(interruptor)

    expect(guardarPreferenciasAccesibilidad).toHaveBeenCalledWith({ modoAdultoMayor: true })
    expect(screen.getByRole('heading', { name: 'Salux' })).toHaveClass('text-4xl')
  })
})
