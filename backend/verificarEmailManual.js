/**
 * verificarEmailManual.js
 * Herramienta de DESARROLLO: marca como verificado el email de una cuenta, sin
 * pasar por el enlace del correo. Sirve para probar con emails inventados
 * (que nunca recibirían el mail de activación) cuando REQUIERE_VERIFICACION_EMAIL=true.
 *
 * USO:  node verificarEmailManual.js correo@ejemplo.com
 *
 * Necesita acceso a la base (DATABASE_URL del .env), así que solo la puede
 * correr quien administra el servidor. No es un endpoint de la API.
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

const prisma = require('./src/config/prisma');

async function main() {
  mostrarBaseDeDatos();
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Uso: node verificarEmailManual.js correo@ejemplo.com');
    process.exit(1);
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) {
    console.error(`No existe ninguna cuenta con el email ${email}`);
    process.exit(1);
  }
  if (usuario.emailVerificado) {
    console.log(`La cuenta ${email} ya estaba verificada.`);
    return;
  }

  await prisma.usuario.update({
    where: { idUsuario: usuario.idUsuario },
    data: { emailVerificado: true, verificacionToken: null, verificacionExpira: null },
  });
  console.log(`✅ Email verificado: ${email}`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
