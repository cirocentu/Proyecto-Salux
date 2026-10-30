// Corre los tests de una carpeta con el runner nativo de Node (node --test).
// Se lista cada archivo a mano porque según la versión de Node, `--test` acepta
// carpetas, globs o ninguna de las dos.
// Uso: node test/correr.js unit | integration
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const carpeta = process.argv[2];
if (!['unit', 'integration'].includes(carpeta)) {
  console.error('Uso: node test/correr.js unit | integration');
  process.exit(2);
}

const dir = path.join(__dirname, carpeta);
const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
// Los de integración comparten UNA base: no pueden correr en paralelo.
const args = ['--test', ...(carpeta === 'integration' ? ['--test-concurrency=1'] : []), ...archivos];

const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
