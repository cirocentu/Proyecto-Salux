import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  api: { especialidades: vi.fn(), medicos: vi.fn(), disponibilidadDeMedico: vi.fn(), crearTurno: vi.fn() },
}))

import NuevoTurnoModal from './NuevoTurnoModal'
import { api } from './api'

// Lunes 2 de marzo de 2026, 09:00 hora Argentina
const AHORA = new Date('2026-03-02T12:00:00.000Z')

const CARDIOLOGIA = { idEspecialidad: 1, nombre: 'Cardiología' }
const PEDIATRIA = { idEspecialidad: 2, nombre: 'Pediatría' }
const MEDICOS = [
  { idMedico: 10, consultorio: 'A', usuario: { nomYape: 'Dra. Corazón' }, especialidades: [CARDIOLOGIA], proximaDisponibilidad: '2026-03-03T12:00:00.000Z' },
  { idMedico: 11, consultorio: null, usuario: { nomYape: 'Dr. Niños' }, especialidades: [PEDIATRIA], proximaDisponibilidad: null },
  { idMedico: 12, consultorio: '204', usuario: { nomYape: 'Dr. Doble' }, especialidades: [CARDIOLOGIA, PEDIATRIA], proximaDisponibilidad: null },
]
// El martes de 08:00 a 10:00 (4 turnos de 30 min)
const FRANJA_MARTES = { duracionTurnoMinutos: 30, ausencias: [], disponibilidades: [{ diaSemana: 2, horaInicioMinutos: 480, horaFinMinutos: 600 }] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  api.especialidades.mockResolvedValue({ data: [CARDIOLOGIA, PEDIATRIA] })
  api.medicos.mockResolvedValue({ data: MEDICOS })
  api.disponibilidadDeMedico.mockResolvedValue({ data: FRANJA_MARTES })
})
afterEach(() => { vi.useRealTimers() })

const montar = () => {
  const onClose = vi.fn()
  const onCreado = vi.fn()
  render(<NuevoTurnoModal onClose={onClose} onCreado={onCreado} />)
  return { onClose, onCreado }
}

// El nombre accesible de cada chip es, por ejemplo, "mar3mar" (día, número, mes).
const chipDelDia = (n) => screen.getByRole('button', { name: new RegExp(`^\\D+${n}mar$`) })

async function llegarAlPaso3(user, especialidad = 'Cardiología', medico = 'Dra. Corazón') {
  await user.click(await screen.findByRole('button', { name: especialidad }))
  await user.click(await screen.findByRole('button', { name: new RegExp(medico) }))
}

describe('paso 1: especialidad', () => {
  it('lista las especialidades activas del sistema', async () => {
    montar()
    expect(await screen.findByRole('button', { name: 'Cardiología' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pediatría' })).toBeInTheDocument()
    expect(screen.getByText(/Paso 1 de 3/)).toBeInTheDocument()
  })

  it('avisa si todavía no hay especialidades', async () => {
    api.especialidades.mockResolvedValue({ data: [] })
    montar()
    expect(await screen.findByText(/Todavía no hay especialidades cargadas/)).toBeInTheDocument()
  })

  it('si falla la carga, muestra el error en vez de quedarse cargando', async () => {
    api.medicos.mockRejectedValue(new Error('No se pudo conectar con el servidor'))
    montar()
    expect(await screen.findByText(/No se pudo cargar la información: No se pudo conectar/)).toBeInTheDocument()
  })

  it('el botón Cerrar cierra el modal', async () => {
    const user = userEvent.setup()
    const { onClose } = montar()
    await screen.findByRole('button', { name: 'Cardiología' })
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('paso 2: médico', () => {
  it('muestra solo los médicos que atienden esa especialidad (incluye al que atiende varias)', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await screen.findByRole('button', { name: 'Pediatría' }))

    expect(screen.getByText(/Paso 2 de 3/)).toBeInTheDocument()
    expect(screen.getByText('Dr. Niños')).toBeInTheDocument()
    expect(screen.getByText('Dr. Doble')).toBeInTheDocument()
    expect(screen.queryByText('Dra. Corazón')).not.toBeInTheDocument()
  })

  it('muestra consultorio y la próxima disponibilidad de cada médico', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await screen.findByRole('button', { name: 'Cardiología' }))

    const corazon = screen.getByRole('button', { name: /Dra\. Corazón/ })
    expect(within(corazon).getByText('Consultorio A')).toBeInTheDocument()
    expect(within(corazon).getByText(/Próximo lugar/)).toBeInTheDocument()
    const doble = screen.getByRole('button', { name: /Dr\. Doble/ })
    expect(within(doble).getByText('Sin franjas configuradas todavía')).toBeInTheDocument()
  })

  it('un médico sin consultorio dice "a confirmar"', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await screen.findByRole('button', { name: 'Pediatría' }))
    expect(within(screen.getByRole('button', { name: /Dr\. Niños/ })).getByText('Consultorio a confirmar')).toBeInTheDocument()
  })

  it('se puede volver a cambiar la especialidad', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await screen.findByRole('button', { name: 'Cardiología' }))
    await user.click(screen.getByRole('button', { name: /Cambiar especialidad/ }))
    expect(screen.getByText(/Paso 1 de 3/)).toBeInTheDocument()
  })
})

describe('paso 3: fecha y hora', () => {
  it('al elegir médico pide su disponibilidad real', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)
    expect(api.disponibilidadDeMedico).toHaveBeenCalledWith(10)
    expect(screen.getByText(/Paso 3 de 3/)).toBeInTheDocument()
  })

  it('ofrece 14 días y, al elegir uno, solo los horarios de la franja de ese día', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)

    await user.click(chipDelDia(3)) // martes 3
    for (const hora of ['08:00', '08:30', '09:00', '09:30']) {
      expect(await screen.findByRole('button', { name: new RegExp(`^${hora}`) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^10:00/ })).not.toBeInTheDocument()
  })

  it('un día sin franja no ofrece horarios', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)
    await user.click(chipDelDia(4)) // miércoles
    expect(await screen.findByText(/No quedan horarios disponibles ese día/)).toBeInTheDocument()
  })

  it('"Confirmar turno" arranca deshabilitado hasta elegir un horario', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)
    expect(screen.getByRole('button', { name: 'Confirmar turno' })).toBeDisabled()
    await user.click(chipDelDia(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    expect(screen.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled()
  })

  it('cambiar de día borra el horario elegido', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)
    await user.click(chipDelDia(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    await user.click(chipDelDia(10)) // otro martes
    expect(screen.getByRole('button', { name: 'Confirmar turno' })).toBeDisabled()
  })

  it('confirma con médico, hora ISO en UTC y especialidad, y avisa al terminar', async () => {
    const user = userEvent.setup()
    api.crearTurno.mockResolvedValue({ ok: true })
    const { onCreado } = montar()
    await llegarAlPaso3(user)
    await user.click(chipDelDia(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar turno' }))

    // 09:00 Argentina = 12:00 UTC
    expect(api.crearTurno).toHaveBeenCalledWith(10, '2026-03-03T12:00:00.000Z', 1)
    expect(onCreado).toHaveBeenCalledTimes(1)
  })

  it('al reservar con un médico que atiende dos especialidades manda la elegida', async () => {
    const user = userEvent.setup()
    api.crearTurno.mockResolvedValue({ ok: true })
    montar()
    await llegarAlPaso3(user, 'Pediatría', 'Dr. Doble')
    await user.click(chipDelDia(3))
    await user.click(await screen.findByRole('button', { name: /^08:30/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar turno' }))
    expect(api.crearTurno).toHaveBeenCalledWith(12, '2026-03-03T11:30:00.000Z', 2)
  })

  it('si el servidor rechaza la reserva (horario tomado), muestra el motivo y no cierra', async () => {
    const user = userEvent.setup()
    api.crearTurno.mockRejectedValue(new Error('Ese médico ya tiene un turno dentro de los 30 minutos de ese horario'))
    const { onCreado } = montar()
    await llegarAlPaso3(user)
    await user.click(chipDelDia(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar turno' }))

    expect(await screen.findByText(/ya tiene un turno dentro de los 30 minutos/)).toBeInTheDocument()
    expect(onCreado).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled()
  })

  it('si falla la disponibilidad, igual deja elegir (rango de respaldo 8 a 20)', async () => {
    const user = userEvent.setup()
    api.disponibilidadDeMedico.mockRejectedValue(new Error('x'))
    montar()
    await llegarAlPaso3(user)
    await user.click(chipDelDia(3))
    expect(await screen.findByRole('button', { name: /^08:00/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^07:30 p/ })).toBeInTheDocument()
  })

  it('se puede volver a cambiar de médico', async () => {
    const user = userEvent.setup()
    montar()
    await llegarAlPaso3(user)
    await user.click(screen.getByRole('button', { name: /Cambiar médico/ }))
    expect(screen.getByText(/Paso 2 de 3/)).toBeInTheDocument()
  })
})
