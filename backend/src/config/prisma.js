const { PrismaClient } = require('@prisma/client');

// Instancia única de Prisma compartida por toda la app.
// Evita agotar el pool de conexiones a la base de datos.
const prisma = new PrismaClient();

module.exports = prisma;
