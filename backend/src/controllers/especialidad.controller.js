const prisma = require('../config/prisma');
const { registrarError } = require('../utils/registrarError');
const { parsearId } = require('../utils/ids');

const crearEspecialidad = async (req, res) => {
  try {
    const { nombre } = req.body;

    // Comparación case-insensitive: "Cardiología" y "cardiología" son la misma
    // especialidad para el negocio. PostgreSQL distingue mayúsculas, así que se
    // pide explícito (hay además un índice único sobre lower(nombre)).
    const existente = await prisma.especialidad.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } }
    });

    if (existente && existente.activo) {
      return res.status(409).json({ ok: false, message: 'Ya existe una especialidad con ese nombre' });
    }

    // Estaba eliminada (borrado lógico): "crearla" de nuevo la reactiva, así
    // conserva a los médicos que ya la tenían asignada.
    if (existente) {
      const reactivada = await prisma.especialidad.update({
        where: { idEspecialidad: existente.idEspecialidad },
        data: { activo: true }
      });
      return res.status(201).json({
        ok: true,
        message: 'Especialidad reactivada con éxito',
        data: reactivada
      });
    }

    const nuevaEspecialidad = await prisma.especialidad.create({
      data: { nombre }
    });

    res.status(201).json({
      ok: true,
      message: 'Especialidad creada con éxito',
      data: nuevaEspecialidad
    });
  } catch (error) {
    registrarError(error);
    // Carrera entre dos altas simultáneas con el mismo nombre
    if (error.code === 'P2002') {
      return res.status(409).json({ ok: false, message: 'Ya existe una especialidad con ese nombre' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
const obtenerEspecialidades = async (req, res) => {
  try {
    // Para el admin incluimos los médicos asignados (solo id y nombre) para que
    // vea a quiénes afecta antes de confirmar un borrado lógico. Este endpoint
    // lo consume cualquier usuario logueado: al resto no se le devuelve.
    const esAdmin = !!(await prisma.administrador.findUnique({ where: { usuarioId: req.usuario.id } }));
    const especialidades = await prisma.especialidad.findMany({
      where: { activo: true },
      ...(esAdmin ? { include: { medicos: { select: { idMedico: true, usuario: { select: { nomYape: true } } } } } } : {})
    });
    
    res.json({ 
      ok: true, 
      data: especialidades 
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const eliminarEspecialidad = async (req, res) => {
  try {
    const idEspecialidad = parsearId(req.params.id);
    if (idEspecialidad === null) {
      return res.status(400).json({ ok: false, message: 'id de especialidad inválido' });
    }

    const especialidad = await prisma.especialidad.findUnique({ where: { idEspecialidad } });

    if (!especialidad || !especialidad.activo) {
      return res.status(404).json({ ok: false, message: 'Especialidad no encontrada' });
    }

    // Borrado lógico: no es un delete físico, así que no hace falta
    // desvincular médicos primero. La relación muchos-a-muchos queda intacta
    // (el médico sigue teniendo la especialidad en su lista), simplemente
    // deja de aparecer en las especialidades activas del sistema. El
    // frontend le muestra al admin qué médicos se ven afectados ANTES de
    // llegar acá, en el modal de confirmación.
    await prisma.especialidad.update({ where: { idEspecialidad }, data: { activo: false } });

    res.json({ ok: true, message: 'Especialidad eliminada con éxito' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Acordate de exportarla
module.exports = {
  crearEspecialidad,
  obtenerEspecialidades,
  eliminarEspecialidad
};