const prisma = require('../config/prisma');
const { registrarError } = require('../utils/registrarError');

const actualizarPerfil = async (req, res) => {
  try {
    // 1. Sabemos quién es gracias al Token
    const usuarioId = req.usuario.id;
    
    // 2. Recibimos los datos nuevos desde el frontend (Thunder Client)
    const { obraSocial, telefono } = req.body;

    // 3. Actualizamos directamente buscando por el usuarioId
    const pacienteActualizado = await prisma.paciente.update({
      where: { 
        usuarioId: usuarioId // Recordá que este campo es @unique en tu schema
      },
      data: {
        obraSocial: obraSocial,
        telefono: telefono
      },
      // Traemos el nombre del usuario para que la respuesta quede más completa
      include: {
        usuario: {
          select: { nomYape: true }
        }
      }
    });

    res.json({
      ok: true,
      message: '¡Perfil actualizado con éxito!',
      data: pacienteActualizado
    });

  } catch (error) {
    registrarError(error);
    // Error P2025 de Prisma significa "Record to update not found" (No se encontró el paciente)
    if (error.code === 'P2025') {
      return res.status(404).json({ ok: false, message: 'No se encontró un perfil de paciente para este usuario' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

module.exports = {
  actualizarPerfil
};