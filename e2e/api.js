// API simulada para las pruebas de accesibilidad: responde lo mismo que respondería el backend,
// con datos suficientes para que se dibujen todas las pantallas (listas, tablas, estados).

const dias = (n, hora = 13) => {
  const d = new Date(Date.now() + n * 24 * 3600 * 1000)
  d.setUTCHours(hora, 0, 0, 0)
  return d.toISOString()
}

const cardiologia = { idEspecialidad: 1, nombre: 'Cardiología', activo: true }
const pediatria = { idEspecialidad: 2, nombre: 'Pediatría', activo: true }

const medicoPublico = (id, nombre, esp) => ({
  idMedico: id, consultorio: 'A', duracionTurnoMinutos: 30, usuario: { nomYape: nombre, activo: true },
  especialidades: [esp], disponibilidades: [{ idDisponibilidad: id, diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 }],
  ausencias: [], proximaDisponibilidad: dias(3, 12),
})

const turnoDePaciente = (id, estado, delta, medico = 'Dr. Mauro Medina') => ({
  idTurno: id, fechaYhora: dias(delta), estado, confirmadoPorPaciente: estado === 'CONFIRMADO',
  especialidad: cardiologia, medico: { idMedico: 10, consultorio: 'A', usuario: { nomYape: medico }, especialidades: [cardiologia] },
})

const turnoConPaciente = (id, estado, delta, paciente = 'Paula Paciente') => ({
  idTurno: id, fechaYhora: dias(delta), estado, confirmadoPorPaciente: estado === 'CONFIRMADO', especialidad: cardiologia,
  paciente: { obraSocial: 'OSDE', telefono: '1122334455', usuario: { nomYape: paciente, email: 'paula@correo.test' } },
  medico: { idMedico: 10, usuario: { nomYape: 'Dr. Mauro Medina' }, especialidades: [cardiologia] },
})

export const USUARIOS = {
  paciente: { id: 1, nombre: 'Paula Paciente', rol: 'paciente', debeCambiarContrasena: false },
  medico: { id: 2, nombre: 'Dr. Mauro Medina', rol: 'medico', debeCambiarContrasena: false },
  admin: { id: 3, nombre: 'Ada Administradora', rol: 'admin', debeCambiarContrasena: false },
}

// Devuelve [estado, cuerpo] para cada ruta de la API.
function responder(rol, metodo, ruta) {
  const ok = (data) => [200, { ok: true, data }]

  if (ruta === '/api/auth/refresh') return [200, { ok: true, token: 'token-de-prueba', usuario: rol ? USUARIOS[rol] : null }, !rol]
  if (ruta === '/api/config') return ok({ requiereVerificacionEmail: false })
  if (ruta === '/api/auth/logout') return [200, { ok: true }]
  if (ruta === '/api/auth/perfil') {
    const u = USUARIOS[rol]
    return [200, {
      ok: true,
      usuario: { id: u.id, nombre: u.nombre, email: `${rol}@correo.test`, dni: '30123456', rol, obraSocial: 'OSDE', telefono: '1122334455', matricula: 'MP-1', consultorio: 'A' },
    }]
  }
  if (ruta === '/api/especialidades') {
    const conMedicos = (e) => ({ ...e, medicos: [{ idMedico: 10, usuario: { nomYape: 'Dr. Mauro Medina' } }] })
    return ok(rol === 'admin' ? [conMedicos(cardiologia), conMedicos(pediatria)] : [cardiologia, pediatria])
  }
  if (ruta === '/api/medicos') return ok([medicoPublico(10, 'Dr. Mauro Medina', cardiologia), medicoPublico(11, 'Dra. Lucía Ríos', pediatria)])
  if (ruta === '/api/medicos/todos') {
    return ok([10, 11].map((id, i) => ({
      idMedico: id, matricula: `MP-${id}`, consultorio: 'A', duracionTurnoMinutos: 30,
      usuario: { idUsuario: id, nomYape: i ? 'Dra. Lucía Ríos' : 'Dr. Mauro Medina', email: `medico${id}@correo.test`, dni: `2000000${id}`, activo: i === 0 },
      especialidades: [i ? pediatria : cardiologia],
    })))
  }
  if (ruta.startsWith('/api/disponibilidad/medico/')) {
    return ok({ duracionTurnoMinutos: 30, disponibilidades: [{ idDisponibilidad: 1, diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 }], ausencias: [] })
  }
  if (ruta === '/api/disponibilidad/mias') return ok([{ idDisponibilidad: 1, diaSemana: 1, horaInicioMinutos: 480, horaFinMinutos: 720 }, { idDisponibilidad: 2, diaSemana: 3, horaInicioMinutos: 840, horaFinMinutos: 1020 }])
  if (ruta === '/api/disponibilidad/ausencias/mias') return ok([{ idAusencia: 1, fechaInicio: dias(10, 0), fechaFin: dias(12, 0), motivo: 'Congreso' }])
  if (ruta === '/api/turnos/mis-turnos') {
    return ok([turnoDePaciente(1, 'PENDIENTE', 3), turnoDePaciente(2, 'CONFIRMADO', 5, 'Dra. Lucía Ríos'), turnoDePaciente(3, 'FINALIZADO', -6), turnoDePaciente(4, 'CANCELADO', -2)])
  }
  if (ruta === '/api/turnos/agenda-medico') {
    return ok([turnoConPaciente(11, 'PENDIENTE', 0.2), turnoConPaciente(12, 'CONFIRMADO', 4), turnoConPaciente(13, 'FINALIZADO', -5), turnoConPaciente(14, 'CANCELADO', -2)])
  }
  if (ruta === '/api/turnos') {
    return ok([turnoConPaciente(21, 'PENDIENTE', 2, 'Ana Gómez'), turnoConPaciente(22, 'CONFIRMADO', 4, 'Beto Ruiz'), turnoConPaciente(23, 'CANCELADO', -1, 'Carla Paz')])
  }
  return [404, { ok: false, message: `Ruta no simulada: ${metodo} ${ruta}` }]
}

// Engancha la API simulada a una página. `rol` null = nadie con sesión (pantalla de acceso).
export async function simularApi(page, rol) {
  await page.route('**/api/**', async (route) => {
    const peticion = route.request()
    const ruta = new URL(peticion.url()).pathname
    const [status, cuerpo, sinSesion] = responder(rol, peticion.method(), ruta)
    if (sinSesion) return route.fulfill({ status: 401, json: { ok: false, message: 'No hay una sesión para renovar' } })
    return route.fulfill({ status, json: cuerpo })
  })
}

// Temas de la app: las mismas preferencias que guarda el menú de accesibilidad.
// `reducirAnimaciones: true` apaga las transiciones (lo hace la propia app) para que el color
// medido sea el final y no uno a mitad de transición.
export const TEMAS = {
  oscuro: { modoOscuro: true, altoContraste: false, modoAdultoMayor: false, reducirAnimaciones: true },
  claro: { modoOscuro: false, altoContraste: false, modoAdultoMayor: false, reducirAnimaciones: true },
  contraste: { modoOscuro: false, altoContraste: true, modoAdultoMayor: false, reducirAnimaciones: true },
  mayor: { modoOscuro: true, altoContraste: false, modoAdultoMayor: true, reducirAnimaciones: true },
}

export async function abrirApp(page, rol, tema = 'oscuro') {
  await simularApi(page, rol)
  await page.addInitScript((prefs) => localStorage.setItem('salux_accesibilidad', JSON.stringify(prefs)), TEMAS[tema])
  await page.goto('/')
}
