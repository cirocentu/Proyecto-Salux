/**
 * crearAdmin.js
 * Script de seed: crea el usuario Administrador inicial en la base de datos.
 *
 * USO:
 *   1. Asegurate de tener el archivo .env con las variables ADMIN_* configuradas.
 *   2. Ejecutá: node crearAdmin.js
 *
 * Este script solo se corre UNA VEZ en el setup inicial del entorno.
 * NUNCA hardcodees credenciales aquí.
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

// ── Validación de variables de entorno requeridas ─────────────────────────────
const REQUIRED_ENV_VARS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NOMBRE', 'ADMIN_DNI'];

function validarVariablesDeEntorno() {
  const faltantes = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (faltantes.length > 0) {
    console.error('❌ Faltan las siguientes variables de entorno en tu archivo .env:');
    faltantes.forEach((v) => console.error(`   - ${v}`));
    console.error('   Completá el .env antes de ejecutar este script.');
    process.exit(1);
  }

  const problemas = problemasDeContrasena(process.env.ADMIN_PASSWORD, {
    email: process.env.ADMIN_EMAIL,
    dni: process.env.ADMIN_DNI,
    nombre: process.env.ADMIN_NOMBRE,
  });
  if (problemas.length > 0) {
    console.error('❌ ADMIN_PASSWORD no cumple la política de contraseñas:');
    problemas.forEach((p) => console.error(`   - ${p}`));
    process.exit(1);
  }
}

async function main() {
  mostrarBaseDeDatos();
  validarVariablesDeEntorno();

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NOMBRE, ADMIN_DNI } = process.env;

  console.log('🔄 Iniciando la creación del Administrador inicial...');

  // Verificar si ya existe un admin con ese email o DNI
  const existente = await prisma.usuario.findFirst({
    where: {
      OR: [{ email: ADMIN_EMAIL }, { dni: ADMIN_DNI }],
    },
  });

  if (existente) {
    console.warn('⚠️  Ya existe un usuario con ese email o DNI. No se creó un duplicado.');
    return;
  }

  // Hash seguro con 12 rounds (mínimo recomendado para producción)
  const contrasenaEncriptada = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const nuevoAdmin = await prisma.usuario.create({
    data: {
      nomYape: ADMIN_NOMBRE,
      email: ADMIN_EMAIL,
      dni: ADMIN_DNI,
      contrasena: contrasenaEncriptada,
      activo: true,
      admin: {
        create: {},
      },
    },
    include: {
      admin: true,
    },
  });

  console.log('✅ Administrador creado exitosamente:');
  console.log(`   Email : ${nuevoAdmin.email}`);
  console.log(`   Nombre: ${nuevoAdmin.nomYape}`);
  console.log('   Contraseña: la que configuraste en ADMIN_PASSWORD del .env');
}

main()
  .catch((error) => {
    console.error('❌ Error al crear el Administrador:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
