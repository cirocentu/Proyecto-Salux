import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  api: { especialidades: vi.fn(), crearEspecialidad: vi.fn(), eliminarEspecialidad: vi.fn(), crearMedico: vi.fn() },
}))

import AdminAltaModal from './AdminAltaModal'
import { api } from './api'

const CARDIOLOGIA = { idEspecialidad: 1, nombre: 'Cardiología', medicos: [{ idMedico: 10, usuario: { nomYape: 'Dra. Corazón' } }, { idMedico: 11, usuario: { nomYape: 'Dr. Latido' } }] }
const PEDIATRIA = { idEspecialidad: 2, nombre: 'Pediatría', medicos: [] }

async function montar() {
  api.especialidades.mockResolvedValue({ data: [CARDIOLOGIA, PEDIATRIA] })
  const onClose = vi.fn()
  render(<AdminAltaModal onClose={onClose} />)
  await screen.findByText('Cardiología')
  return { onClose }
}

describe('alta de especialidades', () => {
  it('lista las especialidades existentes', async () => {
    await montar()
    expect(screen.getByText('Cardiología')).toBeInTheDocument()
    expect(screen.getByText('Pediatría')).toBeInTheDocument()
  })

  it('crea una especialidad, avisa y recarga la lista', async () => {
    const user = userEvent.setup()
    api.crearEspecialidad.mockResolvedValue({ data: { idEspecialidad: 3, nombre: 'Neurología' } })
    await montar()

    await user.type(screen.getByPlaceholderText('Ej: Cardiología'), 'Neurología')
    await user.click(screen.getByRole('button', { name: 'Crear especialidad' }))

    expect(api.crearEspecialidad).toHaveBeenCalledWith('Neurología')
    expect(await screen.findByText('Especialidad "Neurología" creada con éxito.')).toBeInTheDocument()
    expect(api.especialidades).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText('Ej: Cardiología')).toHaveValue('')
  })

  it('muestra el error si ya existe', async () => {
    const user = userEvent.setup()
    api.crearEspecialidad.mockRejectedValue(new Error('Ya existe una especialidad con ese nombre'))
    await montar()
    await user.type(screen.getByPlaceholderText('Ej: Cardiología'), 'cardiología')
    await user.click(screen.getByRole('button', { name: 'Crear especialidad' }))
    expect(await screen.findByText('Ya existe una especialidad con ese nombre')).toBeInTheDocument()
  })

  it('eliminar pide confirmación y lista los médicos afectados', async () => {
    const user = userEvent.setup()
    await montar()
    const fila = screen.getByText('Cardiología').closest('li')
    await user.click(within(fila).getByRole('button', { name: 'Eliminar' }))

    expect(screen.getByRole('heading', { name: '¿Eliminar "Cardiología"?' })).toBeInTheDocument()
    expect(screen.getByText(/2 médicos tienen esta especialidad asignada/)).toBeInTheDocument()
    expect(screen.getByText('Dra. Corazón')).toBeInTheDocument()
    expect(screen.getByText('Dr. Latido')).toBeInTheDocument()
    expect(api.eliminarEspecialidad).not.toHaveBeenCalled()
  })

  it('si no hay médicos asignados lo dice', async () => {
    const user = userEvent.setup()
    await montar()
    await user.click(within(screen.getByText('Pediatría').closest('li')).getByRole('button', { name: 'Eliminar' }))
    expect(screen.getByText('No hay médicos asignados a esta especialidad.')).toBeInTheDocument()
  })

  it('un solo médico afectado se redacta en singular', async () => {
    const user = userEvent.setup()
    api.especialidades.mockResolvedValue({ data: [{ idEspecialidad: 5, nombre: 'Urología', medicos: [{ idMedico: 1, usuario: { nomYape: 'Dr. Uno' } }] }] })
    render(<AdminAltaModal onClose={vi.fn()} />)
    await user.click(within((await screen.findByText('Urología')).closest('li')).getByRole('button', { name: 'Eliminar' }))
    expect(screen.getByText(/1 médico tiene esta especialidad asignada/)).toBeInTheDocument()
  })

  it('cancelar la confirmación no elimina nada', async () => {
    const user = userEvent.setup()
    await montar()
    await user.click(within(screen.getByText('Cardiología').closest('li')).getByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(api.eliminarEspecialidad).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '¿Eliminar "Cardiología"?' })).not.toBeInTheDocument()
  })

  it('confirmar elimina la especialidad y la saca de la lista', async () => {
    const user = userEvent.setup()
    api.eliminarEspecialidad.mockResolvedValue({})
    await montar()
    await user.click(within(screen.getByText('Cardiología').closest('li')).getByRole('button', { name: 'Eliminar' }))
    const confirmacion = screen.getByRole('heading', { name: '¿Eliminar "Cardiología"?' }).closest('.fixed')
    await user.click(within(confirmacion).getByRole('button', { name: 'Eliminar' }))

    expect(api.eliminarEspecialidad).toHaveBeenCalledWith(1)
    expect(await screen.findByText('Especialidad "Cardiología" eliminada.')).toBeInTheDocument()
    expect(screen.queryByText('Cardiología', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('si no hay especialidades lo indica', async () => {
    api.especialidades.mockResolvedValue({ data: [] })
    render(<AdminAltaModal onClose={vi.fn()} />)
    expect(await screen.findByText('Todavía no hay ninguna cargada.')).toBeInTheDocument()
  })

  it('el botón Cerrar cierra el modal', async () => {
    const user = userEvent.setup()
    const { onClose } = await montar()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('alta de médicos', () => {
  async function abrirFormularioMedico() {
    const user = userEvent.setup()
    await montar()
    await user.click(screen.getByRole('button', { name: 'Médico' }))
    await screen.findByRole('button', { name: 'Crear médico' })
    return user
  }

  async function completar(user) {
    await user.type(screen.getByPlaceholderText('Ana'), 'Gregory')
    await user.type(screen.getByPlaceholderText('Rodríguez'), 'House')
    await user.type(screen.getByPlaceholderText('medico@salux.com'), 'house@correo.com')
    await user.type(screen.getByPlaceholderText('30456789'), '25111222')
    await user.type(screen.getByPlaceholderText('Mínimo 10 caracteres'), 'Inicial-Verde-4482')
    await user.type(screen.getByPlaceholderText('MP-12345'), 'MP-77')
    await user.type(screen.getByPlaceholderText('204'), 'B')
  }

  it('ofrece las especialidades como casillas', async () => {
    await abrirFormularioMedico()
    expect(screen.getByRole('checkbox', { name: 'Cardiología' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Pediatría' })).toBeInTheDocument()
  })

  it('exige elegir al menos una especialidad', async () => {
    const user = await abrirFormularioMedico()
    await completar(user)
    await user.click(screen.getByRole('button', { name: 'Crear médico' }))
    expect(screen.getByText('Elegí al menos una especialidad para el médico.')).toBeInTheDocument()
    expect(api.crearMedico).not.toHaveBeenCalled()
  })

  it('crea el médico con nombre y apellido unidos, y limpia el formulario', async () => {
    const user = await abrirFormularioMedico()
    api.crearMedico.mockResolvedValue({ data: { nomYape: 'Gregory House' } })
    await completar(user)
    await user.click(screen.getByRole('checkbox', { name: 'Cardiología' }))
    await user.click(screen.getByRole('checkbox', { name: 'Pediatría' }))
    await user.click(screen.getByRole('button', { name: 'Crear médico' }))

    expect(api.crearMedico).toHaveBeenCalledWith({
      email: 'house@correo.com', dni: '25111222', contrasena: 'Inicial-Verde-4482', nomYape: 'Gregory House',
      matricula: 'MP-77', consultorio: 'B', especialidadesIds: [1, 2], duracionTurnoMinutos: '30',
    })
    expect(await screen.findByText('Médico "Gregory House" creado con éxito.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('medico@salux.com')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: 'Cardiología' })).not.toBeChecked()
  })

  it('muestra el error del servidor (email, DNI o matrícula repetidos)', async () => {
    const user = await abrirFormularioMedico()
    api.crearMedico.mockRejectedValue(new Error('El email o DNI ya están registrados'))
    await completar(user)
    await user.click(screen.getByRole('checkbox', { name: 'Cardiología' }))
    await user.click(screen.getByRole('button', { name: 'Crear médico' }))
    expect(await screen.findByText('El email o DNI ya están registrados')).toBeInTheDocument()
  })

  it('la contraseña inicial exige 10 caracteres y avisa que el médico tendrá que cambiarla', async () => {
    await abrirFormularioMedico()
    expect(screen.getByPlaceholderText('Mínimo 10 caracteres')).toHaveAttribute('minlength', '10')
    expect(screen.getByText(/va a tener que cambiarla en su primer ingreso/)).toBeInTheDocument()
  })

  it('sin especialidades cargadas orienta a crear una primero', async () => {
    const user = userEvent.setup()
    api.especialidades.mockResolvedValue({ data: [] })
    render(<AdminAltaModal onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Médico' }))
    expect(await screen.findByText(/No hay especialidades cargadas/)).toBeInTheDocument()
  })
})
