const prisma = require('../config/prisma');
const { registrarError } = require('../utils/registrarError');
const { parsearId } = require('../utils/ids');
const { OFFSET_ARGENTINA_MINUTOS } = require('../utils/fechas');

// Todas las rutas de este controller son para el médico logueado, así que
// resolvemos su idMedico a partir del usuario del token en cada una.
async function resolverMedico(usuarioId) {
  return prisma.medico.findUnique({ where: { usuarioId } });
}

const crearDisponibilidad = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const { diaSemana, horaInicioMinutos, horaFinMinutos } = req.body;

    // Dos franjas del mismo día se superponen si una empieza antes de que la otra termine y viceversa
    const franjas = await prisma.disponibilidad.findMany({ where: { medicoId: medico.idMedico, diaSemana } });
    const seSuperpone = franjas.some(
      (f) => horaInicioMinutos < f.horaFinMinutos && horaFinMinutos > f.horaInicioMinutos
    );
    if (seSuperpone) {
      return res.status(409).json({ ok: false, message: 'Esa franja se superpone con otra que ya tenés cargada ese día' });
    }

    const nueva = await prisma.disponibilidad.create({
      data: { diaSemana, horaInicioMinutos, horaFinMinutos, medicoId: medico.idMedico },
    });

    res.status(201).json({ ok: true, message: 'Franja horaria agregada', data: nueva });
  } catch (error) {
    registrarError(error);
    if (error.code === 'P2002') {
      return res.status(409).json({ ok: false, message: 'Ya tenés esa franja horaria cargada' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const obtenerMisDisponibilidades = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const disponibilidades = await prisma.disponibilidad.findMany({
      where: { medicoId: medico.idMedico },
      orderBy: [{ diaSemana: 'asc' }, { horaInicioMinutos: 'asc' }],
    });

    res.json({ ok: true, data: disponibilidades });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const eliminarDisponibilidad = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const idDisponibilidad = parsearId(req.params.id);
    if (idDisponibilidad === null) {
      return res.status(400).json({ ok: false, message: 'id de franja horaria inválido' });
    }

    const franja = await prisma.disponibilidad.findUnique({ where: { idDisponibilidad } });
    if (!franja) {
      return res.status(404).json({ ok: false, message: 'Franja horaria no encontrada' });
    }
    if (franja.medicoId !== medico.idMedico) {
      return res.status(403).json({ ok: false, message: 'Esa franja horaria no te pertenece' });
    }

    await prisma.disponibilidad.delete({ where: { idDisponibilidad } });

    res.json({ ok: true, message: 'Franja horaria eliminada' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Para el wizard de "Solicitar turno" del paciente: la disponibilidad de un
// médico puntual, para generar los horarios reales en vez de un rango fijo.
const obtenerDisponibilidadDeMedico = async (req, res) => {
  try {
    const medicoId = parsearId(req.params.medicoId);
    if (medicoId === null) {
      return res.status(400).json({ ok: false, message: 'id de médico inválido' });
    }

    const medico = await prisma.medico.findUnique({ where: { idMedico: medicoId }, select: { idMedico: true, duracionTurnoMinutos: true } });
    if (!medico) {
      return res.status(404).json({ ok: false, message: 'Médico no encontrado' });
    }

    const [disponibilidades, ausencias] = await Promise.all([
      prisma.disponibilidad.findMany({
        where: { medicoId },
        orderBy: [{ diaSemana: 'asc' }, { horaInicioMinutos: 'asc' }],
      }),
      // Solo las ausencias que todavía pueden afectar una reserva futura
      prisma.ausenciaMedico.findMany({
        where: { medicoId, fechaFin: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        orderBy: { fechaInicio: 'asc' },
        // Sin `motivo` (puede ser un dato de salud/privado): al paciente solo le
        // hace falta saber qué días no se puede reservar.
        select: { idAusencia: true, fechaInicio: true, fechaFin: true },
      }),
    ]);

    res.json({ ok: true, data: { duracionTurnoMinutos: medico.duracionTurnoMinutos, disponibilidades, ausencias } });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// ==========================================
// Ausencias puntuales (vacaciones, un día que el médico avisa que no atiende)
// ==========================================

const crearAusencia = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const { fechaInicio, fechaFin, motivo } = req.body;

    // Guardamos siempre como medianoche UTC del día que se eligió (ya validado
    // como "AAAA-MM-DD" por Zod). Un día calendario es un concepto absoluto
    // que no depende de la zona horaria de quien lo mire después — ver la
    // misma convención en validarHorarioParaTurno (turno.controller.js) y en
    // generarHorariosDelDia (frontend/turnoUtils.js).
    const nueva = await prisma.ausenciaMedico.create({
      data: {
        fechaInicio: new Date(`${fechaInicio}T00:00:00Z`),
        fechaFin: new Date(`${fechaFin}T00:00:00Z`),
        motivo: motivo || null,
        medicoId: medico.idMedico,
      },
    });

    // Los turnos ya reservados dentro del rango NO se cancelan solos (podría ser un error
    // de carga): se le avisa al médico cuántos quedaron en conflicto para que los resuelva.
    // El rango son días de Argentina: de las 00:00 del primero a las 24:00 del último.
    const desde = new Date(nueva.fechaInicio.getTime() + OFFSET_ARGENTINA_MINUTOS * 60 * 1000);
    const hasta = new Date(nueva.fechaFin.getTime() + 24 * 60 * 60 * 1000 + OFFSET_ARGENTINA_MINUTOS * 60 * 1000);
    const turnosAfectados = await prisma.turno.count({
      where: {
        medicoId: medico.idMedico,
        estado: { in: ['PENDIENTE', 'CONFIRMADO'] },
        fechaYhora: { gte: new Date(Math.max(desde.getTime(), Date.now())), lt: hasta },
      },
    });

    res.status(201).json({ ok: true, message: 'Ausencia registrada', data: nueva, turnosAfectados });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const obtenerMisAusencias = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const ausencias = await prisma.ausenciaMedico.findMany({
      where: { medicoId: medico.idMedico },
      orderBy: { fechaInicio: 'asc' },
    });

    res.json({ ok: true, data: ausencias });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const eliminarAusencia = async (req, res) => {
  try {
    const medico = await resolverMedico(req.usuario.id);
    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: tu perfil no es de médico' });
    }

    const idAusencia = parsearId(req.params.id);
    if (idAusencia === null) {
      return res.status(400).json({ ok: false, message: 'id de ausencia inválido' });
    }

    const ausencia = await prisma.ausenciaMedico.findUnique({ where: { idAusencia } });
    if (!ausencia) {
      return res.status(404).json({ ok: false, message: 'Ausencia no encontrada' });
    }
    if (ausencia.medicoId !== medico.idMedico) {
      return res.status(403).json({ ok: false, message: 'Esa ausencia no te pertenece' });
    }

    await prisma.ausenciaMedico.delete({ where: { idAusencia } });

    res.json({ ok: true, message: 'Ausencia eliminada' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

module.exports = {
  crearDisponibilidad,
  obtenerMisDisponibilidades,
  eliminarDisponibilidad,
  obtenerDisponibilidadDeMedico,
  crearAusencia,
  obtenerMisAusencias,
  eliminarAusencia,
};
