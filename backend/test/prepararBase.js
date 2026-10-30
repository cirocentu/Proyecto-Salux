// Deja la base de test con el esquema al día (aplica las migraciones).
// Se ejecuta antes de los tests de integración: npm run test:integration.
require('./entorno');
const { execFileSync } = require('child_process');
const path = require('path');

const prismaCli = require.resolve('prisma/build/index.js');
execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(__dirname, '..', 'prisma', 'schema.prisma')], {
  stdio: 'inherit',
  env: process.env,
});
