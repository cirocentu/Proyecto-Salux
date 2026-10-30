import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({ api: { disponibilidadDeMedico: vi.fn(), reprogramarTurno: vi.fn() } }))

import ReprogramarTurnoModal from './ReprogramarTurnoModal'
import { api } from './api'

// Lunes 2 de marzo de 2026, 09:00 hora Argentina
const AHORA = new Date('2026-03-02T12:00:00.000Z')
const TURNO = { id: 77, medicoId: 10, medico: 'Dra. Corazón', especialidad: 'Cardiología', fecha: 'Jueves, 5 de marzo de 2026', hora: '10:00 hs' }
const FRANJA_MARTES = { duracionTurnoMinutos: 30, ausencias: [], disponibilidades: [{ diaSemana: 2, horaInicioMinutos: 480, horaFinMinutos: 600 }] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  api.disponibilidadDeMedico.mockResolvedValue({ data: FRANJA_MARTES })
})
afterEach(() => { vi.useRealTimers() })

const montar = () => {
  const onClose = vi.fn()
  const onReprogramado = vi.fn()
  render(<ReprogramarTurnoModal turno={TURNO} onClose={onClose} onReprogramado={onReprogramado} />)
  return { onClose, onReprogramado }
}
// El nombre accesible de cada chip es, por ejemplo, "mar3mar" (día, número, mes).
const chipAsync = (n) => screen.findByRole('button', { name: new RegExp(`^\\D+${n}mar$`) })

describe('reprogramar turno', () => {
  it('muestra el turno actual y pide la disponibilidad del médico de ESE turno', async () => {
    montar()
    expect(await screen.findByText('Dra. Corazón')).toBeInTheDocument()
    expect(screen.getByText('Cardiología')).toBeInTheDocument()
    expect(screen.getByText(/Turno actual: Jueves, 5 de marzo de 2026 — 10:00 hs/)).toBeInTheDocument()
    expect(api.disponibilidadDeMedico).toHaveBeenCalledWith(10)
  })

  it('muestra los horarios de la franja del día elegido', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await chipAsync(3))
    expect(await screen.findByRole('button', { name: /^08:00/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^09:30/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^10:00/ })).not.toBeInTheDocument()
  })

  it('el botón de confirmar espera a que se elija un horario', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(await chipAsync(3))
    expect(screen.getByRole('button', { name: 'Confirmar nuevo horario' })).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    expect(screen.getByRole('button', { name: 'Confirmar nuevo horario' })).toBeEnabled()
  })

  it('reprograma el turno por id, con la hora ISO en UTC, y avisa', async () => {
    const user = userEvent.setup()
    api.reprogramarTurno.mockResolvedValue({ ok: true })
    const { onReprogramado } = montar()
    await user.click(await chipAsync(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar nuevo horario' }))

    expect(api.reprogramarTurno).toHaveBeenCalledWith(77, '2026-03-03T12:00:00.000Z')
    expect(onReprogramado).toHaveBeenCalledTimes(1)
  })

  it('si el servidor rechaza el nuevo horario muestra el motivo y no cierra', async () => {
    const user = userEvent.setup()
    api.reprogramarTurno.mockRejectedValue(new Error('Ese horario ya no está disponible'))
    const { onReprogramado } = montar()
    await user.click(await chipAsync(3))
    await user.click(await screen.findByRole('button', { name: /^09:00/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar nuevo horario' }))

    expect(await screen.findByText('Ese horario ya no está disponible')).toBeInTheDocument()
    expect(onReprogramado).not.toHaveBeenCalled()
  })

  it('si no se puede cargar la disponibilidad, lo dice y no ofrece días', async () => {
    api.disponibilidadDeMedico.mockRejectedValue(new Error('Sin conexión'))
    montar()
    expect(await screen.findByText(/No se pudo cargar la disponibilidad del médico: Sin conexión/)).toBeInTheDocument()
    expect(screen.queryByText('Elegí un nuevo día')).not.toBeInTheDocument()
  })

  it('el botón Cerrar cierra el modal', async () => {
    const user = userEvent.setup()
    const { onClose } = montar()
    await screen.findByText('Dra. Corazón')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
