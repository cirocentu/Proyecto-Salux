import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Guarda contra regresiones de accesibilidad: en cada pantalla, todo campo y todo
// botón tiene que tener un nombre que un lector de pantalla pueda anunciar, y cada
// <label htmlFor> tiene que apuntar a un campo que existe.

vi.mock('./api', () => ({
  api: {
    refrescarSesion: vi.fn(), configPublica: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(),
    verificarEmail: vi.fn(), reenviarVerificacion: vi.fn(), solicitarResetContrasena: vi.fn(),
    resetearContrasena: vi.fn(), cambiarContrasena: vi.fn(), perfil: vi.fn(), actualizarPerfil: vi.fn(),
    actualizarPerfilPaciente: vi.fn(), logoutTodas: vi.fn(), especialidades: vi.fn(), actualizarMedico: vi.fn(),
    crearEspecialidad: vi.fn(), eliminarEspecialidad: vi.fn(), crearMedico: vi.fn(),
    misTurnos: vi.fn(), todosLosTurnos: vi.fn(), todosLosMedicos: vi.fn(), agendaMedico: vi.fn(),
    misDisponibilidades: vi.fn(), misAusencias: vi.fn(), medicos: vi.fn(), disponibilidadDeMedico: vi.fn(),
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
import Dashboard from './Dashboard'
import NuevoTurnoModal from './NuevoTurnoModal'
import ReprogramarTurnoModal from './ReprogramarTurnoModal'
import { api, getUsuarioGuardado, getPreferenciasAccesibilidad } from './api'

// Busca un campo por su etiqueta. El "*" de obligatorio está oculto para los lectores
// de pantalla (aria-hidden) pero sí está en el texto del label, de ahí el patrón.
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const campo = (nombre) => screen.getByLabelText(new RegExp(`^${escapar(nombre)}\\s*\\*?$`))

function exigirNombresAccesibles(contenedor = document.body) {
  const controles = contenedor.querySelectorAll('input:not([type="hidden"]), select, textarea, button')
  expect(controles.length).toBeGreaterThan(0)
  for (const control of controles) {
    expect(control, `sin nombre accesible: ${control.outerHTML.slice(0, 140)}`).toHaveAccessibleName()
  }
  for (const etiqueta of contenedor.querySelectorAll('label[for]')) {
    const destino = contenedor.querySelector(`[id="${etiqueta.getAttribute('for')}"]`)
    expect(destino, `el label "${etiqueta.textContent}" apunta a #${etiqueta.getAttribute('for')}, que no existe`).not.toBeNull()
  }
  // Los textos de ayuda enlazados a un campo tienen que existir.
  for (const campo of contenedor.querySelectorAll('[aria-describedby]')) {
    for (const id of campo.getAttribute('aria-describedby').split(/\s+/)) {
      expect(contenedor.querySelector(`[id="${id}"]`), `aria-describedby="${id}" no existe`).not.toBeNull()
    }
  }
}

// El mismo id no puede repetirse dentro de lo que está en pantalla.
function exigirIdsUnicos(contenedor = document.body) {
  const ids = [...contenedor.querySelectorAll('[id]')].map((n) => n.id)
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
}

beforeEach(() => {
  getUsuarioGuardado.mockReturnValue(null)
  getPreferenciasAccesibilidad.mockReturnValue({})
  api.refrescarSesion.mockRejectedValue(new Error('Sin sesión'))
  api.configPublica.mockResolvedValue({ data: { requiereVerificacionEmail: true } })
  api.especialidades.mockResolvedValue({ data: [{ idEspecialidad: 1, nombre: 'Cardiología', medicos: [] }] })
  api.perfil.mockResolvedValue({ usuario: { id: 1, email: 'a@b.com', nombre: 'Ana', dni: '30123456', rol: 'paciente', obraSocial: '', telefono: '' } })
  api.misTurnos.mockResolvedValue({ data: [] })
  api.todosLosTurnos.mockResolvedValue({ data: [] })
  api.todosLosMedicos.mockResolvedValue({ data: [] })
  api.agendaMedico.mockResolvedValue({ data: [] })
  api.misDisponibilidades.mockResolvedValue({ data: [] })
  api.misAusencias.mockResolvedValue({ data: [] })
  api.medicos.mockResolvedValue({ data: [] })
  api.disponibilidadDeMedico.mockResolvedValue({ data: { disponibilidades: [], ausencias: [] } })
})

describe('pantalla de acceso', () => {
  it('login', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Iniciar sesión' })
    exigirNombresAccesibles()
    exigirIdsUnicos()
  })

  it('cada etiqueta del login lleva al campo correcto', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Iniciar sesión' })
    expect(campo('DNI o Email')).toHaveAttribute('placeholder', expect.stringContaining('30456789'))
    expect(campo('Contraseña')).toHaveAttribute('type', 'password')
  })

  it('registro', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    exigirNombresAccesibles()
    exigirIdsUnicos()
    for (const nombre of ['Nombre completo', 'DNI', 'Email', 'Contraseña']) {
      expect(campo(nombre)).toBeInTheDocument()
    }
  })

  it('recuperar contraseña', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    exigirNombresAccesibles()
    expect(campo('Email')).toHaveAttribute('type', 'email')
  })

  it('nueva contraseña (enlace del mail)', async () => {
    window.history.pushState({}, '', '/?reset=TOKEN')
    render(<App />)
    await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
    exigirNombresAccesibles()
    expect(campo('Contraseña nueva')).toBeInTheDocument()
    expect(campo('Confirmar contraseña')).toBeInTheDocument()
  })

  it('el ojito anuncia su estado y el interruptor de modo adulto mayor es un switch', async () => {
    const user = userEvent.setup()
    render(<App />)
    const ojo = await screen.findByRole('button', { name: 'Mostrar contraseña' })
    expect(ojo).toHaveAttribute('aria-pressed', 'false')
    await user.click(ojo)
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true')

    const interruptor = screen.getByRole('switch', { name: 'Modo adulto mayor' })
    expect(interruptor).toHaveAttribute('aria-checked', 'false')
    await user.click(interruptor)
    expect(screen.getByRole('switch', { name: 'Modo adulto mayor' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('formularios de cuenta', () => {
  it('cambio de contraseña obligatorio', () => {
    render(<CambioContrasenaObligatorio usuario={{ nombre: 'Dr. House' }} onCambiada={vi.fn()} onLogout={vi.fn()} />)
    exigirNombresAccesibles()
    exigirIdsUnicos()
    expect(screen.getByLabelText(/Contraseña inicial/)).toHaveAttribute('autocomplete', 'current-password')
    expect(campo('Contraseña nueva')).toHaveAttribute('minlength', '10')
    expect(screen.getByLabelText(/Repetí la contraseña nueva/)).toBeInTheDocument()
  })

  it('perfil de paciente', async () => {
    render(<PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
    await screen.findByText('Datos personales')
    exigirNombresAccesibles()
    exigirIdsUnicos()
    for (const nombre of ['Nombre completo', 'Email', 'DNI', 'Obra social', 'Teléfono', 'Contraseña actual', 'Contraseña nueva', 'Confirmar contraseña']) {
      expect(campo(nombre)).toBeInTheDocument()
    }
    expect(campo('Email')).toBeDisabled()
  })

  it('perfil de médico', async () => {
    api.perfil.mockResolvedValue({ usuario: { id: 3, email: 'm@b.com', nombre: 'Dr. House', dni: '25111222', rol: 'medico', matricula: 'MP-1', consultorio: 'A' } })
    render(<PerfilModal usuario={{ id: 3, nombre: 'Dr. House', rol: 'medico' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
    await screen.findByText('Datos personales')
    exigirNombresAccesibles()
    expect(campo('Matrícula')).toHaveValue('MP-1')
    expect(campo('Consultorio')).toHaveValue('A')
  })
})

describe('administración', () => {
  it('edición de médico', async () => {
    const medico = { idMedico: 10, consultorio: 'A', duracionTurnoMinutos: 30, usuario: { nomYape: 'Dra. Corazón' }, especialidades: [] }
    render(<EditarMedicoModal medico={medico} onClose={vi.fn()} onActualizado={vi.fn()} />)
    await screen.findByRole('checkbox', { name: 'Cardiología' })
    exigirNombresAccesibles()
    exigirIdsUnicos()
    expect(campo('Consultorio')).toHaveValue('A')
    expect(campo('Duración del turno (minutos)')).toHaveValue(30)
  })

  it('alta de especialidad', async () => {
    render(<AdminAltaModal onClose={vi.fn()} />)
    await screen.findByText('Cardiología')
    exigirNombresAccesibles()
    expect(campo('Nombre de la especialidad')).toBeInTheDocument()
  })

  it('alta de médico', async () => {
    const user = userEvent.setup()
    render(<AdminAltaModal onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Médico' }))
    await screen.findByRole('button', { name: 'Crear médico' })
    exigirNombresAccesibles()
    exigirIdsUnicos()
    for (const nombre of ['Nombre', 'Apellido', 'Email', 'DNI', 'Contraseña inicial', 'Matrícula', 'Consultorio', 'Duración del turno (minutos)']) {
      expect(campo(nombre)).toBeInTheDocument()
    }
  })
})

describe('panel principal', () => {
  const usuario = (rol) => ({ id: 1, nombre: 'Usuario Prueba', rol })

  it('paciente', async () => {
    const user = userEvent.setup()
    render(<Dashboard usuario={usuario('paciente')} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await user.click(await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('button', { name: /^Mis turnos/ }))
    await screen.findByRole('heading', { name: 'Mis turnos' })
    exigirNombresAccesibles()
  })

  it('administrador: turnos y médicos', async () => {
    const user = userEvent.setup()
    render(<Dashboard usuario={usuario('admin')} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await user.click(await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('button', { name: 'Administración' }))
    await screen.findByRole('heading', { name: 'Gestión de turnos' })
    exigirNombresAccesibles()
    expect(campo('Buscar por paciente, médico o especialidad')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Médicos' }))
    await screen.findByRole('heading', { name: 'Gestión de médicos' })
    exigirNombresAccesibles()
  })

  it('médico: disponibilidad semanal y ausencias', async () => {
    const user = userEvent.setup()
    render(<Dashboard usuario={usuario('medico')} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await user.click(await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('button', { name: 'Mi disponibilidad' }))
    await screen.findByRole('heading', { name: 'Ausencias puntuales' })
    exigirNombresAccesibles()
    exigirIdsUnicos()
    expect(campo('Día')).toBeInTheDocument()
    expect(campo('Motivo (opcional)')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Desde')).toHaveLength(2)
    expect(screen.getAllByLabelText('Hasta')).toHaveLength(2)
  })
})

describe('textos de ayuda', () => {
  it('los requisitos de contraseña se anuncian junto al campo', async () => {
    render(<CambioContrasenaObligatorio usuario={{ nombre: 'Dr. House' }} onCambiada={vi.fn()} onLogout={vi.fn()} />)
    expect(campo('Contraseña nueva')).toHaveAccessibleDescription(/Mínimo 10 caracteres, con letras y números/)
  })

  it('en el alta de médico, la contraseña, el consultorio y la duración tienen su ayuda', async () => {
    const user = userEvent.setup()
    render(<AdminAltaModal onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Médico' }))
    await screen.findByRole('button', { name: 'Crear médico' })

    expect(campo('Contraseña inicial')).toHaveAccessibleDescription(/tener que cambiarla en su primer ingreso/)
    expect(campo('Consultorio')).toHaveAccessibleDescription(/no escribas la palabra/)
    expect(campo('Duración del turno (minutos)')).toHaveAccessibleDescription(/Cuánto dura cada turno/)
  })

  it('en la pantalla de nueva contraseña también', async () => {
    window.history.pushState({}, '', '/?reset=TOKEN')
    render(<App />)
    await screen.findByRole('button', { name: 'Guardar contraseña nueva' })
    expect(campo('Contraseña nueva')).toHaveAccessibleDescription(/sin contraseñas comunes/)
  })
})

describe('diálogos', () => {
  const TURNO = { id: 1, medicoId: 10, medico: 'Dra. Corazón', especialidad: 'Cardiología', fecha: 'Jueves', hora: '10:00 hs' }
  const MEDICO = { idMedico: 10, consultorio: 'A', duracionTurnoMinutos: 30, usuario: { nomYape: 'Dra. Corazón' }, especialidades: [] }

  // Cada modal: [cómo montarlo, nombre del diálogo, esperar a que cargue]
  const casos = [
    ['solicitar turno', (onClose) => <NuevoTurnoModal onClose={onClose} onCreado={vi.fn()} />, 'Solicitar turno'],
    ['reprogramar turno', (onClose) => <ReprogramarTurnoModal turno={TURNO} onClose={onClose} onReprogramado={vi.fn()} />, 'Reprogramar turno'],
    ['perfil', (onClose) => <PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={onClose} onActualizado={vi.fn()} />, 'Mi perfil'],
    ['edición de médico', (onClose) => <EditarMedicoModal medico={MEDICO} onClose={onClose} onActualizado={vi.fn()} />, 'Editar médico'],
    ['alta de especialidades y médicos', (onClose) => <AdminAltaModal onClose={onClose} />, 'Agregar al sistema'],
  ]

  it.each(casos)('%s es un diálogo modal con nombre, recibe el foco y se cierra con Escape', async (_nombre, montar, titulo) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(montar(onClose))

    const dialogo = await screen.findByRole('dialog', { name: titulo })
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(dialogo).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('el foco queda dentro del modal aunque se siga tabulando', async () => {
    const user = userEvent.setup()
    render(<PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
    const dialogo = await screen.findByRole('dialog', { name: 'Mi perfil' })
    await screen.findByText('Datos personales')

    for (let i = 0; i < 25; i += 1) {
      await user.tab()
      expect(dialogo.contains(document.activeElement)).toBe(true)
    }
  })

  it('confirmar el borrado de una especialidad es un diálogo encima del modal de alta: Escape cierra solo ese', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AdminAltaModal onClose={onClose} />)
    await user.click((await screen.findByText('Cardiología')).closest('li').querySelector('button'))

    const confirmacion = screen.getByRole('dialog', { name: '¿Eliminar "Cardiología"?' })
    expect(confirmacion).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '¿Eliminar "Cardiología"?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Agregar al sistema' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"¿Cancelar este turno?" y "¿Cerrar sesión?" son diálogos de alerta que Escape descarta', async () => {
    const user = userEvent.setup()
    api.misTurnos.mockResolvedValue({ data: [] })
    const onLogout = vi.fn()
    render(<Dashboard usuario={{ id: 1, nombre: 'Ana Gómez', rol: 'paciente' }} onLogout={onLogout} onUsuarioActualizado={vi.fn()} />)

    const salir = await screen.findByRole('button', { name: 'Salir' })
    await user.click(salir)
    const alerta = screen.getByRole('alertdialog', { name: '¿Cerrar sesión?' })
    expect(alerta).toHaveFocus()
    expect(alerta).toHaveAttribute('aria-modal', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
    expect(salir).toHaveFocus() // el foco vuelve a "Salir"
  })
})

const TURNO_DEMO = { id: 1, medicoId: 10, medico: 'Dra. Corazón', especialidad: 'Cardiología', fecha: 'Jueves', hora: '10:00 hs' }

describe('mensajes que se anuncian solos', () => {
  it('error de login: aparece como alerta', async () => {
    const user = userEvent.setup()
    api.login.mockRejectedValue(new Error('Credenciales inválidas'))
    render(<App />)
    await screen.findByRole('button', { name: 'Iniciar sesión' })
    await user.type(campo('DNI o Email'), 'ana@correo.com')
    await user.type(campo('Contraseña'), 'MiClave-2026x')
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas')
  })

  it('aviso de cuenta creada (con verificación de email): aparece como estado, no como alerta', async () => {
    const user = userEvent.setup()
    api.register.mockResolvedValue({ requiereVerificacion: true, message: 'Te enviamos un email para activar tu cuenta.' })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    await user.type(campo('Nombre completo'), 'Ana Gómez')
    await user.type(campo('DNI'), '30123456')
    await user.type(campo('Email'), 'ana@correo.com')
    await user.type(campo('Contraseña'), 'Zorro-Azul-4721')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Te enviamos un email para activar tu cuenta.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('la pantalla inicial de carga es un estado', () => {
    api.refrescarSesion.mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando...')
  })

  it('cambio de contraseña obligatorio: la confirmación distinta es una alerta', async () => {
    const user = userEvent.setup()
    render(<CambioContrasenaObligatorio usuario={{ nombre: 'Dr. House' }} onCambiada={vi.fn()} onLogout={vi.fn()} />)
    await user.type(screen.getByLabelText(/Contraseña inicial/), 'Inicial-Verde-4482')
    await user.type(campo('Contraseña nueva'), 'Definitiva-Roja-7741')
    await user.type(screen.getByLabelText(/Repetí la contraseña nueva/), 'Definitiva-Roja-0000')
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
  })

  it('perfil: guardar es un estado y un rechazo de la contraseña es una alerta', async () => {
    const user = userEvent.setup()
    api.actualizarPerfil.mockResolvedValue({})
    api.actualizarPerfilPaciente.mockResolvedValue({})
    api.cambiarContrasena.mockRejectedValue(new Error('La contraseña actual es incorrecta'))
    render(<PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
    await screen.findByText('Datos personales')

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Datos actualizados con éxito.')

    await user.type(campo('Contraseña actual'), 'Equivocada-0000')
    await user.type(campo('Contraseña nueva'), 'Nueva-Clave-5678')
    await user.type(campo('Confirmar contraseña'), 'Nueva-Clave-5678')
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual es incorrecta')
  })

  it('perfil: el error de carga es una alerta', async () => {
    api.perfil.mockRejectedValue(new Error('Sin conexión'))
    render(<PerfilModal usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onClose={vi.fn()} onActualizado={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tu perfil: Sin conexión')
  })

  it('alta de especialidad: crear es un estado y un duplicado es una alerta', async () => {
    const user = userEvent.setup()
    api.crearEspecialidad.mockResolvedValueOnce({ data: { nombre: 'Neurología' } })
    api.crearEspecialidad.mockRejectedValueOnce(new Error('Ya existe una especialidad con ese nombre'))
    render(<AdminAltaModal onClose={vi.fn()} />)
    await screen.findByText('Cardiología')

    await user.type(campo('Nombre de la especialidad'), 'Neurología')
    await user.click(screen.getByRole('button', { name: 'Crear especialidad' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Especialidad "Neurología" creada con éxito.')

    await user.type(campo('Nombre de la especialidad'), 'Neurología')
    await user.click(screen.getByRole('button', { name: 'Crear especialidad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una especialidad con ese nombre')
  })

  it('alta de especialidad: si no carga la lista, es una alerta', async () => {
    api.especialidades.mockRejectedValue(new Error('Sin conexión'))
    render(<AdminAltaModal onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la lista: Sin conexión')
  })

  it('edición de médico sin especialidades: el aviso es una alerta', async () => {
    const user = userEvent.setup()
    const medico = { idMedico: 10, consultorio: 'A', duracionTurnoMinutos: 30, usuario: { nomYape: 'Dra. Corazón' }, especialidades: [] }
    render(<EditarMedicoModal medico={medico} onClose={vi.fn()} onActualizado={vi.fn()} />)
    await screen.findByRole('checkbox', { name: 'Cardiología' })
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(screen.getByRole('alert')).toHaveTextContent('El médico tiene que tener al menos una especialidad.')
  })

  it('solicitar y reprogramar turno: los errores de carga son alertas', async () => {
    api.especialidades.mockRejectedValue(new Error('Sin conexión'))
    const { unmount } = render(<NuevoTurnoModal onClose={vi.fn()} onCreado={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la información: Sin conexión')
    unmount()

    api.disponibilidadDeMedico.mockRejectedValue(new Error('Sin conexión'))
    render(<ReprogramarTurnoModal turno={TURNO_DEMO} onClose={vi.fn()} onReprogramado={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la disponibilidad del médico')
  })

  it('panel: mientras cargan los turnos es un estado y, si falla, una alerta', async () => {
    const user = userEvent.setup()
    api.misTurnos.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<Dashboard usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    expect(await screen.findByRole('status')).toHaveTextContent('Cargando tus turnos...')
    unmount()

    api.misTurnos.mockRejectedValue(new Error('Sin conexión'))
    render(<Dashboard usuario={{ id: 1, nombre: 'Ana', rol: 'paciente' }} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await user.click(await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('button', { name: /^Mis turnos/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar tus turnos: Sin conexión')
  })

  it('panel del administrador: el error de turnos y el de médicos son alertas', async () => {
    const user = userEvent.setup()
    api.todosLosTurnos.mockRejectedValue(new Error('Sin conexión'))
    api.todosLosMedicos.mockRejectedValue(new Error('Sin conexión'))
    render(<Dashboard usuario={{ id: 2, nombre: 'Admin', rol: 'admin' }} onLogout={vi.fn()} onUsuarioActualizado={vi.fn()} />)
    await user.click(await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('button', { name: 'Administración' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los turnos')

    // El aviso de turnos queda arriba en ambas pestañas: en "Médicos" se ven los dos.
    await user.click(screen.getByRole('button', { name: 'Médicos' }))
    await vi.waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    const avisos = screen.getAllByRole('alert').map((a) => a.textContent).join(' | ')
    expect(avisos).toMatch(/No se pudieron cargar los turnos/)
    expect(avisos).toMatch(/No se pudieron cargar los médicos/)
  })
})

// Guardia sobre el código fuente: un cuadro de error o de éxito nuevo que olvide su
// rol no llega a producción sin que falle este test.
describe('código fuente', () => {
  const archivos = Object.entries(
    import.meta.glob('./*.jsx', { eager: true, query: '?raw', import: 'default' })
  ).filter(([ruta]) => !ruta.includes('.test.'))

  it('hay componentes que revisar', () => {
    expect(archivos.length).toBeGreaterThan(5)
  })

  it.each(archivos)('%s: todo cuadro de error lleva role="alert" y todo cuadro de éxito role="status"', (_ruta, fuente) => {
    const sinRol = (patron, rol) =>
      [...fuente.matchAll(new RegExp(`<(?:div|p)\\b[^>]*${patron}[^>]*>`, 'g'))]
        .map((m) => m[0])
        .filter((etiqueta) => !etiqueta.includes(`role="${rol}"`))

    expect(sinRol('bg-red-500/10 border border-red-500/30', 'alert')).toEqual([])
    expect(sinRol('bg-emerald-500/10 border border-emerald-500/30', 'status')).toEqual([])
  })
})
