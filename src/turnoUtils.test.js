import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generarProximosDias, generarHorariosDelDia, DIAS_A_MOSTRAR } from './turnoUtils'

// Lunes 2 de marzo de 2026, 09:00 hora Argentina
const AHORA = new Date('2026-03-02T12:00:00.000Z')

const hhmm = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const dia = (anio, mes, d) => new Date(anio, mes - 1, d) // medianoche local (Argentina)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AHORA) })
afterEach(() => { vi.useRealTimers() })

describe('generarProximosDias', () => {
  it('arranca hoy a medianoche y suma un día por chip', () => {
    const dias = generarProximosDias(3)
    expect(dias).toHaveLength(3)
    expect(dias[0].getTime()).toBe(dia(2026, 3, 2).getTime())
    expect(dias.map((d) => d.getDate())).toEqual([2, 3, 4])
  })

  it('cruza el fin de mes sin saltear días', () => {
    vi.setSystemTime(new Date('2026-03-30T15:00:00.000Z'))
    expect(generarProximosDias(4).map((d) => d.getDate())).toEqual([30, 31, 1, 2])
  })

  it('la cantidad por defecto de la app son 14 días', () => {
    expect(DIAS_A_MOSTRAR).toBe(14)
  })
})

describe('generarHorariosDelDia', () => {
  it('sin día elegido no hay horarios', () => {
    expect(generarHorariosDelDia(null, null)).toEqual([])
  })

  it('médico sin franjas cargadas: usa el rango de respaldo 8 a 20 cada 30 min', () => {
    const horarios = generarHorariosDelDia(dia(2026, 3, 3), { disponibilidades: [] })
    expect(horarios).toHaveLength(24)
    expect(hhmm(horarios[0])).toBe('08:00')
    expect(hhmm(horarios.at(-1))).toBe('19:30')
  })

  it('respeta la duración del turno de cada médico', () => {
    const horarios = generarHorariosDelDia(dia(2026, 3, 3), { disponibilidades: [], duracionTurnoMinutos: 60 })
    expect(horarios).toHaveLength(12)
    expect(horarios.map(hhmm).slice(0, 3)).toEqual(['08:00', '09:00', '10:00'])
  })

  it('usa solo las franjas del día de la semana elegido', () => {
    const disponibilidad = {
      duracionTurnoMinutos: 30,
      disponibilidades: [
        { diaSemana: 2, horaInicioMinutos: 8 * 60, horaFinMinutos: 10 * 60 }, // martes
        { diaSemana: 3, horaInicioMinutos: 14 * 60, horaFinMinutos: 16 * 60 }, // miércoles
      ],
    }
    expect(generarHorariosDelDia(dia(2026, 3, 3), disponibilidad).map(hhmm)).toEqual(['08:00', '08:30', '09:00', '09:30'])
    expect(generarHorariosDelDia(dia(2026, 3, 4), disponibilidad).map(hhmm)).toEqual(['14:00', '14:30', '15:00', '15:30'])
  })

  it('un día sin franja no ofrece horarios', () => {
    const disponibilidad = { disponibilidades: [{ diaSemana: 2, horaInicioMinutos: 480, horaFinMinutos: 600 }] }
    expect(generarHorariosDelDia(dia(2026, 3, 5), disponibilidad)).toEqual([])
  })

  it('el último turno tiene que entrar completo en la franja', () => {
    const disponibilidad = { duracionTurnoMinutos: 45, disponibilidades: [{ diaSemana: 2, horaInicioMinutos: 480, horaFinMinutos: 600 }] }
    // 8:00-8:45, 8:45-9:30; el de 9:30 terminaría 10:15 (>10:00)
    expect(generarHorariosDelDia(dia(2026, 3, 3), disponibilidad).map(hhmm)).toEqual(['08:00', '08:45'])
  })

  it('hoy descarta los horarios con menos de una hora de anticipación', () => {
    const horarios = generarHorariosDelDia(dia(2026, 3, 2), { disponibilidades: [] })
    expect(hhmm(horarios[0])).toBe('10:00') // son las 09:00: el primero es 09:00+1h
  })

  it('un día dentro de una ausencia no ofrece horarios, y los vecinos sí', () => {
    const disponibilidad = {
      disponibilidades: [],
      // las ausencias vienen como días UTC (medianoche)
      ausencias: [{ fechaInicio: '2026-03-05T00:00:00.000Z', fechaFin: '2026-03-06T00:00:00.000Z' }],
    }
    expect(generarHorariosDelDia(dia(2026, 3, 5), disponibilidad)).toEqual([])
    expect(generarHorariosDelDia(dia(2026, 3, 6), disponibilidad)).toEqual([])
    expect(generarHorariosDelDia(dia(2026, 3, 4), disponibilidad).length).toBeGreaterThan(0)
    expect(generarHorariosDelDia(dia(2026, 3, 7), disponibilidad).length).toBeGreaterThan(0)
  })

  it('devuelve los horarios ordenados aunque haya varias franjas', () => {
    const disponibilidad = {
      disponibilidades: [
        { diaSemana: 2, horaInicioMinutos: 15 * 60, horaFinMinutos: 16 * 60 },
        { diaSemana: 2, horaInicioMinutos: 8 * 60, horaFinMinutos: 9 * 60 },
      ],
    }
    expect(generarHorariosDelDia(dia(2026, 3, 3), disponibilidad).map(hhmm)).toEqual(['08:00', '08:30', '15:00', '15:30'])
  })
})
