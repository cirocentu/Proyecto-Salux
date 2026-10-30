const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { generar, contrasena } = require('../../scripts/generarSecretos');
const { problemasDeContrasena } = require('../../src/utils/politicaContrasena');

const carpeta = path.join(__dirname, '..', '..', 'scripts', 'respaldo');
const leer = (nombre) => fs.readFileSync(path.join(carpeta, nombre), 'utf-8').replace(/\r\n/g, '\n');

test.describe('generador de secretos de producción', () => {
  test('entrega los secretos con la longitud correcta', () => {
    const s = generar();
    assert.match(s.JWT_SECRET, /^[0-9a-f]{128}$/);
    assert.match(s.JWT_REFRESH_SECRET, /^[0-9a-f]{128}$/);
    assert.match(s.CRON_SECRET, /^[0-9a-f]{64}$/);
  });

  test('cada ejecución da valores distintos, y el secreto de acceso difiere del de refresh', () => {
    const a = generar();
    const b = generar();
    assert.notEqual(a.JWT_SECRET, b.JWT_SECRET);
    assert.notEqual(a.CONTRASENA_ADMIN_SUGERIDA, b.CONTRASENA_ADMIN_SUGERIDA);
    assert.notEqual(a.JWT_SECRET, a.JWT_REFRESH_SECRET);
  });

  test('la contraseña sugerida cumple la política de la app y es segura para pegar en una URL', () => {
    for (let i = 0; i < 50; i += 1) {
      const clave = contrasena(20);
      assert.equal(clave.length, 20);
      assert.match(clave, /^[A-Za-z0-9]+$/);
      assert.deepEqual(problemasDeContrasena(clave), []);
    }
  });

  test('los secretos generados pasan la validación de entorno de producción', () => {
    const { validarEntorno } = require('../../src/config/validarEntorno');
    const s = generar();
    const { errores } = validarEntorno({
      NODE_ENV: 'production', JWT_SECRET: s.JWT_SECRET, JWT_REFRESH_SECRET: s.JWT_REFRESH_SECRET,
      DATABASE_URL: 'postgresql://salux_app.ref:clave@host:6543/postgres', CORS_ORIGIN: 'https://salux.vercel.app', TRUST_PROXY: '1',
    });
    assert.deepEqual(errores, []);
  });

  test('el script solo escribe en la terminal (no crea archivos)', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'generarSecretos.js'), 'utf-8');
    assert.ok(!/writeFile|appendFile|createWriteStream/.test(fuente));
  });
});

test.describe('scripts de respaldo (contrato y seguridad)', () => {
  const hayBash = spawnSync('bash', ['--version']).status === 0 && spawnSync('openssl', ['version']).status === 0;
  const correr = (script, args = [], env = {}) =>
    spawnSync('bash', [path.join(carpeta, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf-8' });

  test('todos abortan ante cualquier error (set -euo pipefail)', () => {
    for (const script of ['respaldar.sh', 'restaurar.sh', 'generar-claves.sh']) {
      assert.match(leer(script), /^set -euo pipefail$/m, script);
    }
  });

  test('el volcado nunca se escribe sin cifrar: va por una tubería directo a openssl', () => {
    const fuente = leer('respaldar.sh');
    assert.match(fuente, /\| openssl smime -encrypt -binary -aes-256-cbc/);
    assert.ok(!/pg_dump[^\n]*>\s*"?\$/.test(fuente), 'pg_dump no debe redirigirse a un archivo');
  });

  test('el respaldo excluye las sesiones y los contadores', () => {
    const fuente = leer('respaldar.sh');
    assert.match(fuente, /exclude-table-data='public\."Sesion"'/);
    assert.match(fuente, /exclude-table-data='public\."RateLimitContador"'/);
  });

  test('la contraseña de la base viaja por variable de entorno, no como argumento visible', () => {
    const fuente = leer('respaldar.sh');
    assert.match(fuente, /docker run --rm -e RESPALDO_DATABASE_URL/);
    assert.ok(!/pg_dump "\$\{?RESPALDO_DATABASE_URL/.test(fuente.split('docker run')[0]), 'la URL no se expande en el comando del host');
  });

  test('respaldar.sh sin destino o sin certificado falla con código 2', { skip: !hayBash }, () => {
    assert.equal(correr('respaldar.sh').status, 2);
    assert.equal(correr('respaldar.sh', ['local'], { RESPALDO_CERTIFICADO: '/no/existe.pem' }).status, 2);
  });

  test('respaldar.sh supabase sin URL se detiene antes de tocar nada', { skip: !hayBash }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salux-resp-'));
    try {
      assert.equal(correr('generar-claves.sh', [dir]).status, 0);
      const r = correr('respaldar.sh', ['supabase'], {
        RESPALDO_CERTIFICADO: path.join(dir, 'salux-respaldo-publica.pem'), RESPALDO_SALIDA: path.join(dir, 'out'), RESPALDO_DATABASE_URL: '',
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Falta RESPALDO_DATABASE_URL/);
      assert.deepEqual(fs.readdirSync(path.join(dir, 'out')), [], 'no deja ningún archivo');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('generar-claves.sh crea el par y no pisa unas claves existentes', { skip: !hayBash }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salux-claves-'));
    try {
      assert.equal(correr('generar-claves.sh', [dir]).status, 0);
      assert.match(fs.readFileSync(path.join(dir, 'salux-respaldo-publica.pem'), 'utf-8'), /BEGIN CERTIFICATE/);
      assert.match(fs.readFileSync(path.join(dir, 'salux-respaldo-privada.pem'), 'utf-8'), /PRIVATE KEY/);
      const otraVez = correr('generar-claves.sh', [dir]);
      assert.notEqual(otraVez.status, 0);
      assert.match(otraVez.stderr, /No las piso/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lo cifrado con el certificado público solo se abre con SU clave privada', { skip: !hayBash }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salux-cifrado-'));
    try {
      correr('generar-claves.sh', [path.join(dir, 'a')]);
      correr('generar-claves.sh', [path.join(dir, 'b')]);
      const claro = path.join(dir, 'datos.txt');
      fs.writeFileSync(claro, 'dato-sensible-de-un-paciente '.repeat(200));
      const opciones = { encoding: 'utf-8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } };
      const cifrado = path.join(dir, 'datos.enc');

      spawnSync('openssl', ['smime', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER', '-in', claro, '-out', cifrado, path.join(dir, 'a', 'salux-respaldo-publica.pem')], opciones);
      assert.ok(!fs.readFileSync(cifrado).includes('dato-sensible'), 'el archivo cifrado no contiene el texto en claro');

      const descifrar = (clave) => spawnSync('openssl', ['smime', '-decrypt', '-binary', '-inform', 'DER', '-in', cifrado, '-inkey', clave], opciones);
      assert.equal(descifrar(path.join(dir, 'a', 'salux-respaldo-privada.pem')).stdout, fs.readFileSync(claro, 'utf-8'));
      assert.notEqual(descifrar(path.join(dir, 'b', 'salux-respaldo-privada.pem')).status, 0, 'otra clave no lo abre');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('restaurar.sh rechaza nombres de base peligrosos y no pisa nada', { skip: !hayBash }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salux-rest-'));
    try {
      const falso = path.join(dir, 'x');
      fs.writeFileSync(falso, 'x');
      for (const nombre of ['salux_db; drop database postgres', 'Salux-DB', '1abc', '../x']) {
        assert.equal(correr('restaurar.sh', [falso, falso, nombre]).status, 2, nombre);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
