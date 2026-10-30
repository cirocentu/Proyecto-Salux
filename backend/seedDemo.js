/**
 * seedDemo.js
 * Carga datos de DEMO/PRUEBA en una base vacía: especialidades, un médico con
 * su disponibilidad y un paciente. Es idempotente (se puede correr varias
 * veces) y NO toca nada que ya exista.
 *
 * Las credenciales salen del .env (PRUEBA_MEDICO_* y PRUEBA_PACIENTE_*, ver
 * .env.example): si faltan, solo se cargan las especialidades.
 *
 * USO:   node seedDemo.js        (antes: node crearAdmin.js para el administrador)
 * NO usar en una base de producción con datos reales.
 */

require('dotenv').config();
// Variables que ya vengan de la terminal (por ejemplo DATABASE_URL de Supabase)
// tienen prioridad sobre el .env, así un script se puede apuntar a otra base
// sin tocar el archivo. Siempre muestra a cuál se conecta.
function mostrarBaseDeDatos() {
  try {
    const { host, pathname } = new URL(process.env.DATABASE_URL);
    console.log(`🗄️  Base de datos: ${host}${pathname}`);
  } catch {
    console.log('🗄️  Base de datos: (DATABASE_URL inválida o ausente)');
  }
}

const bcrypt = require('bcryptjs');
const prisma = require('./src/config/prisma');
const { problemasDeContrasena } = require('./src/utils/politicaContrasena');

const ESPECIALIDADES = ['Cardiologia', 'Neurologia'];

async function crearUsuarioSiNoExiste({ email, dni, nomYape, contrasena, perfil }) {
  const existente = await prisma.usuario.findFirst({ where: { OR: [{ email }, { dni }] } });
  if (existente) {
    console.log(`   · ya existe ${email} (se deja como está)`);
    return null;
  }
  const problemas = problemasDeContrasena(contrasena, { email, dni, nombre: nomYape });
  if (problemas.length > 0) {
    console.error(`   ✖ la contraseña de ${email} no cumple la política: ${problemas.join(', ')}`);
    return null;
  }
  const usuario = await prisma.usuario.create({
    data: { email, dni, nomYape, contrasena: await bcrypt.hash(contrasena, 12), ...perfil },
  });
  console.log(`   ✔ creado ${email}`);
  return usuario;
}

async function main() {
  mostrarBaseDeDatos();
  console.log('🌱 Cargando datos de demo...');

  for (const nombre of ESPECIALIDADES) {
    const existe = await prisma.especialidad.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' } } });
    if (!existe) await prisma.especialidad.create({ data: { nombre } });
  }
  console.log(`   ✔ especialidades: ${ESPECIALIDADES.join(', ')}`);

  const env = process.env;
  if (env.PRUEBA_MEDICO_EMAIL && env.PRUEBA_MEDICO_PASSWORD) {
    const neurologia = await prisma.especialidad.findFirst({ where: { nombre: 'Neurologia' } });
    const franjas = [1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, horaInicioMinutos: 8 * 60, horaFinMinutos: 12 * 60 }));
    await crearUsuarioSiNoExiste({
      email: env.PRUEBA_MEDICO_EMAIL,
      dni: env.PRUEBA_MEDICO_DNI,
      nomYape: 'Mario Prueba',
      contrasena: env.PRUEBA_MEDICO_PASSWORD,
      perfil: {
        medico: {
          create: {
            matricula: env.PRUEBA_MEDICO_MATRICULA || 'MP-QA-001',
            consultorio: '12',
            especialidades: { connect: [{ idEspecialidad: neurologia.idEspecialidad }] },
            disponibilidades: { create: franjas },
          },
        },
      },
    });
  }

  if (env.PRUEBA_PACIENTE_EMAIL && env.PRUEBA_PACIENTE_PASSWORD) {
    await crearUsuarioSiNoExiste({
      email: env.PRUEBA_PACIENTE_EMAIL,
      dni: env.PRUEBA_PACIENTE_DNI,
      nomYape: 'Paula Prueba',
      contrasena: env.PRUEBA_PACIENTE_PASSWORD,
      perfil: { paciente: { create: {} } },
    });
  }

  console.log('✅ Listo.');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
