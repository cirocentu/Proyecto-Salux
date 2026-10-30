import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  api: {
    refrescarSesion: vi.fn(), configPublica: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(),
    verificarEmail: vi.fn(), reenviarVerificacion: vi.fn(), solicitarResetContrasena: vi.fn(), resetearContrasena: vi.fn(),
    cambiarContrasena: vi.fn(), perfil: vi.fn(), actualizarPerfil: vi.fn(), actualizarPerfilPaciente: vi.fn(), logoutTodas: vi.fn(),
    especialidades: vi.fn(), medicos: vi.fn(), disponibilidadDeMedico: vi.fn(), actualizarMedico: vi.fn(),
    crearEspecialidad: vi.fn(), eliminarEspecialidad: vi.fn(), crearMedico: vi.fn(), misTurnos: vi.fn(),
  },
  getUsuarioGuardado: vi.fn(),
  guardarSesion: vi.fn(),
  borrarSesion: vi.fn(),
  actualizarUsuarioGuardado: vi.fn(),
  getPreferenciasAccesibilidad: vi.fn(),
  guardarPreferenciasAccesibilidad: vi.fn(),
}))

import App from './App'
import CambioContrasenaObligatorio from './CambioContrasenaObligatorio'
import PerfilModal from './PerfilModal'
import EditarMedicoModal from './EditarMedicoModal'
import AdminAltaModal from './AdminAltaModal'
import NuevoTurnoModal from './NuevoTurnoModal'
import ReprogramarTurnoModal from './ReprogramarTurnoModal'
import Dashboard from './Dashboard'
import { campoDelError } from './campos'
import { api, getUsuarioGuardado, getPreferenciasAccesibilidad } from './api'

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// El "*" de obligatorio forma parte del texto del label (aunque esté oculto para lectores).
const campo = (nombre) => screen.getByLabelText(new RegExp(`^${escapar(nombre)}\\s*\\*?$`))

// Error del servidor con el detalle por campo, como lo arma api.js.
const errorConCampos = (mensaje, ...campos) =>
  Object.assign(new Error(mensaje), { campos: campos.map((c) => ({ campo: c, mensaje: `${c} inválido` })) })

const CARDIOLOGIA = { idEspecialidad: 1, nombre: 'Cardiología', medicos: [] }
const PEDIATRIA = { idEspecialidad: 2, nombre: 'Pediatría', medicos: [] }
const MEDICO = { idMedico: 10, consultorio: 'A', duracionTurnoMinutos: 30, usuario: { nomYape: 'Dra. Corazón' }, especialidades: [] }
const TURNO = { id: 1, medicoId: 10, medico: 'Dra. Corazón', especialidad: 'Cardiología', fecha: 'Jueves', hora: '10:00 hs' }
const PERFIL = { id: 1, email: 'a@b.com', nombre: 'Ana', dni: '30123456', rol: 'paciente', obraSocial: '', telefono: '' }

beforeEach(() => {
  getUsuarioGuardado.mockReturnValue(null)
  getPreferenciasAccesibilidad.mockReturnValue({})
  api.refrescarSesion.mockRejectedValue(new Error('Sin sesión'))
  api.configPublica.mockResolvedValue({ data: { requiereVerificacionEmail: false } })
  api.especialidades.mockResolvedValue({ data: [CARDIOLOGIA, PEDIATRIA] })
  api.medicos.mockResolvedValue({ data: [] })
  api.disponibilidadDeMedico.mockResolvedValue({ data: { disponibilidades: [], ausencias: [] } })
  api.perfil.mockResolvedValue({ usuario: PERFIL })
  api.misTurnos.mockResolvedValue({ data: [] })
})

// ---------------------------------------------------------------------------
describe('campoDelError', () => {
  const mapa = { dni: 'id-dni', email: 'id-email' }

  it('devuelve el id del primer campo del error que se conoce', () => {
    expect(campoDelError(errorConCampos('x', 'otro', 'email', 'dni'), mapa)).toBe('id-email')
  })
  it('devuelve null si el error no trae campos o no coinciden', () => {
    expect(campoDelError(new Error('x'), mapa)).toBeNull()
    expect(campoDelError(errorConCampos('x', 'desconocido'), mapa)).toBeNull()
    expect(campoDelError(undefined, mapa)).toBeNull()
  })
  it('ignora los campos mapeados a null', () => {
    expect(campoDelError(errorConCampos('x', 'dni'), { dni: null })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('cerrar con clic en el fondo', () => {
  const fondoDe = (dialogo) => dialogo.parentElement

  it('el asistente de turnos se cierra al presionar el fondo, no el panel', async () => {
    const onClose = vi.fn()
    render(<NuevoTurnoModal onClose={onClose} onCreado={vi.fn()} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Solicitar turno' })

    fireEvent.mouseDown(dialogo)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(fondoDe(dialogo))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reprogramar también', async () => {
    const onClose = vi.fn()
    render(<ReprogramarTurnoModal turno={TURNO} onClose={onClose} onReprogramado={vi.fn()} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Reprogramar turno' })
    fireEvent.mouseDown(fondoDe(dialogo))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('seleccionar texto dentro del panel y soltar el mouse afuera NO lo cierra', async () => {
    const onClose = vi.fn()
    render(<NuevoTurnoModal onClose={onClose} onCreado={vi.fn()} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Solicitar turno' })

    fireEvent.mouseDown(dialogo) // empieza adentro
    fireEvent.mouseUp(fondoDe(dialogo)) // termina en el fondo
    fireEvent.click(fondoDe(dialogo)) // el navegador dispara el clic en el ancestro común
    expect(onClose).not.toHaveBeenCalled()
  })

  it('las confirmaciones del panel se descartan con el fondo, sin ejecutar la acción', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    render(<Dashboard usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onLogout={onLogout} onUsuarioActualizado={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Salir' }))
    const alerta = screen.getByRole('alertdialog', { name: '¿Cerrar sesión?' })

    fireEvent.mouseDown(fondoDe(alerta))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('en la confirmación de borrar una especialidad, el fondo cierra solo esa confirmación', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AdminAltaModal onClose={onClose} />)
    await user.click((await screen.findByText('Cardiología')).closest('li').querySelector('button'))
    const confirmacion = screen.getByRole('dialog', { name: '¿Eliminar "Cardiología"?' })

    fireEvent.mouseDown(fondoDe(confirmacion))
    expect(screen.queryByRole('dialog', { name: '¿Eliminar "Cardiología"?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Agregar al sistema' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(api.eliminarEspecialidad).not.toHaveBeenCalled()
  })

  it.each([
    ['perfil', (onClose) => <PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={onClose} onActualizado={vi.fn()} />, 'Mi perfil'],
    ['edición de médico', (onClose) => <EditarMedicoModal medico={MEDICO} onClose={onClose} onActualizado={vi.fn()} />, 'Editar médico'],
    ['alta de especialidades y médicos', (onClose) => <AdminAltaModal onClose={onClose} />, 'Agregar al sistema'],
  ])('%s NO se cierra con el fondo (tiene datos escritos que perder)', async (_n, montar, titulo) => {
    const onClose = vi.fn()
    render(montar(onClose))
    const dialogo = await screen.findByRole('dialog', { name: titulo })
    fireEvent.mouseDown(fondoDe(dialogo))
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe('el foco va al campo con error', () => {
  describe('cambio de contraseña obligatorio', () => {
    const montar = () => render(<CambioContrasenaObligatorio usuario={{ nombre: 'Dr. House' }} onCambiada={vi.fn()} onLogout={vi.fn()} />)

    async function completar(user, nueva, confirmar) {
      await user.type(screen.getByLabelText(/Contraseña inicial/), 'Inicial-Verde-4482')
      await user.type(campo('Contraseña nueva'), nueva)
      await user.type(screen.getByLabelText(/Repetí la contraseña nueva/), confirmar)
      await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    }

    it('si la confirmación no coincide, el foco va a la confirmación, marcada y enlazada al error', async () => {
      const user = userEvent.setup()
      montar()
      await completar(user, 'Definitiva-Roja-7741', 'Definitiva-Roja-0000')

      const confirmar = screen.getByLabelText(/Repetí la contraseña nueva/)
      expect(confirmar).toHaveFocus()
      expect(confirmar).toBeInvalid() // aria-invalid
      expect(confirmar).toHaveAccessibleDescription('Las contraseñas no coinciden.')
    })

    it('al corregir y reenviar, la marca de error desaparece', async () => {
      const user = userEvent.setup()
      api.cambiarContrasena.mockResolvedValue({})
      montar()
      await completar(user, 'Definitiva-Roja-7741', 'Definitiva-Roja-0000')
      const confirmar = screen.getByLabelText(/Repetí la contraseña nueva/)
      expect(confirmar).toHaveAttribute('aria-invalid', 'true')

      await user.clear(confirmar)
      await user.type(confirmar, 'Definitiva-Roja-7741')
      await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
      expect(confirmar).not.toHaveAttribute('aria-invalid')
    })

    it('si el servidor rechaza la contraseña nueva, el foco va a ese campo y conserva su ayuda', async () => {
      const user = userEvent.setup()
      api.cambiarContrasena.mockRejectedValue(errorConCampos('contrasenaNueva: Es una contraseña demasiado común', 'contrasenaNueva'))
      montar()
      await completar(user, 'Password12345', 'Password12345')

      const nueva = campo('Contraseña nueva')
      expect(nueva).toHaveFocus()
      expect(nueva).toHaveAttribute('aria-invalid', 'true')
      expect(nueva).toHaveAccessibleDescription(/Mínimo 10 caracteres.*demasiado común/)
    })
  })

  describe('pantalla de acceso', () => {
    async function irA(user, nombreBoton) {
      render(<App />)
      await user.click(await screen.findByRole('button', { name: nombreBoton }))
    }

    it('registro: un DNI rechazado por el servidor recibe el foco', async () => {
      const user = userEvent.setup()
      api.register.mockRejectedValue(errorConCampos('dni: El DNI debe tener entre 7 y 9 dígitos', 'dni'))
      await irA(user, 'Crear una cuenta')
      await user.type(campo('Nombre completo'), 'Ana Gómez')
      await user.type(campo('DNI'), '123')
      await user.type(campo('Email'), 'ana@correo.com')
      await user.type(campo('Contraseña'), 'Zorro-Azul-4721')
      await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))

      await vi.waitFor(() => expect(campo('DNI')).toHaveFocus())
      expect(campo('DNI')).toHaveAttribute('aria-invalid', 'true')
      expect(campo('DNI')).toHaveAccessibleDescription(/El DNI debe tener entre 7 y 9 dígitos/)
    })

    it('registro: si el error es de la contraseña, el foco va a la contraseña', async () => {
      const user = userEvent.setup()
      api.register.mockRejectedValue(errorConCampos('contrasena: Es una contraseña demasiado común', 'contrasena'))
      await irA(user, 'Crear una cuenta')
      await user.type(campo('Nombre completo'), 'Ana Gómez')
      await user.type(campo('DNI'), '30123456')
      await user.type(campo('Email'), 'ana@correo.com')
      await user.type(campo('Contraseña'), 'Password12345')
      await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
      await vi.waitFor(() => expect(campo('Contraseña')).toHaveFocus())
    })

    it('registro: un error sin campo (por ejemplo, sin conexión) no mueve el foco ni marca nada', async () => {
      const user = userEvent.setup()
      api.register.mockRejectedValue(new Error('No se pudo conectar con el servidor'))
      await irA(user, 'Crear una cuenta')
      await user.type(campo('Nombre completo'), 'Ana Gómez')
      await user.type(campo('DNI'), '30123456')
      await user.type(campo('Email'), 'ana@correo.com')
      await user.type(campo('Contraseña'), 'Zorro-Azul-4721')
      await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar')
      expect(document.querySelector('[aria-invalid]')).toBeNull()
    })

    it('nueva contraseña: la confirmación distinta recibe el foco', async () => {
      const user = userEvent.setup()
      window.history.pushState({}, '', '/?reset=TOKEN')
      render(<App />)
      await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
      await user.type(campo('Contraseña nueva'), 'Zorro-Azul-4721')
      await user.type(campo('Confirmar contraseña'), 'Otra-Distinta-9988')
      await user.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }))

      expect(campo('Confirmar contraseña')).toHaveFocus()
      expect(campo('Confirmar contraseña')).toHaveAccessibleDescription('Las contraseñas no coinciden.')
    })

    it('nueva contraseña: si el servidor la rechaza, el foco va a la contraseña nueva', async () => {
      const user = userEvent.setup()
      api.resetearContrasena.mockRejectedValue(errorConCampos('contrasenaNueva: Demasiado común', 'contrasenaNueva'))
      window.history.pushState({}, '', '/?reset=TOKEN')
      render(<App />)
      await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
      await user.type(campo('Contraseña nueva'), 'Password12345')
      await user.type(campo('Confirmar contraseña'), 'Password12345')
      await user.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }))
      await vi.waitFor(() => expect(campo('Contraseña nueva')).toHaveFocus())
    })

    it('al cambiar de pantalla se limpia la marca de error', async () => {
      const user = userEvent.setup()
      api.register.mockRejectedValue(errorConCampos('dni: inválido', 'dni'))
      await irA(user, 'Crear una cuenta')
      await user.type(campo('Nombre completo'), 'Ana')
      await user.type(campo('DNI'), '1')
      await user.type(campo('Email'), 'a@b.com')
      await user.type(campo('Contraseña'), 'Zorro-Azul-4721')
      await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
      await vi.waitFor(() => expect(campo('DNI')).toHaveAttribute('aria-invalid', 'true'))

      await user.click(screen.getByRole('button', { name: 'Ya tengo una cuenta' }))
      await user.click(screen.getByRole('button', { name: 'Crear una cuenta' }))
      expect(campo('DNI')).not.toHaveAttribute('aria-invalid')
    })
  })

  describe('perfil', () => {
    async function montar() {
      render(<PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
      await screen.findByText('Datos personales')
    }

    it('la confirmación de contraseña distinta recibe el foco', async () => {
      const user = userEvent.setup()
      await montar()
      await user.type(campo('Contraseña actual'), 'Actual-Clave-1234')
      await user.type(campo('Contraseña nueva'), 'Nueva-Clave-5678')
      await user.type(campo('Confirmar contraseña'), 'Nueva-Clave-0000')
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

      expect(campo('Confirmar contraseña')).toHaveFocus()
      expect(campo('Confirmar contraseña')).toHaveAccessibleDescription('La confirmación no coincide con la contraseña nueva.')
    })

    it('un nombre rechazado por el servidor recibe el foco', async () => {
      const user = userEvent.setup()
      api.actualizarPerfil.mockRejectedValue(errorConCampos('nomYape: El nombre es obligatorio', 'nomYape'))
      api.actualizarPerfilPaciente.mockResolvedValue({})
      await montar()
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
      await vi.waitFor(() => expect(campo('Nombre completo')).toHaveFocus())
      expect(campo('Nombre completo')).toHaveAttribute('aria-invalid', 'true')
    })

    it('el error de la contraseña nueva rechazada va a ese campo', async () => {
      const user = userEvent.setup()
      api.cambiarContrasena.mockRejectedValue(errorConCampos('contrasenaNueva: común', 'contrasenaNueva'))
      await montar()
      await user.type(campo('Contraseña actual'), 'Actual-Clave-1234')
      await user.type(campo('Contraseña nueva'), 'Password12345')
      await user.type(campo('Confirmar contraseña'), 'Password12345')
      await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
      await vi.waitFor(() => expect(campo('Contraseña nueva')).toHaveFocus())
    })
  })

  describe('edición de médico', () => {
    it('sin especialidades, el foco va a la primera casilla', async () => {
      const user = userEvent.setup()
      render(<EditarMedicoModal medico={MEDICO} onClose={vi.fn()} onActualizado={vi.fn()} />)
      await screen.findByRole('checkbox', { name: 'Cardiología' })
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

      expect(screen.getByRole('checkbox', { name: 'Cardiología' })).toHaveFocus()
      expect(api.actualizarMedico).not.toHaveBeenCalled()
    })

    it('un consultorio rechazado por el servidor recibe el foco', async () => {
      const user = userEvent.setup()
      api.actualizarMedico.mockRejectedValue(errorConCampos('consultorio: debe ser un valor corto', 'consultorio'))
      render(<EditarMedicoModal medico={{ ...MEDICO, especialidades: [{ ...CARDIOLOGIA, activo: true }] }} onClose={vi.fn()} onActualizado={vi.fn()} />)
      await screen.findByRole('checkbox', { name: 'Cardiología' })
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

      await vi.waitFor(() => expect(campo('Consultorio')).toHaveFocus())
      expect(campo('Consultorio')).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('alta de especialidades y médicos', () => {
    it('una especialidad repetida devuelve el foco al nombre', async () => {
      const user = userEvent.setup()
      api.crearEspecialidad.mockRejectedValue(new Error('Ya existe una especialidad con ese nombre'))
      render(<AdminAltaModal onClose={vi.fn()} />)
      await screen.findByText('Cardiología')
      await user.type(campo('Nombre de la especialidad'), 'cardiología')
      await user.click(screen.getByRole('button', { name: 'Crear especialidad' }))

      await vi.waitFor(() => expect(campo('Nombre de la especialidad')).toHaveFocus())
      expect(campo('Nombre de la especialidad')).toHaveAccessibleDescription('Ya existe una especialidad con ese nombre')
    })

    async function abrirMedico(user) {
      render(<AdminAltaModal onClose={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Médico' }))
      await screen.findByRole('button', { name: 'Crear médico' })
    }
    async function completarMedico(user) {
      await user.type(campo('Nombre'), 'Gregory')
      await user.type(campo('Apellido'), 'House')
      await user.type(campo('Email'), 'house@correo.com')
      await user.type(campo('DNI'), '25111222')
      await user.type(campo('Contraseña inicial'), 'Inicial-Verde-4482')
      await user.type(campo('Matrícula'), 'MP-77')
    }

    it('sin elegir especialidad, el foco va a la primera casilla', async () => {
      const user = userEvent.setup()
      await abrirMedico(user)
      await completarMedico(user)
      await user.click(screen.getByRole('button', { name: 'Crear médico' }))

      expect(screen.getByRole('checkbox', { name: 'Cardiología' })).toHaveFocus()
      expect(api.crearMedico).not.toHaveBeenCalled()
    })

    it('una matrícula rechazada por el servidor recibe el foco', async () => {
      const user = userEvent.setup()
      api.crearMedico.mockRejectedValue(errorConCampos('matricula: obligatoria', 'matricula'))
      await abrirMedico(user)
      await completarMedico(user)
      await user.click(screen.getByRole('checkbox', { name: 'Cardiología' }))
      await user.click(screen.getByRole('button', { name: 'Crear médico' }))

      await vi.waitFor(() => expect(campo('Matrícula')).toHaveFocus())
      expect(campo('Matrícula')).toHaveAttribute('aria-invalid', 'true')
    })

    it('la contraseña inicial rechazada conserva su texto de ayuda además del error', async () => {
      const user = userEvent.setup()
      api.crearMedico.mockRejectedValue(errorConCampos('contrasena: Es una contraseña demasiado común', 'contrasena'))
      await abrirMedico(user)
      await completarMedico(user)
      await user.click(screen.getByRole('checkbox', { name: 'Cardiología' }))
      await user.click(screen.getByRole('button', { name: 'Crear médico' }))

      await vi.waitFor(() => expect(campo('Contraseña inicial')).toHaveFocus())
      expect(campo('Contraseña inicial')).toHaveAccessibleDescription(/tener que cambiarla.*demasiado común/)
    })
  })
})
