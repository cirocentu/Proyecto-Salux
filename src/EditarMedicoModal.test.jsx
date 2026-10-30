import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({ api: { especialidades: vi.fn(), actualizarMedico: vi.fn() } }))

import EditarMedicoModal from './EditarMedicoModal'
import { api } from './api'

const CARDIOLOGIA = { idEspecialidad: 1, nombre: 'Cardiología', activo: true }
const PEDIATRIA = { idEspecialidad: 2, nombre: 'Pediatría', activo: true }
const DERMATOLOGIA_BAJA = { idEspecialidad: 3, nombre: 'Dermatología', activo: false }

const MEDICO = {
  idMedico: 10, consultorio: 'A', duracionTurnoMinutos: 30,
  usuario: { nomYape: 'Dra. Corazón' },
  especialidades: [CARDIOLOGIA, DERMATOLOGIA_BAJA],
}

async function montar(medico = MEDICO) {
  api.especialidades.mockResolvedValue({ data: [CARDIOLOGIA, PEDIATRIA] })
  const onClose = vi.fn()
  const onActualizado = vi.fn()
  render(<EditarMedicoModal medico={medico} onClose={onClose} onActualizado={onActualizado} />)
  await screen.findByRole('checkbox', { name: 'Pediatría' })
  return { onClose, onActualizado }
}

const guardar = () => screen.getByRole('button', { name: 'Guardar cambios' })
const campoConsultorio = () => screen.getByPlaceholderText('204')
const campoDuracion = () => screen.getByRole('spinbutton')

describe('edición de un médico', () => {
  it('arranca con los datos actuales del médico', async () => {
    await montar()
    expect(screen.getByText('Dra. Corazón')).toBeInTheDocument()
    expect(campoConsultorio()).toHaveValue('A')
    expect(campoDuracion()).toHaveValue(30)
    expect(screen.getByRole('checkbox', { name: 'Cardiología' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pediatría' })).not.toBeChecked()
  })

  it('una especialidad dada de baja que el médico conserva se muestra marcada como inactiva', async () => {
    await montar()
    const baja = screen.getByRole('checkbox', { name: /Dermatología/ })
    expect(baja).toBeChecked()
    expect(screen.getByText('inactiva')).toBeInTheDocument()
  })

  it('una especialidad dada de baja que el médico NO tiene no se ofrece', async () => {
    await montar({ ...MEDICO, especialidades: [CARDIOLOGIA] })
    expect(screen.queryByRole('checkbox', { name: /Dermatología/ })).not.toBeInTheDocument()
  })

  it('guarda consultorio, duración y el nuevo conjunto de especialidades, y se cierra', async () => {
    const user = userEvent.setup()
    const actualizado = { ...MEDICO, consultorio: '204', duracionTurnoMinutos: 45 }
    api.actualizarMedico.mockResolvedValue({ data: actualizado })
    const { onClose, onActualizado } = await montar()

    await user.clear(campoConsultorio())
    await user.type(campoConsultorio(), '204')
    await user.clear(campoDuracion())
    await user.type(campoDuracion(), '45')
    await user.click(screen.getByRole('checkbox', { name: 'Pediatría' })) // agrega
    await user.click(screen.getByRole('checkbox', { name: /Dermatología/ })) // quita la dada de baja
    await user.click(guardar())

    expect(api.actualizarMedico).toHaveBeenCalledWith(10, { consultorio: '204', duracionTurnoMinutos: '45', especialidadesIds: [1, 2] })
    expect(onActualizado).toHaveBeenCalledWith(actualizado)
    expect(onClose).toHaveBeenCalled()
  })

  it('no deja guardar sin ninguna especialidad', async () => {
    const user = userEvent.setup()
    const { onClose } = await montar({ ...MEDICO, especialidades: [CARDIOLOGIA] })
    await user.click(screen.getByRole('checkbox', { name: 'Cardiología' }))
    await user.click(guardar())

    expect(screen.getByText('El médico tiene que tener al menos una especialidad.')).toBeInTheDocument()
    expect(api.actualizarMedico).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza el cambio, muestra el motivo y no se cierra', async () => {
    const user = userEvent.setup()
    api.actualizarMedico.mockRejectedValue(new Error('consultorio: El consultorio debe ser un valor corto'))
    const { onClose, onActualizado } = await montar()
    await user.click(guardar())

    expect(await screen.findByText(/El consultorio debe ser un valor corto/)).toBeInTheDocument()
    expect(onActualizado).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('el campo de duración limita el rango a 5-240 minutos', async () => {
    await montar()
    expect(campoDuracion()).toHaveAttribute('min', '5')
    expect(campoDuracion()).toHaveAttribute('max', '240')
  })

  it('un médico sin consultorio ni duración usa los valores por defecto del formulario', async () => {
    await montar({ ...MEDICO, consultorio: null, duracionTurnoMinutos: undefined, especialidades: [CARDIOLOGIA] })
    expect(campoConsultorio()).toHaveValue('')
    expect(campoDuracion()).toHaveValue(30)
  })

  it('si no se pueden cargar las especialidades, lo avisa', async () => {
    api.especialidades.mockRejectedValue(new Error('Sin conexión'))
    render(<EditarMedicoModal medico={MEDICO} onClose={vi.fn()} onActualizado={vi.fn()} />)
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
  })

  it('el botón Cerrar cierra el modal', async () => {
    const user = userEvent.setup()
    const { onClose } = await montar()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
