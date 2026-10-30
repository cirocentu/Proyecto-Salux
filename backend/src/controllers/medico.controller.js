const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { diaCalendarioUTC, formatearFechaHora, OFFSET_ARGENTINA_MINUTOS } = require('../utils/fechas');
const { registrarError } = require('../utils/registrarError');
const { segundoPlano } = require('../utils/segundoPlano');
const { parsearId } = require('../utils/ids');
const { emailTurnoCancelado } = require('../utils/email');

const MINUTOS_ANTICIPACION = 60;
const LIMITE_DIAS_PROXIMA_DISPONIBILIDAD = 30;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

// Primer horario libre de un médico dentro de los próximos 30 días, para que
// el paciente pueda comparar médicos sin tener que entrar a cada uno. Usa
// exactamente el mismo criterio que crearTurno (disponibilidad semanal,
// ausencias, choques con turnos ya reservados) para no prometer un horario
// que después el backend va a rechazar. Si el médico no cargó ninguna franja
// todavía, devolvemos null — no tiene sentido "prometer" un horario dentro
// de un rango sin restricciones que no configuró.
async function calcularProximaDisponibilidad(medico) {
  if (!medico.disponibilidades || medico.disponibilidades.length === 0) return null;

  const ahora = new Date();
  const minimoMs = ahora.getTime() + MINUTOS_ANTICIPACION * 60 * 1000;
  const limiteFecha = new Date(ahora.getTime() + LIMITE_DIAS_PROXIMA_DISPONIBILIDAD * UN_DIA_MS);

  const turnosExistentes = await prisma.turno.findMany({
    where: {
      medicoId: medico.idMedico,
      estado: { not: 'CANCELADO' },
      fechaYhora: { gte: ahora, lte: limiteFecha },
    },
    select: { fechaYhora: true },
  });
  const ocupados = new Set(turnosExistentes.map((t) => t.fechaYhora.getTime()));

  const duracion = medico.duracionTurnoMinutos;

  // Trabajamos en "tiempo corrido" (ahora - offset Argentina): truncar ESE
  // valor a medianoche da la medianoche de hoy en Argentina expresada en ms
  // UTC, sin depender de en qué huso corre el proceso. Sumarle minutos y
  // luego el offset de vuelta da el instante UTC real de ese horario
  // Argentina — el mismo truco que diaSemanaYMinutosArgentina pero en
  // sentido inverso (de "minutos Argentina" a instante UTC).
  const ahoraCorridoMs = ahora.getTime() - OFFSET_ARGENTINA_MINUTOS * 60 * 1000;
  const medianocheHoyCorridoMs = Math.floor(ahoraCorridoMs / UN_DIA_MS) * UN_DIA_MS;

  for (let d = 0; d < LIMITE_DIAS_PROXIMA_DISPONIBILIDAD; d++) {
    const medianocheDiaCorridoMs = medianocheHoyCorridoMs + d * UN_DIA_MS;
    const diaSemana = new Date(medianocheDiaCorridoMs).getUTCDay();
    const diaStr = diaCalendarioUTC(medianocheDiaCorridoMs);

    const enAusencia = (medico.ausencias || []).some((a) => {
      const desde = diaCalendarioUTC(a.fechaInicio);
      const hasta = diaCalendarioUTC(a.fechaFin);
      return diaStr >= desde && diaStr <= hasta;
    });
    if (enAusencia) continue;

    const franjasDelDia = medico.disponibilidades.filter((f) => f.diaSemana === diaSemana);
    for (const franja of franjasDelDia) {
      for (let m = franja.horaInicioMinutos; m + duracion <= franja.horaFinMinutos; m += duracion) {
        const slotMs = medianocheDiaCorridoMs + m * 60 * 1000 + OFFSET_ARGENTINA_MINUTOS * 60 * 1000;
        if (slotMs < minimoMs) continue;
        if (ocupados.has(slotMs)) continue;
        return new Date(slotMs);
      }
    }
  }

  return null;
}

// Turnos de un médico que todavía no ocurrieron y siguen vivos (pendientes o confirmados).
function turnosFuturosVivos(idMedico) {
  return prisma.turno.findMany({
    where: { medicoId: idMedico, estado: { in: ['PENDIENTE', 'CONFIRMADO'] }, fechaYhora: { gte: new Date() } },
    select: {
      idTurno: true,
      fechaYhora: true,
      paciente: { select: { usuario: { select: { email: true, nomYape: true } } } },
      medico: { select: { usuario: { select: { nomYape: true } } } },
    },
  });
}

const crearMedico = async (req, res) => {
  try {
    // 1. Recibimos los datos del usuario + los datos del médico (ya validados por Zod)
    const { email, dni, contrasena, nomYape, matricula, consultorio, especialidadesIds, duracionTurnoMinutos } = req.body;

    // 2. Verificamos si el email, dni o matrícula ya existen en el sistema
    const [usuarioExistente, matriculaExistente] = await Promise.all([
      prisma.usuario.findFirst({ where: { OR: [{ email }, { dni }] } }),
      prisma.medico.findUnique({ where: { matricula } }),
    ]);

    if (usuarioExistente) {
      return res.status(409).json({ ok: false, message: 'El email o DNI ya están registrados' });
    }
    if (matriculaExistente) {
      return res.status(409).json({ ok: false, message: 'Esa matrícula ya está registrada' });
    }

    // 4. Encriptamos la contraseña
    const hashedPassword = await bcrypt.hash(contrasena, 12);

    // 5. Magia de Prisma: Creamos Usuario, su perfil de Médico y lo conectamos a las Especialidades
    const nuevoMedico = await prisma.usuario.create({
      data: {
        email,
        dni,
        contrasena: hashedPassword,
        nomYape,
        // La contraseña la eligió el admin: el médico tiene que cambiarla al ingresar
        debeCambiarContrasena: true,
        medico: {
          create: {
            matricula,
            consultorio,
            // Si no se manda, Prisma aplica el default de la columna (30)
            ...(duracionTurnoMinutos != null ? { duracionTurnoMinutos } : {}),
            // Como es una lista (array) de IDs, Prisma necesita mapearlos para conectarlos
            especialidades: {
              connect: especialidadesIds.map(id => ({ idEspecialidad: id }))
            }
          }
        }
      },
      // select explícito: NUNCA devolver la contraseña hasheada en la respuesta
      select: {
        idUsuario: true,
        email: true,
        nomYape: true,
        medico: {
          select: {
            idMedico: true,
            matricula: true,
            consultorio: true,
            duracionTurnoMinutos: true,
            especialidades: true
          }
        }
      }
    });

    res.status(201).json({
      ok: true,
      message: 'Médico registrado con éxito',
      data: nuevoMedico
    });

  } catch (error) {
    registrarError(error);
    if (error.code === 'P2025') {
      return res.status(400).json({ ok: false, message: 'Una o más especialidades no existen' });
    }
    // Carrera entre dos altas simultáneas con el mismo email/dni/matrícula
    if (error.code === 'P2002') {
      return res.status(409).json({ ok: false, message: 'El email, DNI o matrícula ya están registrados' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
const obtenerMedicos = async (req, res) => {
  try {
    const medicos = await prisma.medico.findMany({
      // Un médico sin ninguna especialidad activa no se puede reservar (crearTurno lo
      // rechaza), así que tampoco se ofrece.
      where: { usuario: { activo: true }, especialidades: { some: { activo: true } } },
      include: {
        // Traemos los datos del usuario, pero seleccionamos qué campos mostrar por seguridad
        // Este listado lo ve cualquier usuario logueado (incluidos pacientes):
        // solo el nombre, nada de email ni ids internos de cuenta.
        usuario: {
          select: {
            nomYape: true,
            activo: true
          }
        },
        // Solo las especialidades vigentes: una dada de baja no se ofrece para reservar
        especialidades: { where: { activo: true } },
        disponibilidades: true,
        ausencias: true,
      }
    });

    // Se calcula por médico (consulta propia de turnos existentes cada uno),
    // así que van todas en paralelo en vez de una por una.
    const medicosConDisponibilidad = await Promise.all(
      medicos.map(async (m) => {
        // usuarioId y matrícula son datos internos/administrativos; los motivos
        // de las ausencias, privados del médico (se usan solo para el cálculo).
        // eslint-disable-next-line no-unused-vars
        const { usuarioId, matricula, ausencias, ...publico } = m;
        return {
          ...publico,
          ausencias: ausencias.map((a) => ({ fechaInicio: a.fechaInicio, fechaFin: a.fechaFin })),
          proximaDisponibilidad: await calcularProximaDisponibilidad(m),
        };
      })
    );

    res.json({
      ok: true,
      data: medicosConDisponibilidad
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Lista TODOS los médicos (activos e inactivos) con sus datos completos —
// a diferencia de obtenerMedicos (que filtra solo activos, para el flujo de
// reserva de turnos del paciente), esta es para la data table del panel de
// administración, donde el admin necesita ver y poder reactivar inactivos.
const obtenerTodosLosMedicos = async (req, res) => {
  try {
    const medicos = await prisma.medico.findMany({
      orderBy: { idMedico: 'asc' },
      include: {
        usuario: {
          select: { idUsuario: true, nomYape: true, email: true, dni: true, activo: true }
        },
        especialidades: true
      }
    });

    res.json({
      ok: true,
      data: medicos
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Activa/desactiva la cuenta del médico (reutiliza el flag Usuario.activo,
// el mismo que ya usan login/verificarToken para bloquear el acceso).
const cambiarEstadoMedico = async (req, res) => {
  try {
    const idMedico = parsearId(req.params.id);
    if (idMedico === null) {
      return res.status(400).json({ ok: false, message: 'id de médico inválido' });
    }
    const { activo, cancelarTurnosFuturos } = req.body;

    const medico = await prisma.medico.findUnique({ where: { idMedico }, select: { usuarioId: true } });
    if (!medico) {
      return res.status(404).json({ ok: false, message: 'Médico no encontrado' });
    }

    // Desactivar a un médico con turnos futuros vivos los dejaría colgados: él ya no puede
    // entrar a confirmarlos ni finalizarlos y los pacientes irían a una cita que no existe.
    // Hay que confirmarlo explícitamente: se cancelan y se avisa a cada paciente.
    let turnosACancelar = [];
    if (activo === false) {
      turnosACancelar = await turnosFuturosVivos(idMedico);
      if (turnosACancelar.length > 0 && !cancelarTurnosFuturos) {
        return res.status(409).json({
          ok: false,
          message: `Este médico tiene ${turnosACancelar.length} turno(s) futuro(s) sin cerrar. Si lo desactivás se van a cancelar y se avisará a los pacientes`,
          turnosFuturos: turnosACancelar.length,
        });
      }
    }

    const usuario = await prisma.$transaction(async (tx) => {
      if (turnosACancelar.length > 0) {
        // Se vuelve a exigir que sigan vivos: si alguno cambió en el medio, no se pisa.
        await tx.turno.updateMany({
          where: { idTurno: { in: turnosACancelar.map((t) => t.idTurno) }, estado: { in: ['PENDIENTE', 'CONFIRMADO'] } },
          data: { estado: 'CANCELADO' },
        });
      }
      return tx.usuario.update({
        where: { idUsuario: medico.usuarioId },
        data: { activo },
        select: { idUsuario: true, activo: true }
      });
    });

    res.json({
      ok: true,
      message: `Médico ${activo ? 'activado' : 'desactivado'} con éxito`,
      data: usuario,
      ...(activo === false ? { turnosCancelados: turnosACancelar.length } : {}),
    });

    for (const t of turnosACancelar) {
      const { fechaTexto, horaTexto } = formatearFechaHora(t.fechaYhora);
      segundoPlano(emailTurnoCancelado({
        to: t.paciente.usuario.email,
        nombrePaciente: t.paciente.usuario.nomYape,
        nombreMedico: t.medico.usuario.nomYape,
        fechaTexto,
        horaTexto,
      }));
    }
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Edita los datos operativos del médico (consultorio, duración de turno).
// Los datos de identidad (nombre, email, dni, matrícula) no se tocan acá.
const actualizarMedico = async (req, res) => {
  try {
    const idMedico = parsearId(req.params.id);
    if (idMedico === null) {
      return res.status(400).json({ ok: false, message: 'id de médico inválido' });
    }

    const { consultorio, duracionTurnoMinutos, especialidadesIds } = req.body;
    if (consultorio === undefined && duracionTurnoMinutos === undefined && especialidadesIds === undefined) {
      return res.status(400).json({ ok: false, message: 'No se envió ningún campo para actualizar' });
    }

    // Los turnos ya reservados duran lo que dura un turno HOY de este médico: si se acorta
    // con turnos futuros cargados, el que ocupaba 60 minutos pasaría a ocupar 30 y el
    // sistema dejaría reservar encima de él. Primero hay que cerrar o cancelar esos turnos.
    if (duracionTurnoMinutos !== undefined) {
      const actual = await prisma.medico.findUnique({ where: { idMedico }, select: { duracionTurnoMinutos: true } });
      if (actual && actual.duracionTurnoMinutos !== duracionTurnoMinutos) {
        const pendientes = (await turnosFuturosVivos(idMedico)).length;
        if (pendientes > 0) {
          return res.status(409).json({
            ok: false,
            message: `No se puede cambiar la duración del turno: el médico tiene ${pendientes} turno(s) futuro(s) reservado(s). Cancelalos o esperá a que se cierren`,
            turnosFuturos: pendientes,
          });
        }
      }
    }

    const medico = await prisma.medico.update({
      where: { idMedico },
      data: {
        ...(consultorio !== undefined ? { consultorio } : {}),
        ...(duracionTurnoMinutos !== undefined ? { duracionTurnoMinutos } : {}),
        // `set` reemplaza toda la relación muchos-a-muchos de una: así el
        // admin puede tanto agregar como quitar especialidades en un mismo PATCH.
        ...(especialidadesIds !== undefined ? { especialidades: { set: especialidadesIds.map((id) => ({ idEspecialidad: id })) } } : {}),
      },
      include: {
        usuario: { select: { nomYape: true, email: true, dni: true, activo: true } },
        especialidades: true
      }
    });

    res.json({ ok: true, message: 'Médico actualizado con éxito', data: medico });
  } catch (error) {
    registrarError(error);
    if (error.code === 'P2025') {
      return res.status(404).json({ ok: false, message: 'Médico no encontrado, o alguna de las especialidades indicadas no existe' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Acordate de actualizar la exportación para incluir la nueva función
module.exports = {
  crearMedico,
  obtenerMedicos,
  obtenerTodosLosMedicos,
  cambiarEstadoMedico,
  actualizarMedico
};