import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  api: {
    misTurnos: vi.fn(), cancelarTurno: vi.fn(), confirmarAsistencia: vi.fn(),
    todosLosTurnos: vi.fn(), actualizarEstadoTurno: vi.fn(),
    todosLosMedicos: vi.fn(), cambiarEstadoMedico: vi.fn(),
    agendaMedico: vi.fn(),
    misDisponibilidades: vi.fn(), crearDisponibilidad: vi.fn(), eliminarDisponibilidad: vi.fn(),
    misAusencias: vi.fn(), crearAusencia: vi.fn(), eliminarAusencia: vi.fn(),
  },
  getPreferenciasAccesibilidad: vi.fn(),
  guardarPreferenciasAccesibilidad: vi.fn(),
}))

// Los modales tienen sus propios tests: acá se reemplazan por piezas mínimas que
// exponen lo que el Dashboard les pasa.
vi.mock('./NuevoTurnoModal', () => ({
  default: ({ onClose, onCreado }) => (
    <div role="dialog" aria-label="Modal nuevo turno">
      <button onClick={onCreado}>simular turno creado</button>
      <button onClick={onClose}>cerrar nuevo turno</button>
    </div>
  ),
}))
vi.mock('./ReprogramarTurnoModal', () => ({
  default: ({ turno, onClose, onReprogramado }) => (
    <div role="dialog" aria-label="Modal reprogramar">
      <span>Reprogramando turno {turno.id} de {turno.medico}</span>
      <button onClick={onReprogramado}>simular reprogramado</button>
      <button onClick={onClose}>cerrar reprogramar</button>
    </div>
  ),
}))
vi.mock('./AdminAltaModal', () => ({
  default: ({ onClose }) => <div role="dialog" aria-label="Modal alta"><button onClick={onClose}>cerrar alta</button></div>,
}))
vi.mock('./PerfilModal', () => ({
  default: ({ usuario, onClose }) => <div role="dialog" aria-label="Modal perfil">Perfil de {usuario.nombre}<button onClick={onClose}>cerrar perfil</button></div>,
}))
vi.mock('./EditarMedicoModal', () => ({
  default: ({ medico, onClose }) => <div role="dialog" aria-label="Modal editar médico">Editando a {medico.usuario.nomYape}<button onClick={onClose}>cerrar edición</button></div>,
}))

import Dashboard from './Dashboard'
import { api, getPreferenciasAccesibilidad, guardarPreferenciasAccesibilidad } from './api'

// Lunes 2 de marzo de 2026, 09:00 hora Argentina
const AHORA = new Date('2026-03-02T12:00:00.000Z')

const PACIENTE = { id: 1, nombre: 'Ana Gómez', rol: 'paciente' }
const ADMIN = { id: 2, nombre: 'Admin Salux', rol: 'admin' }
const MEDICO = { id: 3, nombre: 'Dr. House', rol: 'medico' }

const medicoApi = (idMedico, nombre, consultorio = 'A') => ({
  idMedico, consultorio, usuario: { nomYape: nombre }, especialidades: [{ nombre: 'Cardiología' }],
})
const turnoApi = (idTurno, fechaYhora, estado, extra = {}) => ({
  idTurno, fechaYhora, estado, confirmadoPorPaciente: false,
  especialidad: { nombre: 'Cardiología' }, medico: medicoApi(10, 'Dra. Corazón'), ...extra,
})

const TURNOS_PACIENTE = [
  turnoApi(1, '2026-03-05T13:00:00.000Z', 'PENDIENTE', { medico: medicoApi(10, 'Dra. Corazón') }),
  turnoApi(2, '2026-03-09T13:00:00.000Z', 'CONFIRMADO', { medico: medicoApi(11, 'Dr. Niños'), especialidad: { nombre: 'Pediatría' }, confirmadoPorPaciente: true }),
  turnoApi(3, '2026-02-20T13:00:00.000Z', 'FINALIZADO', { medico: medicoApi(12, 'Dr. Piel') }),
  turnoApi(4, '2026-02-25T13:00:00.000Z', 'CANCELADO', { medico: medicoApi(13, 'Dra. Ojos') }),
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  getPreferenciasAccesibilidad.mockReturnValue({})
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  api.misTurnos.mockResolvedValue({ data: TURNOS_PACIENTE })
})
afterEach(() => { vi.useRealTimers() })

function montar(usuario, props = {}) {
  const onLogout = vi.fn()
  const onUsuarioActualizado = vi.fn()
  render(<Dashboard usuario={usuario} onLogout={onLogout} onUsuarioActualizado={onUsuarioActualizado} {...props} />)
  return { onLogout, onUsuarioActualizado }
}

// El menú principal (las tarjetas del inicio repiten algunos de estos nombres).
const menu = () => within(screen.getByRole('navigation', { name: 'Principal' }))
const navegar = (user, nombre) => user.click(menu().getByRole('button', { name: nombre }))
// La tarjeta de un turno se identifica por el nombre del médico/paciente en su título.
const tarjeta = async (nombre) => (await screen.findByRole('heading', { name: nombre })).closest('.border-l-4')

describe('paciente', () => {
  it('pide solo sus propios turnos', async () => {
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    expect(api.misTurnos).toHaveBeenCalledTimes(1)
    expect(api.todosLosTurnos).not.toHaveBeenCalled()
    expect(api.agendaMedico).not.toHaveBeenCalled()
  })

  it('el inicio saluda, recuerda el próximo turno activo y ofrece las acciones', async () => {
    montar(PACIENTE)
    expect(screen.getByRole('heading', { name: 'Ana Gómez' })).toBeInTheDocument()
    expect(await screen.findByText(/Recordatorio: tenés un turno en \d+ días? con Dra\. Corazón/)).toBeInTheDocument()
    expect(screen.getByText(/Próximo turno en/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '¿Qué querés hacer hoy?' })).toBeInTheDocument()
  })

  it('sin turnos próximos lo dice', async () => {
    api.misTurnos.mockResolvedValue({ data: [] })
    montar(PACIENTE)
    expect(await screen.findByText(/No tenés turnos próximos/)).toBeInTheDocument()
  })

  it('el menú del paciente no incluye las secciones de admin ni de médico', async () => {
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    expect(menu().getByRole('button', { name: /^Mis turnos/ })).toBeInTheDocument()
    expect(menu().getByRole('button', { name: 'Historial' })).toBeInTheDocument()
    expect(menu().queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument()
    expect(menu().queryByRole('button', { name: /^Mi agenda/ })).not.toBeInTheDocument()
    expect(menu().queryByRole('button', { name: 'Mi disponibilidad' })).not.toBeInTheDocument()
  })

  it('el menú cuenta los turnos activos (pendientes y confirmados)', async () => {
    montar(PACIENTE)
    expect(await screen.findByRole('button', { name: 'Mis turnos2' })).toBeInTheDocument()
  })

  describe('mis turnos', () => {
    async function abrirMisTurnos() {
      const user = userEvent.setup()
      montar(PACIENTE)
      await screen.findByText(/Recordatorio/)
      await navegar(user, /^Mis turnos/)
      return user
    }

    it('lista cada turno con médico, especialidad y estado', async () => {
      await abrirMisTurnos()
      const t1 = await tarjeta('Dra. Corazón')
      expect(within(t1).getByText('Pendiente')).toBeInTheDocument()
      expect(within(t1).getByText('Cardiología')).toBeInTheDocument()
      expect(within(t1).getByText('📍 Consultorio A')).toBeInTheDocument()
      expect(within(await tarjeta('Dr. Niños')).getByText('Confirmado')).toBeInTheDocument()
      expect(screen.getByText('2 turnos activos')).toBeInTheDocument()
    })

    it('los filtros muestran solo los turnos de ese estado', async () => {
      const user = await abrirMisTurnos()
      await user.click(screen.getByRole('button', { name: 'Confirmados' }))
      expect(screen.getByRole('heading', { name: 'Dr. Niños' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Dra. Corazón' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Pendientes' }))
      expect(screen.getByRole('heading', { name: 'Dra. Corazón' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Dr. Niños' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Cancelados' }))
      expect(screen.getByRole('heading', { name: 'Dra. Ojos' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Dra. Corazón' })).not.toBeInTheDocument()
    })

    it('un turno finalizado o cancelado ya no se puede cancelar ni reprogramar', async () => {
      await abrirMisTurnos()
      for (const nombre of ['Dr. Piel', 'Dra. Ojos']) {
        const t = await tarjeta(nombre)
        expect(within(t).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
        expect(within(t).getByRole('button', { name: 'Reprogramar' })).toBeDisabled()
      }
      const activo = await tarjeta('Dra. Corazón')
      expect(within(activo).getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    })

    it('cancelar pide confirmación y "Volver" no cancela nada', async () => {
      const user = await abrirMisTurnos()
      await user.click(within(await tarjeta('Dra. Corazón')).getByRole('button', { name: 'Cancelar' }))

      expect(screen.getByRole('heading', { name: '¿Cancelar este turno?' })).toBeInTheDocument()
      expect(screen.getByText(/Dra\. Corazón — /)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Volver' }))

      expect(api.cancelarTurno).not.toHaveBeenCalled()
      expect(screen.queryByRole('heading', { name: '¿Cancelar este turno?' })).not.toBeInTheDocument()
    })

    it('al confirmar, cancela el turno y lo marca como cancelado', async () => {
      const user = await abrirMisTurnos()
      api.cancelarTurno.mockResolvedValue({})
      await user.click(within(await tarjeta('Dra. Corazón')).getByRole('button', { name: 'Cancelar' }))
      await user.click(screen.getByRole('button', { name: 'Sí, cancelar turno' }))

      expect(api.cancelarTurno).toHaveBeenCalledWith(1)
      expect(await within(await tarjeta('Dra. Corazón')).findByText('Cancelado')).toBeInTheDocument()
    })

    it('si el servidor no deja cancelar, avisa y no cambia el estado', async () => {
      const user = await abrirMisTurnos()
      api.cancelarTurno.mockRejectedValue(new Error('Acceso denegado'))
      await user.click(within(await tarjeta('Dra. Corazón')).getByRole('button', { name: 'Cancelar' }))
      await user.click(screen.getByRole('button', { name: 'Sí, cancelar turno' }))

      await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith('No se pudo cancelar el turno: Acceso denegado'))
      expect(within(await tarjeta('Dra. Corazón')).getByText('Pendiente')).toBeInTheDocument()
    })

    it('"Confirmo que voy" registra la asistencia; los ya confirmados lo muestran', async () => {
      const user = await abrirMisTurnos()
      api.confirmarAsistencia.mockResolvedValue({})
      const t1 = await tarjeta('Dra. Corazón')
      expect(within(await tarjeta('Dr. Niños')).getByText('✓ Confirmaste tu asistencia')).toBeInTheDocument()

      await user.click(within(t1).getByRole('button', { name: 'Confirmo que voy' }))
      expect(api.confirmarAsistencia).toHaveBeenCalledWith(1)
      expect(await within(await tarjeta('Dra. Corazón')).findByText('✓ Confirmaste tu asistencia')).toBeInTheDocument()
    })

    it('reprogramar abre el modal con ese turno y, al terminar, recarga la lista', async () => {
      const user = await abrirMisTurnos()
      await user.click(within(await tarjeta('Dra. Corazón')).getByRole('button', { name: 'Reprogramar' }))
      expect(screen.getByText('Reprogramando turno 1 de Dra. Corazón')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'simular reprogramado' }))
      expect(screen.queryByRole('dialog', { name: 'Modal reprogramar' })).not.toBeInTheDocument()
      expect(api.misTurnos).toHaveBeenCalledTimes(2)
    })

    it('un error al cargar se muestra en la lista', async () => {
      api.misTurnos.mockRejectedValue(new Error('Sin conexión'))
      const user = userEvent.setup()
      montar(PACIENTE)
      await navegar(user, /^Mis turnos/)
      expect(await screen.findByText(/No se pudieron cargar tus turnos: Sin conexión/)).toBeInTheDocument()
    })
  })

  it('solicitar turno abre el asistente y, al crearse, lleva a "Mis turnos" con la lista actualizada', async () => {
    const user = userEvent.setup()
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await navegar(user, 'Solicitar turno')
    expect(screen.getByRole('dialog', { name: 'Modal nuevo turno' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'simular turno creado' }))
    expect(screen.queryByRole('dialog', { name: 'Modal nuevo turno' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Mis turnos' })).toBeInTheDocument()
    expect(api.misTurnos).toHaveBeenCalledTimes(2)
  })

  it('el historial muestra finalizados y cancelados, el más reciente primero', async () => {
    const user = userEvent.setup()
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await navegar(user, 'Historial')

    const titulos = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)
    expect(titulos).toEqual(['Dra. Ojos', 'Dr. Piel']) // 25/02 antes que 20/02
    expect(screen.getByText('2 turnos en tu historial')).toBeInTheDocument()
  })

  it('el recordatorio se puede cerrar', async () => {
    const user = userEvent.setup()
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await user.click(screen.getByRole('button', { name: 'Cerrar recordatorio' }))
    expect(screen.queryByText(/Recordatorio/)).not.toBeInTheDocument()
  })
})

describe('cuenta y sesión (cualquier rol)', () => {
  it('"Salir" pide confirmación antes de cerrar la sesión', async () => {
    const user = userEvent.setup()
    const { onLogout } = montar(PACIENTE)
    await screen.findByText(/Recordatorio/)

    await user.click(screen.getByRole('button', { name: 'Salir' }))
    const dialogo = screen.getByRole('heading', { name: '¿Cerrar sesión?' }).closest('.fixed')
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    expect(onLogout).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Salir' }))
    await user.click(screen.getByRole('button', { name: 'Sí, salir' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('el nombre abre el perfil', async () => {
    const user = userEvent.setup()
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await user.click(screen.getByTitle('Ver mi perfil'))
    expect(screen.getByText('Perfil de Ana Gómez')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'cerrar perfil' }))
    expect(screen.queryByRole('dialog', { name: 'Modal perfil' })).not.toBeInTheDocument()
  })

  it('el menú de celular se abre y se cierra con Escape', async () => {
    const user = userEvent.setup()
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await user.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }))
    expect(document.getElementById('menu-mobile')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(document.getElementById('menu-mobile')).not.toBeInTheDocument()
  })

  it('las preferencias de accesibilidad guardadas se aplican y se vuelven a guardar', async () => {
    getPreferenciasAccesibilidad.mockReturnValue({ altoContraste: true, modoOscuro: false })
    const { container } = render(<Dashboard usuario={PACIENTE} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await screen.findByText(/Recordatorio/)
    expect(container.firstChild).toHaveClass('high-contrast')
    expect(guardarPreferenciasAccesibilidad).toHaveBeenCalledWith(expect.objectContaining({ altoContraste: true, modoOscuro: false }))
  })
})

describe('administrador', () => {
  const MEDICOS_ADMIN = [
    {
      idMedico: 10, matricula: 'MP-1', consultorio: 'A', duracionTurnoMinutos: 30,
      usuario: { idUsuario: 5, nomYape: 'Dra. Corazón', email: 'corazon@correo.com', dni: '25111222', activo: true },
      especialidades: [{ idEspecialidad: 1, nombre: 'Cardiología', activo: true }],
    },
    {
      idMedico: 11, matricula: 'MP-2', consultorio: null, duracionTurnoMinutos: 45,
      usuario: { idUsuario: 6, nomYape: 'Dr. Niños', email: 'ninos@correo.com', dni: '26111222', activo: false },
      especialidades: [{ idEspecialidad: 2, nombre: 'Pediatría', activo: false }],
    },
  ]
  const turnoAdmin = (idTurno, fechaYhora, estado, paciente, medico) => ({
    idTurno, fechaYhora, estado, especialidad: { nombre: 'Cardiología' },
    paciente: { usuario: { nomYape: paciente, email: 'x@x.com' } },
    medico: { usuario: { nomYape: medico }, especialidades: [] },
  })
  const TURNOS_ADMIN = [
    turnoAdmin(11, '2026-03-05T13:00:00.000Z', 'PENDIENTE', 'Ana Gómez', 'Dra. Corazón'),
    turnoAdmin(12, '2026-03-06T13:00:00.000Z', 'CONFIRMADO', 'Beto Ruiz', 'Dr. Niños'),
    turnoAdmin(13, '2026-03-07T13:00:00.000Z', 'CANCELADO', 'Carla Paz', 'Dra. Corazón'),
    turnoAdmin(14, '2026-02-27T13:00:00.000Z', 'PENDIENTE', 'Dani Sol', 'Dr. Niños'), // ya pasó
  ]

  beforeEach(() => {
    api.todosLosTurnos.mockResolvedValue({ data: TURNOS_ADMIN })
    api.todosLosMedicos.mockResolvedValue({ data: MEDICOS_ADMIN })
  })

  async function abrirAdmin() {
    const user = userEvent.setup()
    montar(ADMIN)
    await navegar(user, 'Administración')
    await screen.findByText('Mostrando 4 de 4 turnos')
    return user
  }

  it('pide los turnos de todos y los médicos, y no los turnos propios', async () => {
    await abrirAdmin()
    expect(api.todosLosTurnos).toHaveBeenCalledTimes(1)
    expect(api.todosLosMedicos).toHaveBeenCalledTimes(1)
    expect(api.misTurnos).not.toHaveBeenCalled()
  })

  it('muestra las estadísticas por estado', async () => {
    await abrirAdmin()
    const valor = (etiqueta) => screen.getByText(etiqueta).nextElementSibling.textContent
    expect(valor('Total de turnos')).toBe('4')
    expect(valor('Confirmados')).toBe('1')
    expect(valor('Pendientes')).toBe('2')
    expect(valor('Cancelados')).toBe('1')
  })

  it('buscar filtra por paciente, médico o especialidad', async () => {
    const user = await abrirAdmin()
    const buscador = screen.getByLabelText('Buscar por paciente, médico o especialidad')

    await user.type(buscador, 'beto')
    expect(screen.getByText('Mostrando 1 de 4 turnos')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Beto Ruiz' })).toBeInTheDocument()

    await user.clear(buscador)
    await user.type(buscador, 'nadie-con-este-nombre')
    expect(screen.getByText('No se encontraron turnos con los filtros aplicados.')).toBeInTheDocument()
  })

  it('el selector de estado filtra', async () => {
    const user = await abrirAdmin()
    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'Cancelado')
    expect(screen.getByText('Mostrando 1 de 4 turnos')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Carla Paz' })).toBeInTheDocument()
  })

  it('confirma un turno pendiente', async () => {
    const user = await abrirAdmin()
    api.actualizarEstadoTurno.mockResolvedValue({})
    const t = (await screen.findByRole('heading', { name: 'Ana Gómez' })).closest('.border-l-4')
    await user.click(within(t).getByRole('button', { name: 'Confirmar' }))

    expect(api.actualizarEstadoTurno).toHaveBeenCalledWith(11, 'CONFIRMADO')
    expect(await within(t).findByText('Confirmado')).toBeInTheDocument()
  })

  it('cancelar pide confirmación y luego marca el turno como cancelado', async () => {
    const user = await abrirAdmin()
    api.actualizarEstadoTurno.mockResolvedValue({})
    const t = screen.getByRole('heading', { name: 'Ana Gómez' }).closest('.border-l-4')
    await user.click(within(t).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText(/Ana Gómez con Dra\. Corazón/)).toBeInTheDocument()
    expect(api.actualizarEstadoTurno).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Sí, cancelar turno' }))
    expect(api.actualizarEstadoTurno).toHaveBeenCalledWith(11, 'CANCELADO')
  })

  it('no deja confirmar un turno cancelado, ya confirmado o con el horario vencido', async () => {
    await abrirAdmin()
    const confirmarDe = (paciente) =>
      within(screen.getByRole('heading', { name: paciente }).closest('.border-l-4')).getByRole('button', { name: 'Confirmar' })
    expect(confirmarDe('Carla Paz')).toBeDisabled() // cancelado
    expect(confirmarDe('Beto Ruiz')).toBeDisabled() // ya confirmado
    expect(confirmarDe('Dani Sol')).toBeDisabled() // el horario pasó
    expect(confirmarDe('Ana Gómez')).toBeEnabled()
  })

  it('si el servidor rechaza el cambio, avisa y deja el estado como estaba', async () => {
    const user = await abrirAdmin()
    api.actualizarEstadoTurno.mockRejectedValue(new Error('El turno ya está cancelado'))
    const t = screen.getByRole('heading', { name: 'Ana Gómez' }).closest('.border-l-4')
    await user.click(within(t).getByRole('button', { name: 'Confirmar' }))
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith('No se pudo actualizar el turno: El turno ya está cancelado'))
    expect(within(t).getByText('Pendiente')).toBeInTheDocument()
  })

  it('un error al cargar los turnos se muestra', async () => {
    api.todosLosTurnos.mockRejectedValue(new Error('Sin conexión'))
    const user = userEvent.setup()
    montar(ADMIN)
    await navegar(user, 'Administración')
    expect(await screen.findByText(/No se pudieron cargar los turnos: Sin conexión/)).toBeInTheDocument()
  })

  describe('pestaña de médicos', () => {
    async function abrirMedicos() {
      const user = await abrirAdmin()
      await user.click(screen.getByRole('button', { name: 'Médicos' }))
      await screen.findByRole('heading', { name: 'Gestión de médicos' })
      return user
    }

    it('lista todos los médicos, incluso los inactivos y las especialidades dadas de baja', async () => {
      await abrirMedicos()
      const tabla = screen.getByRole('table')
      expect(within(tabla).getByText('corazon@correo.com')).toBeInTheDocument()
      expect(within(tabla).getByText('ninos@correo.com')).toBeInTheDocument()
      expect(within(tabla).getByText('Pediatría (inactiva)')).toBeInTheDocument()
      expect(within(tabla).getByText('Activo')).toBeInTheDocument()
      expect(within(tabla).getByText('Inactivo')).toBeInTheDocument()
      expect(within(tabla).getByText('45 min')).toBeInTheDocument()
    })

    it('desactivar a un médico activo lo marca como inactivo', async () => {
      const user = await abrirMedicos()
      api.cambiarEstadoMedico.mockResolvedValue({})
      const fila = within(screen.getByRole('table')).getByText('Dra. Corazón').closest('tr')
      await user.click(within(fila).getByRole('button', { name: 'Desactivar' }))

      expect(api.cambiarEstadoMedico).toHaveBeenCalledWith(10, false)
      expect(await within(fila).findByText('Inactivo')).toBeInTheDocument()
    })

    it('si el médico tiene turnos futuros pide confirmación y recién entonces los cancela', async () => {
      const user = await abrirMedicos()
      const conTurnos = Object.assign(new Error('Este médico tiene 2 turno(s) futuro(s) sin cerrar'), { turnosFuturos: 2 })
      api.cambiarEstadoMedico.mockRejectedValueOnce(conTurnos).mockResolvedValueOnce({})
      const fila = within(screen.getByRole('table')).getByText('Dra. Corazón').closest('tr')
      await user.click(within(fila).getByRole('button', { name: 'Desactivar' }))

      const dialogo = await screen.findByRole('alertdialog', { name: /Desactivar y cancelar/ })
      expect(within(dialogo).getByText(/2 turno[(]s[)] futuro[(]s[)]/)).toBeInTheDocument()
      expect(within(fila).getByText('Activo')).toBeInTheDocument()

      await user.click(within(dialogo).getByRole('button', { name: 'Sí, desactivar y cancelar' }))
      expect(api.cambiarEstadoMedico).toHaveBeenLastCalledWith(10, false, true)
      expect(await within(fila).findByText('Inactivo')).toBeInTheDocument()
    })

    it('"Volver" en la confirmación no desactiva a nadie', async () => {
      const user = await abrirMedicos()
      api.cambiarEstadoMedico.mockRejectedValueOnce(Object.assign(new Error('x'), { turnosFuturos: 1 }))
      const fila = within(screen.getByRole('table')).getByText('Dra. Corazón').closest('tr')
      await user.click(within(fila).getByRole('button', { name: 'Desactivar' }))
      await user.click(await screen.findByRole('button', { name: 'Volver' }))

      expect(api.cambiarEstadoMedico).toHaveBeenCalledTimes(1)
      expect(within(fila).getByText('Activo')).toBeInTheDocument()
    })

    it('activar a un médico inactivo lo reactiva', async () => {
      const user = await abrirMedicos()
      api.cambiarEstadoMedico.mockResolvedValue({})
      const fila = within(screen.getByRole('table')).getByText('Dr. Niños').closest('tr')
      await user.click(within(fila).getByRole('button', { name: 'Activar' }))

      expect(api.cambiarEstadoMedico).toHaveBeenCalledWith(11, true)
      expect(await within(fila).findByText('Activo')).toBeInTheDocument()
    })

    it('"Editar" abre la edición de ese médico', async () => {
      const user = await abrirMedicos()
      const fila = within(screen.getByRole('table')).getByText('Dra. Corazón').closest('tr')
      await user.click(within(fila).getByRole('button', { name: 'Editar' }))
      expect(screen.getByText('Editando a Dra. Corazón')).toBeInTheDocument()
    })

    it('el alta de especialidad/médico abre el modal y al cerrarlo recarga los médicos', async () => {
      const user = await abrirMedicos()
      await user.click(screen.getByRole('button', { name: '+ Especialidad / Médico' }))
      expect(screen.getByRole('dialog', { name: 'Modal alta' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'cerrar alta' }))
      expect(api.todosLosMedicos).toHaveBeenCalledTimes(2)
    })

    it('sin médicos cargados orienta al administrador', async () => {
      api.todosLosMedicos.mockResolvedValue({ data: [] })
      await abrirMedicos()
      expect(screen.getByText(/Todavía no hay médicos cargados/)).toBeInTheDocument()
    })
  })
})

describe('médico', () => {
  const pacienteApi = (nombre, extra = {}) => ({ obraSocial: 'OSDE', telefono: '1122334455', usuario: { nomYape: nombre, email: 'p@x.com' }, ...extra })
  const turnoMedico = (idTurno, fechaYhora, estado, paciente, extra = {}) => ({
    idTurno, fechaYhora, estado, confirmadoPorPaciente: false, paciente: pacienteApi(paciente), ...extra,
  })
  const AGENDA = [
    turnoMedico(21, '2026-03-02T18:00:00.000Z', 'PENDIENTE', 'Hoy Tarde'), // hoy 15:00, futuro
    turnoMedico(22, '2026-03-05T13:00:00.000Z', 'CONFIRMADO', 'Futuro Confirmado', { confirmadoPorPaciente: true }),
    turnoMedico(23, '2026-02-27T13:00:00.000Z', 'PENDIENTE', 'Pasado Pendiente'),
    turnoMedico(24, '2026-02-26T13:00:00.000Z', 'FINALIZADO', 'Ya Atendido'),
  ]

  beforeEach(() => {
    api.agendaMedico.mockResolvedValue({ data: AGENDA })
    api.misDisponibilidades.mockResolvedValue({ data: [] })
    api.misAusencias.mockResolvedValue({ data: [] })
  })

  async function abrirAgenda() {
    const user = userEvent.setup()
    montar(MEDICO)
    await navegar(user, /^Mi agenda/)
    await screen.findByRole('heading', { name: 'Mi agenda' })
    return user
  }
  const tarjetaPaciente = async (nombre) => (await screen.findByRole('heading', { name: nombre })).closest('.border-l-4')

  it('pide su agenda, su disponibilidad y sus ausencias; no los turnos de paciente', async () => {
    montar(MEDICO)
    await vi.waitFor(() => expect(api.agendaMedico).toHaveBeenCalledTimes(1))
    expect(api.misDisponibilidades).toHaveBeenCalledTimes(1)
    expect(api.misAusencias).toHaveBeenCalledTimes(1)
    expect(api.misTurnos).not.toHaveBeenCalled()
  })

  it('el menú del médico no incluye las secciones de paciente ni de admin', async () => {
    montar(MEDICO)
    expect(menu().getByRole('button', { name: /^Mi agenda/ })).toBeInTheDocument()
    expect(menu().getByRole('button', { name: 'Mi disponibilidad' })).toBeInTheDocument()
    expect(menu().queryByRole('button', { name: 'Solicitar turno' })).not.toBeInTheDocument()
    expect(menu().queryByRole('button', { name: 'Historial' })).not.toBeInTheDocument()
    expect(menu().queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument()
  })

  it('cuenta los turnos de hoy que no están cancelados', async () => {
    const user = await abrirAgenda()
    expect(screen.getByText('1 turno hoy')).toBeInTheDocument()
    await navegar(user, 'Inicio')
    expect(await screen.findByText('1 turno agendado')).toBeInTheDocument()
  })

  it('cada turno muestra los datos del paciente y si ya confirmó', async () => {
    await abrirAgenda()
    const t = await tarjetaPaciente('Futuro Confirmado')
    expect(within(t).getByText('✓ Paciente confirmó')).toBeInTheDocument()
    expect(within(t).getByText(/p@x\.com · 1122334455 · OSDE/)).toBeInTheDocument()
    expect(within(await tarjetaPaciente('Hoy Tarde')).queryByText('✓ Paciente confirmó')).not.toBeInTheDocument()
  })

  it('las acciones dependen del horario: confirmar solo a futuro, finalizar solo si ya pasó', async () => {
    await abrirAgenda()
    const futuro = await tarjetaPaciente('Hoy Tarde')
    expect(within(futuro).getByRole('button', { name: 'Confirmar' })).toBeEnabled()
    expect(within(futuro).getByRole('button', { name: 'Finalizar' })).toBeDisabled()

    const pasado = await tarjetaPaciente('Pasado Pendiente')
    expect(within(pasado).getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(within(pasado).getByRole('button', { name: 'Finalizar' })).toBeEnabled()

    const cerrado = await tarjetaPaciente('Ya Atendido')
    for (const accion of ['Confirmar', 'Finalizar', 'Cancelar']) {
      expect(within(cerrado).getByRole('button', { name: accion })).toBeDisabled()
    }
  })

  it('confirma un turno', async () => {
    const user = await abrirAgenda()
    api.actualizarEstadoTurno.mockResolvedValue({})
    const t = await tarjetaPaciente('Hoy Tarde')
    await user.click(within(t).getByRole('button', { name: 'Confirmar' }))
    expect(api.actualizarEstadoTurno).toHaveBeenCalledWith(21, 'CONFIRMADO')
    expect(await within(t).findByText('Confirmado')).toBeInTheDocument()
  })

  it('finaliza un turno que ya ocurrió', async () => {
    const user = await abrirAgenda()
    api.actualizarEstadoTurno.mockResolvedValue({})
    const t = await tarjetaPaciente('Pasado Pendiente')
    await user.click(within(t).getByRole('button', { name: 'Finalizar' }))
    expect(api.actualizarEstadoTurno).toHaveBeenCalledWith(23, 'FINALIZADO')
    expect(await within(t).findByText('Finalizado')).toBeInTheDocument()
  })

  it('cancelar un turno pide confirmación', async () => {
    const user = await abrirAgenda()
    api.actualizarEstadoTurno.mockResolvedValue({})
    await user.click(within(await tarjetaPaciente('Hoy Tarde')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText(/Hoy Tarde — /)).toBeInTheDocument()
    expect(api.actualizarEstadoTurno).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Sí, cancelar turno' }))
    expect(api.actualizarEstadoTurno).toHaveBeenCalledWith(21, 'CANCELADO')
  })

  it('sin turnos asignados lo dice', async () => {
    api.agendaMedico.mockResolvedValue({ data: [] })
    await abrirAgenda()
    expect(await screen.findByText('Todavía no tenés turnos asignados.')).toBeInTheDocument()
  })

  it('un error al cargar la agenda se muestra', async () => {
    api.agendaMedico.mockRejectedValue(new Error('Acceso denegado'))
    await abrirAgenda()
    expect(await screen.findByText(/No se pudo cargar tu agenda: Acceso denegado/)).toBeInTheDocument()
  })

  describe('disponibilidad semanal', () => {
    async function abrirDisponibilidad() {
      const user = userEvent.setup()
      montar(MEDICO)
      await navegar(user, 'Mi disponibilidad')
      await screen.findByRole('heading', { name: 'Mi disponibilidad' })
      return user
    }

    it('lista las franjas cargadas con día y horario', async () => {
      api.misDisponibilidades.mockResolvedValue({ data: [{ idDisponibilidad: 1, diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 }] })
      await abrirDisponibilidad()
      expect(await screen.findByText('Lunes — 08:00 a 12:00')).toBeInTheDocument()
    })

    it('sin franjas explica el comportamiento por defecto', async () => {
      await abrirDisponibilidad()
      expect(await screen.findByText(/Todavía no cargaste ninguna franja horaria/)).toBeInTheDocument()
    })

    it('agrega una franja (por defecto lunes 08:00 a 12:00) y la ordena junto a las demás', async () => {
      api.misDisponibilidades.mockResolvedValue({ data: [{ idDisponibilidad: 2, diaSemana: 3, horaInicioMinutos: 840, horaFinMinutos: 960 }] })
      api.crearDisponibilidad.mockResolvedValue({ data: { idDisponibilidad: 3, diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 } })
      const user = await abrirDisponibilidad()
      await screen.findByText('Miércoles — 14:00 a 16:00')

      await user.click(screen.getByRole('button', { name: '+ Agregar franja' }))
      expect(api.crearDisponibilidad).toHaveBeenCalledWith({ diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 })
      const franjas = (await screen.findAllByText(/ — \d\d:\d\d a \d\d:\d\d/)).map((n) => n.textContent)
      expect(franjas).toEqual(['Lunes — 08:00 a 12:00', 'Miércoles — 14:00 a 16:00'])
    })

    it('muestra el error del servidor al agregar una franja que se superpone', async () => {
      api.crearDisponibilidad.mockRejectedValue(new Error('La franja se superpone con otra existente'))
      const user = await abrirDisponibilidad()
      await user.click(screen.getByRole('button', { name: '+ Agregar franja' }))
      expect(await screen.findByText('La franja se superpone con otra existente')).toBeInTheDocument()
    })

    it('elimina una franja', async () => {
      api.misDisponibilidades.mockResolvedValue({ data: [{ idDisponibilidad: 7, diaSemana: 2, horaInicioMinutos: 480, horaFinMinutos: 600 }] })
      api.eliminarDisponibilidad.mockResolvedValue({})
      const user = await abrirDisponibilidad()
      await screen.findByText('Martes — 08:00 a 10:00')
      await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])

      expect(api.eliminarDisponibilidad).toHaveBeenCalledWith(7)
      await vi.waitFor(() => expect(screen.queryByText('Martes — 08:00 a 10:00')).not.toBeInTheDocument())
    })
  })

  describe('ausencias puntuales', () => {
    async function abrirDisponibilidad() {
      const user = userEvent.setup()
      montar(MEDICO)
      await navegar(user, 'Mi disponibilidad')
      await screen.findByRole('heading', { name: 'Ausencias puntuales' })
      return user
    }

    it('muestra las ausencias con el día correcto (fechas guardadas como medianoche UTC)', async () => {
      api.misAusencias.mockResolvedValue({
        data: [{ idAusencia: 1, fechaInicio: '2026-03-05T00:00:00.000Z', fechaFin: '2026-03-06T00:00:00.000Z', motivo: 'Vacaciones' }],
      })
      await abrirDisponibilidad()
      // En Argentina (UTC-3) 00:00Z es el día anterior: la pantalla tiene que leer en UTC.
      expect(await screen.findByText(/05\/03\/2026 a 06\/03\/2026/)).toBeInTheDocument()
      expect(screen.getByText(/Vacaciones/)).toBeInTheDocument()
    })

    it('agrega una ausencia y limpia el formulario', async () => {
      api.crearAusencia.mockResolvedValue({
        data: { idAusencia: 9, fechaInicio: '2026-04-10T00:00:00.000Z', fechaFin: '2026-04-12T00:00:00.000Z', motivo: 'Congreso' },
      })
      const user = await abrirDisponibilidad()
      const [desde, hasta] = document.querySelectorAll('input[type="date"]')
      await user.type(desde, '2026-04-10')
      await user.type(hasta, '2026-04-12')
      await user.type(screen.getByPlaceholderText('Ej: Vacaciones'), 'Congreso')
      await user.click(screen.getByRole('button', { name: '+ Agregar ausencia' }))

      expect(api.crearAusencia).toHaveBeenCalledWith({ fechaInicio: '2026-04-10', fechaFin: '2026-04-12', motivo: 'Congreso' })
      expect(await screen.findByText(/10\/04\/2026 a 12\/04\/2026/)).toBeInTheDocument()
      expect(desde).toHaveValue('')
      expect(screen.getByPlaceholderText('Ej: Vacaciones')).toHaveValue('')
    })

    it('avisa cuántos turnos ya reservados quedaron dentro de la ausencia', async () => {
      api.crearAusencia.mockResolvedValue({
        data: { idAusencia: 9, fechaInicio: '2026-04-10T00:00:00.000Z', fechaFin: '2026-04-12T00:00:00.000Z', motivo: null },
        turnosAfectados: 3,
      })
      const user = await abrirDisponibilidad()
      const [desde, hasta] = document.querySelectorAll('input[type="date"]')
      await user.type(desde, '2026-04-10')
      await user.type(hasta, '2026-04-12')
      await user.click(screen.getByRole('button', { name: '+ Agregar ausencia' }))

      expect(await screen.findByText(/tenés 3 turno[(]s[)] ya reservado[(]s[)]/)).toBeInTheDocument()
    })

    it('muestra el error del servidor (por ejemplo, fechas invertidas)', async () => {
      api.crearAusencia.mockRejectedValue(new Error('La fecha de fin no puede ser anterior a la de inicio'))
      const user = await abrirDisponibilidad()
      const [desde, hasta] = document.querySelectorAll('input[type="date"]')
      await user.type(desde, '2026-04-12')
      await user.type(hasta, '2026-04-10')
      await user.click(screen.getByRole('button', { name: '+ Agregar ausencia' }))
      expect(await screen.findByText('La fecha de fin no puede ser anterior a la de inicio')).toBeInTheDocument()
    })

    it('elimina una ausencia', async () => {
      api.misAusencias.mockResolvedValue({
        data: [{ idAusencia: 4, fechaInicio: '2026-03-05T00:00:00.000Z', fechaFin: '2026-03-05T00:00:00.000Z', motivo: null }],
      })
      api.eliminarAusencia.mockResolvedValue({})
      const user = await abrirDisponibilidad()
      await screen.findByText(/05\/03\/2026 a 05\/03\/2026/)
      await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])
      expect(api.eliminarAusencia).toHaveBeenCalledWith(4)
      await vi.waitFor(() => expect(screen.queryByText(/05\/03\/2026 a 05\/03\/2026/)).not.toBeInTheDocument())
    })
  })
})

describe('orientación y teclado (WCAG 2.4, 2.1.1)', () => {
  const tituloPrincipal = () => within(screen.getByRole('main')).getByRole('heading', { level: 1 })

  it('el primer Tab ofrece "Saltar al contenido", que apunta al <main>', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await user.tab()
    const salto = screen.getByRole('link', { name: 'Saltar al contenido' })
    expect(salto).toHaveFocus()
    expect(salto).toHaveAttribute('href', '#contenido-principal')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido-principal')
  })

  it('el menú tiene nombre y marca la vista actual con aria-current', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    expect(menu().getByRole('button', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    await navegar(user, 'Historial')
    expect(menu().getByRole('button', { name: 'Historial' })).toHaveAttribute('aria-current', 'page')
    expect(menu().getByRole('button', { name: 'Inicio' })).not.toHaveAttribute('aria-current')
  })

  it('cada vista pone su título a la pestaña y, al CAMBIAR de vista, el foco va a su título', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    expect(document.title).toBe('Inicio — Salux')
    // Al cargar no se roba el foco: recién se mueve cuando la persona navega.
    expect(tituloPrincipal()).not.toHaveFocus()

    await navegar(user, 'Historial')
    expect(document.title).toBe('Historial — Salux')
    expect(tituloPrincipal()).toHaveFocus()
  })

  it('el logo y las tarjetas del inicio son botones que se activan con el teclado', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    await navegar(user, 'Historial')

    screen.getByRole('button', { name: 'Salux, ir al inicio' }).focus()
    await user.keyboard('{Enter}')
    expect(document.title).toBe('Inicio — Salux')

    // El título de la tarjeta es el botón; el resto de la tarjeta lo estira (after:inset-0).
    within(screen.getByRole('main')).getByRole('button', { name: /^Mis turnos/ }).focus()
    await user.keyboard('{Enter}')
    expect(document.title).toBe('Mis turnos — Salux')
  })

  it('la tarjeta "Mis turnos" anuncia cuántos turnos activos hay', async () => {
    montar(PACIENTE)
    await screen.findByText(/Recordatorio/)
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^Mis turnos\s*\(2 activos\)$/ })).toBeInTheDocument()
  })

  it('la tabla de médicos del admin no tiene encabezados vacíos', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    api.todosLosTurnos.mockResolvedValue({ data: [] })
    api.todosLosMedicos.mockResolvedValue({ data: [{
      idMedico: 5, matricula: 'MP-5', consultorio: 'A', duracionTurnoMinutos: 30,
      usuario: { idUsuario: 5, nomYape: 'Dr. House', email: 'h@x.com', dni: '1', activo: true }, especialidades: [],
    }] })
    montar(ADMIN)
    await navegar(user, 'Administración')
    await user.click(await screen.findByRole('button', { name: 'Médicos', exact: true }))
    const tabla = await screen.findByRole('table')
    for (const columna of within(tabla).getAllByRole('columnheader')) {
      expect(columna, 'encabezado de columna sin texto').toHaveAccessibleName()
    }
  })

  describe('"reducir animaciones" respeta el sistema operativo', () => {
    const conPreferenciaDelSistema = (reduce) => {
      window.matchMedia = vi.fn().mockImplementation((consulta) => ({
        matches: reduce && consulta === '(prefers-reduced-motion: reduce)',
        media: consulta, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }))
    }
    afterEach(() => { delete window.matchMedia })

    it('sin preferencia guardada, el sistema que pide menos movimiento apaga las animaciones', async () => {
      conPreferenciaDelSistema(true)
      montar(PACIENTE)
      await screen.findByText(/Recordatorio/)
      expect(document.querySelector('.reduce-motion')).not.toBeNull()
    })

    it('sin preferencia guardada y sin pedido del sistema, las animaciones siguen', async () => {
      conPreferenciaDelSistema(false)
      montar(PACIENTE)
      await screen.findByText(/Recordatorio/)
      expect(document.querySelector('.reduce-motion')).toBeNull()
    })

    it('lo que la persona eligió en la app gana sobre el sistema', async () => {
      conPreferenciaDelSistema(true)
      getPreferenciasAccesibilidad.mockReturnValue({ reducirAnimaciones: false })
      montar(PACIENTE)
      await screen.findByText(/Recordatorio/)
      expect(document.querySelector('.reduce-motion')).toBeNull()
    })
  })
})
