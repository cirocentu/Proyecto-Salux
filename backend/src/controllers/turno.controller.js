const prisma = require('../config/prisma');
const { emailTurnoCreado, emailTurnoConfirmado, emailTurnoCancelado } = require('../utils/email');
const { diaCalendarioUTC, diaCalendarioArgentina, diaSemanaYMinutosArgentina, formatearFechaHora } = require('../utils/fechas');
const { registrarError } = require('../utils/registrarError');
const { segundoPlano } = require('../utils/segundoPlano');
const { parsearId } = require('../utils/ids');
const { seSolapan, DURACION_MAXIMA_MINUTOS, MINUTO_MS } = require('../utils/solapamiento');

// Opciones de las transacciones de reserva: esperan su turno si otro pedido del mismo
// médico/paciente está validando en ese momento.
const MENSAJE_TURNO_CAMBIO = 'El turno cambió mientras lo modificabas. Actualizá la pantalla y volvé a intentar';
const OPCIONES_TRANSACCION = { maxWait: 10000, timeout: 15000 };

// Serializa las reservas que tocan al mismo médico o al mismo paciente. Los chequeos de
// solapamiento son "leer y después escribir": sin esto, dos pedidos simultáneos leen la
// misma agenda vacía y ambos guardan (la base solo ataja el mismo instante exacto, no
// horarios que se pisan a medias). El candado dura lo que la transacción y se suelta
// solo. Siempre se pide primero el del médico y después el del paciente, para que dos
// pedidos cruzados nunca se esperen entre sí.
async function bloquearAgendas(tx, { medicoId, pacienteId }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${medicoId * 2}::bigint)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${pacienteId * 2 + 1}::bigint)`;
}

// Valida que `inicio` sea un horario reservable para `medico`: activo, fuera
// de sus ausencias puntuales, dentro de su disponibilidad semanal (si
// configuró alguna) y sin choques con otro turno del paciente o del médico.
// La usan tanto crearTurno como reprogramarTurno — en esta última,
// `excluirTurnoId` deja afuera de los chequeos de choque al turno que se
// está moviendo (si no, chocaría contra sí mismo).
async function validarHorarioParaTurno(tx, { medico, inicio, pacienteId, excluirTurnoId }) {
  if (!medico.usuario.activo) {
    return { ok: false, status: 422, message: 'Ese médico no está disponible actualmente' };
  }

  const duracionTurnoMinutos = medico.duracionTurnoMinutos;

  // Ausencia puntual (vacaciones, un día que avisó que no atiende)
  const diaDelTurno = diaCalendarioArgentina(inicio);
  const dentroDeAusencia = (medico.ausencias || []).some((a) => {
    const desde = diaCalendarioUTC(a.fechaInicio);
    const hasta = diaCalendarioUTC(a.fechaFin);
    return diaDelTurno >= desde && diaDelTurno <= hasta;
  });
  if (dentroDeAusencia) {
    return { ok: false, status: 422, message: 'El médico no atiende ese día (tiene una ausencia registrada)' };
  }

  // Si el médico ya cargó su disponibilidad semanal, el turno tiene que caer
  // completo dentro de alguna franja. Un médico sin ninguna franja cargada
  // todavía (no configuró el módulo) queda sin esta restricción, por
  // compatibilidad con los que ya existían antes de este módulo.
  if (medico.disponibilidades.length > 0) {
    // OJO: NO usar inicio.getDay()/getHours() acá — dependen de la zona
    // horaria del proceso (en Docker, UTC), pero las franjas se definieron
    // pensando en hora Argentina. Sin esta traducción, cualquier turno con
    // disponibilidad configurada se rechaza siempre (se comprobó con un
    // caso real: "09:00 Argentina" el backend lo leía como "12:00").
    const { diaSemana, minutosDelDia: minutosInicio } = diaSemanaYMinutosArgentina(inicio);
    const minutosFin = minutosInicio + duracionTurnoMinutos;
    const dentroDeDisponibilidad = medico.disponibilidades.some(
      (f) => f.diaSemana === diaSemana && f.horaInicioMinutos <= minutosInicio && f.horaFinMinutos >= minutosFin
    );
    if (!dentroDeDisponibilidad) {
      return { ok: false, status: 422, message: 'Ese horario no está dentro de la disponibilidad del médico' };
    }
  }

  // Turnos vecinos (no cancelados) de este médico y de este paciente: cualquiera que
  // empiece hasta una duración máxima antes, o antes de que termine el nuevo, podría pisarlo.
  const desde = new Date(inicio.getTime() - DURACION_MAXIMA_MINUTOS * MINUTO_MS);
  const hasta = new Date(inicio.getTime() + duracionTurnoMinutos * MINUTO_MS);
  const vecinos = (donde) => tx.turno.findMany({
    where: {
      ...donde,
      estado: { not: 'CANCELADO' },
      fechaYhora: { gt: desde, lt: hasta },
      ...(excluirTurnoId ? { idTurno: { not: excluirTurnoId } } : {}),
    },
    select: { fechaYhora: true, medico: { select: { duracionTurnoMinutos: true } } },
  });
  const [delPaciente, delMedico] = await Promise.all([vecinos({ pacienteId }), vecinos({ medicoId: medico.idMedico })]);

  // El paciente no puede estar en dos turnos a la vez, ni con médicos distintos: cada
  // turno que ya tiene ocupa lo que dura según SU médico.
  const pisaAlPaciente = delPaciente.some((t) => seSolapan(inicio, duracionTurnoMinutos, t.fechaYhora, t.medico.duracionTurnoMinutos));
  if (pisaAlPaciente) {
    return { ok: false, status: 409, message: 'Ya tenés otro turno que se superpone con ese horario' };
  }

  // El médico no puede tener dos turnos que se superpongan en el tiempo
  // (una reserva "ocupa" duracionTurnoMinutos a partir de su hora de inicio)
  const pisaAlMedico = delMedico.some((t) => seSolapan(inicio, duracionTurnoMinutos, t.fechaYhora, duracionTurnoMinutos));
  if (pisaAlMedico) {
    return {
      ok: false,
      status: 409,
      message: `Ese médico ya tiene un turno dentro de los ${duracionTurnoMinutos} minutos de ese horario`
    };
  }

  return { ok: true };
}

// 1. Crear un turno nuevo
const crearTurno = async (req, res) => {
  try {
    // medicoId y fechaYhora ya vienen validados (y fechaYhora garantizada a futuro) por Zod
    const { medicoId, fechaYhora, especialidadId } = req.body;
    const usuarioId = req.usuario.id;
    const inicio = new Date(fechaYhora);

    const [paciente, medico] = await Promise.all([
      prisma.paciente.findUnique({
        where: { usuarioId: usuarioId },
        include: { usuario: { select: { email: true, nomYape: true } } }
      }),
      prisma.medico.findUnique({
        where: { idMedico: medicoId },
        include: { usuario: { select: { activo: true } }, disponibilidades: true, ausencias: true, especialidades: true }
      }),
    ]);

    if (!paciente) {
      return res.status(404).json({ ok: false, message: 'Tu usuario no tiene un perfil de paciente asociado' });
    }

    if (!medico) {
      return res.status(404).json({ ok: false, message: 'El médico indicado no existe' });
    }

    // La especialidad reservada tiene que ser una que el médico atiende y que siga activa.
    // Si no viene y el médico tiene una sola, es esa.
    const activasDelMedico = medico.especialidades.filter((e) => e.activo);
    if (activasDelMedico.length === 0 && especialidadId == null) {
      return res.status(422).json({ ok: false, message: 'Ese médico no tiene especialidades activas' });
    }
    let especialidadDelTurno = null;
    if (especialidadId != null) {
      especialidadDelTurno = activasDelMedico.find((e) => e.idEspecialidad === especialidadId);
      if (!especialidadDelTurno) {
        return res.status(400).json({ ok: false, message: 'Ese médico no atiende la especialidad indicada' });
      }
    } else if (activasDelMedico.length === 1) {
      especialidadDelTurno = activasDelMedico[0];
    }

    // Validar y guardar van juntos, con las agendas bloqueadas: ver bloquearAgendas.
    const resultado = await prisma.$transaction(async (tx) => {
      await bloquearAgendas(tx, { medicoId: medico.idMedico, pacienteId: paciente.idPaciente });
      const validacion = await validarHorarioParaTurno(tx, { medico, inicio, pacienteId: paciente.idPaciente });
      if (!validacion.ok) return validacion;
      const turno = await tx.turno.create({
        data: {
          fechaYhora: inicio,
          pacienteId: paciente.idPaciente,
          medicoId: medico.idMedico,
          especialidadId: especialidadDelTurno ? especialidadDelTurno.idEspecialidad : null
        },
        include: {
          especialidad: true,
          medico: {
            include: {
              usuario: {
                select: { nomYape: true }
              },
              especialidades: true
            }
          }
        }
      });
      return { ok: true, turno };
    }, OPCIONES_TRANSACCION);

    if (!resultado.ok) {
      return res.status(resultado.status).json({ ok: false, message: resultado.message });
    }
    const nuevoTurno = resultado.turno;

    res.status(201).json({
      ok: true,
      message: '¡Turno reservado con éxito!',
      data: nuevoTurno
    });

    // El email es una cortesía, no una condición para que la reserva sea
    // válida — se dispara después de responder y nunca puede tirar abajo el request.
    const { fechaTexto, horaTexto } = formatearFechaHora(inicio);
    segundoPlano(emailTurnoCreado({
      to: paciente.usuario.email,
      nombrePaciente: paciente.usuario.nomYape,
      nombreMedico: nuevoTurno.medico.usuario.nomYape,
      fechaTexto,
      horaTexto,
      consultorio: nuevoTurno.medico.consultorio ? `Consultorio ${nuevoTurno.medico.consultorio}` : 'Consultorio a confirmar',
    }));

  } catch (error) {
    registrarError(error);
    // Red de seguridad ante una carrera entre dos reservas simultáneas que
    // los chequeos de arriba no llegaron a atajar a tiempo.
    if (error.code === 'P2002') {
      const indice = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
      if (indice.includes('paciente')) {
        return res.status(409).json({ ok: false, message: 'Ya tenés un turno reservado en ese mismo horario' });
      }
      return res.status(409).json({ ok: false, message: 'Ese médico ya tiene un turno reservado en ese horario' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// 2. Obtener los turnos del paciente logueado
const obtenerMisTurnos = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const paciente = await prisma.paciente.findUnique({
      where: { usuarioId: usuarioId }
    });

    if (!paciente) {
      return res.status(404).json({ ok: false, message: 'Tu usuario no tiene un perfil de paciente asociado' });
    }

    const misTurnos = await prisma.turno.findMany({
      where: { pacienteId: paciente.idPaciente },
      orderBy: { fechaYhora: 'asc' },
      include: {
        especialidad: true,
        medico: {
          include: {
            usuario: {
              select: { nomYape: true }
            },
            especialidades: true
          }
        }
      }
    });

    res.json({
      ok: true,
      data: misTurnos
    });

  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// 3. Actualizar el estado de un turno
const actualizarEstadoTurno = async (req, res) => {
  try {
    const { estado } = req.body; // ya validado por Zod
    const idTurno = parsearId(req.params.id);

    if (idTurno === null) {
      return res.status(400).json({ ok: false, message: 'id de turno inválido' });
    }

    const turno = await prisma.turno.findUnique({
      where: { idTurno },
      include: {
        paciente: { select: { usuarioId: true, usuario: { select: { email: true, nomYape: true } } } },
        medico: { select: { usuarioId: true, usuario: { select: { nomYape: true } } } }
      }
    });

    if (!turno) {
      return res.status(404).json({ ok: false, message: 'Turno no encontrado' });
    }

    // Autorización: solo el paciente dueño, el médico dueño o un admin pueden tocar el turno
    const usuarioId = req.usuario.id;
    const esPaciente = turno.paciente.usuarioId === usuarioId;
    const esMedico = turno.medico.usuarioId === usuarioId;
    let esAdmin = false;

    if (!esPaciente && !esMedico) {
      const admin = await prisma.administrador.findUnique({ where: { usuarioId } });
      esAdmin = !!admin;
    }

    if (!esPaciente && !esMedico && !esAdmin) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: no participás en este turno' });
    }

    // Un paciente solo puede cancelar su propio turno, no confirmarlo ni finalizarlo
    if (esPaciente && !esMedico && !esAdmin && estado !== 'CANCELADO') {
      return res.status(403).json({ ok: false, message: 'Como paciente solo podés cancelar tu turno' });
    }

    // Los estados finales no admiten más transiciones (evita "revivir" un turno ya cerrado).
    // 422: la petición está bien formada, pero viola una regla de negocio (máquina de estados).
    if (turno.estado === 'FINALIZADO' || turno.estado === 'CANCELADO') {
      return res.status(422).json({
        ok: false,
        message: `El turno ya está ${turno.estado.toLowerCase()} y no admite más cambios`
      });
    }

    if (estado === turno.estado) {
      return res.status(422).json({ ok: false, message: `El turno ya está ${estado.toLowerCase()}` });
    }

    // Reglas ligadas al horario: no se puede cerrar como realizado algo que
    // todavía no ocurrió, ni confirmar un turno cuyo horario ya pasó.
    const ahora = new Date();
    if (estado === 'FINALIZADO' && turno.fechaYhora > ahora) {
      return res.status(422).json({ ok: false, message: 'No se puede finalizar un turno que todavía no ocurrió' });
    }
    if (estado === 'CONFIRMADO' && turno.fechaYhora < ahora) {
      return res.status(422).json({ ok: false, message: 'No se puede confirmar un turno cuyo horario ya pasó' });
    }

    // El estado se vuelve a exigir en el UPDATE: si entre la lectura y la escritura otro
    // pedido ya movió el turno (ej: lo cancelaron justo cuando lo finalizaban), este no
    // pisa nada y avisa (409) en vez de dejar un estado que nadie pidió.
    const turnoActualizado = await prisma.turno.update({
      where: { idTurno, estado: turno.estado },
      data: { estado }
    });

    res.json({
      ok: true,
      message: `El turno ahora está: ${estado}`,
      data: turnoActualizado
    });

    // Avisamos por email solo en los cambios que le importan al paciente —
    // nunca bloquea ni puede hacer fallar la respuesta que ya se envió.
    if (estado === 'CONFIRMADO' || estado === 'CANCELADO') {
      const { fechaTexto, horaTexto } = formatearFechaHora(new Date(turnoActualizado.fechaYhora));
      const datosEmail = {
        to: turno.paciente.usuario.email,
        nombrePaciente: turno.paciente.usuario.nomYape,
        nombreMedico: turno.medico.usuario.nomYape,
        fechaTexto,
        horaTexto,
      };
      const enviar = estado === 'CONFIRMADO' ? emailTurnoConfirmado : emailTurnoCancelado;
      segundoPlano(enviar(datosEmail));
    }

  } catch (error) {
    registrarError(error);
    if (error.code === 'P2025') {
      return res.status(409).json({ ok: false, message: MENSAJE_TURNO_CAMBIO });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
// 3.1 Reprogramar un turno propio: lo mueve a un horario nuevo, re-validando
// todas las mismas reglas que crearTurno (disponibilidad, ausencias,
// choques). Vuelve a PENDIENTE porque el horario cambió y el médico tiene
// que reconfirmarlo — y el paciente, re-confirmar su asistencia.
const reprogramarTurno = async (req, res) => {
  try {
    const idTurno = parsearId(req.params.id);
    if (idTurno === null) {
      return res.status(400).json({ ok: false, message: 'id de turno inválido' });
    }
    const { fechaYhora } = req.body; // ya validado por Zod (fecha futura)
    const inicio = new Date(fechaYhora);
    const usuarioId = req.usuario.id;

    const turno = await prisma.turno.findUnique({
      where: { idTurno },
      include: { paciente: { select: { usuarioId: true, idPaciente: true } } }
    });

    if (!turno) {
      return res.status(404).json({ ok: false, message: 'Turno no encontrado' });
    }

    if (turno.paciente.usuarioId !== usuarioId) {
      return res.status(403).json({ ok: false, message: 'No podés reprogramar un turno que no es tuyo' });
    }

    if (turno.estado === 'FINALIZADO' || turno.estado === 'CANCELADO') {
      return res.status(422).json({
        ok: false,
        message: `El turno ya está ${turno.estado.toLowerCase()} y no se puede reprogramar`
      });
    }

    // Un turno cuyo horario ya pasó no se "mueve": o ocurrió (el médico lo finaliza) o se perdió.
    if (turno.fechaYhora < new Date()) {
      return res.status(422).json({ ok: false, message: 'No se puede reprogramar un turno cuyo horario ya pasó' });
    }

    const medico = await prisma.medico.findUnique({
      where: { idMedico: turno.medicoId },
      include: { usuario: { select: { activo: true } }, disponibilidades: true, ausencias: true }
    });
    if (!medico) {
      return res.status(404).json({ ok: false, message: 'El médico de este turno ya no existe' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      await bloquearAgendas(tx, { medicoId: medico.idMedico, pacienteId: turno.paciente.idPaciente });
      const validacion = await validarHorarioParaTurno(tx, {
        medico,
        inicio,
        pacienteId: turno.paciente.idPaciente,
        excluirTurnoId: idTurno,
      });
      if (!validacion.ok) return validacion;

      // El estado se vuelve a exigir en el UPDATE: si lo cancelaron en el medio, no se "revive".
      const actualizado = await tx.turno.update({
        where: { idTurno, estado: turno.estado },
        data: {
          fechaYhora: inicio,
          estado: 'PENDIENTE',
          confirmadoPorPaciente: false,
        },
        include: {
          especialidad: true,
          medico: {
            include: {
              usuario: { select: { nomYape: true } },
              especialidades: true
            }
          }
        }
      });
      return { ok: true, turno: actualizado };
    }, OPCIONES_TRANSACCION);

    if (!resultado.ok) {
      return res.status(resultado.status).json({ ok: false, message: resultado.message });
    }
    const turnoActualizado = resultado.turno;

    res.json({ ok: true, message: 'Turno reprogramado con éxito', data: turnoActualizado });
  } catch (error) {
    registrarError(error);
    if (error.code === 'P2002') {
      return res.status(409).json({ ok: false, message: 'Ese horario ya no está disponible' });
    }
    if (error.code === 'P2025') {
      return res.status(409).json({ ok: false, message: MENSAJE_TURNO_CAMBIO });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// 3.2 El paciente confirma que va a asistir a su turno — señal aparte de que
// el médico/admin lo haya confirmado, pensada para bajar el ausentismo.
const confirmarAsistencia = async (req, res) => {
  try {
    const idTurno = parsearId(req.params.id);
    if (idTurno === null) {
      return res.status(400).json({ ok: false, message: 'id de turno inválido' });
    }

    const turno = await prisma.turno.findUnique({
      where: { idTurno },
      include: { paciente: { select: { usuarioId: true } } }
    });

    if (!turno) {
      return res.status(404).json({ ok: false, message: 'Turno no encontrado' });
    }

    if (turno.paciente.usuarioId !== req.usuario.id) {
      return res.status(403).json({ ok: false, message: 'No podés confirmar un turno que no es tuyo' });
    }

    if (turno.estado === 'FINALIZADO' || turno.estado === 'CANCELADO') {
      return res.status(422).json({
        ok: false,
        message: `El turno ya está ${turno.estado.toLowerCase()} y no admite confirmación`
      });
    }

    if (turno.fechaYhora < new Date()) {
      return res.status(422).json({ ok: false, message: 'No se puede confirmar la asistencia a un turno cuyo horario ya pasó' });
    }

    const turnoActualizado = await prisma.turno.update({
      where: { idTurno, estado: turno.estado },
      data: { confirmadoPorPaciente: true }
    });

    res.json({ ok: true, message: 'Confirmaste tu asistencia', data: turnoActualizado });
  } catch (error) {
    registrarError(error);
    if (error.code === 'P2025') {
      return res.status(409).json({ ok: false, message: MENSAJE_TURNO_CAMBIO });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// ... (acá arriba están crearTurno, obtenerMisTurnos, actualizarEstadoTurno) ...

// 4. Obtener la agenda del médico logueado
const obtenerTurnosMedico = async (req, res) => {
  try {
    const usuarioId = req.usuario.id; // Extraemos el ID del token

    // 1. Verificamos que este usuario realmente sea un médico
    const medico = await prisma.medico.findUnique({
      where: { usuarioId: usuarioId }
    });

    if (!medico) {
      return res.status(403).json({ ok: false, message: 'Acceso denegado: Tu perfil no es de médico' });
    }

    // 2. Buscamos los turnos de este médico y los ordenamos por fecha
    const agenda = await prisma.turno.findMany({
      where: { medicoId: medico.idMedico },
      orderBy: { fechaYhora: 'asc' },
      include: {
        especialidad: true,
        // Le decimos a Prisma que traiga los datos del paciente asociado a cada turno
        paciente: {
          select: {
            obraSocial: true,
            telefono: true,
            usuario: {
              select: {
                nomYape: true,
                email: true
              }
            }
          }
        }
      }
    });

    res.json({
      ok: true,
      data: agenda
    });

  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// 5. Obtener todos los turnos de todos los pacientes (solo Administradores)
const obtenerTodosLosTurnos = async (req, res) => {
  try {
    const turnos = await prisma.turno.findMany({
      orderBy: { fechaYhora: 'asc' },
      include: {
        especialidad: true,
        paciente: {
          select: {
            usuario: { select: { nomYape: true, email: true } }
          }
        },
        medico: {
          include: {
            usuario: { select: { nomYape: true } },
            especialidades: true
          }
        }
      }
    });

    res.json({
      ok: true,
      data: turnos
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Exportamos todas las funciones juntas
module.exports = {
  crearTurno,
  obtenerMisTurnos,
  actualizarEstadoTurno,
  reprogramarTurno,
  confirmarAsistencia,
  obtenerTurnosMedico, // <-- ¡No te olvides de agregarla acá!
  obtenerTodosLosTurnos
};