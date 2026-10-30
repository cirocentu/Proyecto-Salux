// Guardias de configuración: la seguridad de la infraestructura vive en archivos (Dockerfile,
// compose, vercel.json, workflows...) que ningún test funcional toca. Si alguien los cambia y
// pierde una protección, estos tests fallan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');

const raiz = path.join(__dirname, '..', '..', '..');
const backend = path.join(raiz, 'backend');
const leer = (...partes) => fs.readFileSync(path.join(...partes), 'utf-8').replace(/\r\n/g, '\n');
const lineas = (texto) => texto.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test.describe('Dockerfile del backend', () => {
  const dockerfile = leer(backend, 'Dockerfile');

  test('usa una versión de Node con soporte (22 o superior) en todas las etapas', () => {
    const versiones = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    assert.ok(versiones.length >= 1);
    assert.ok(versiones.every((v) => v >= 22), `versiones: ${versiones.join(', ')}`);
  });

  test('no corre como root y arranca en producción', () => {
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  });

  test('declara un HEALTHCHECK sobre /api/health', () => {
    assert.match(dockerfile, /^HEALTHCHECK[\s\S]*\/api\/health/m);
  });

  test('copia una lista explícita de carpetas, nunca todo el contexto', () => {
    assert.ok(!lineas(dockerfile).some((l) => /^COPY\s+\.\s+\./.test(l)), 'no debe haber COPY . .');
  });

  test('instala solo dependencias de producción y limpia la caché de npm', () => {
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /npm cache clean --force/);
  });
});

test.describe('docker-compose.yml', () => {
  const compose = YAML.parse(leer(backend, 'docker-compose.yml'));
  const { backend: api, 'postgres-db': db, redis } = compose.services;

  // Lo ÚNICO que el servidor necesita. Cualquier variable nueva tiene que sumarse acá a propósito.
  const PERMITIDAS = [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'CORS_ORIGIN',
    'TRUST_PROXY', 'FORZAR_HTTPS', 'REQUIERE_VERIFICACION_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
    'EMAIL_FROM', 'LOGIN_FALLOS_POR_CUENTA', 'CORREO_ESPERA_MINUTOS', 'CORREOS_POR_DIA_Y_DIRECCION',
    'CORREOS_ABUSABLES_POR_DIA', 'API_LIMITE_PETICIONES',
  ];

  test('el backend NO lee todo el .env (menor privilegio)', () => {
    assert.equal(api.env_file, undefined);
  });

  test('el backend recibe solo las variables de la lista permitida', () => {
    const recibidas = Object.keys(api.environment);
    assert.deepEqual(recibidas.filter((v) => !PERMITIDAS.includes(v)), []);
  });

  test('ninguna credencial administrativa ni de pruebas llega al servidor', () => {
    const recibidas = Object.keys(api.environment);
    for (const prohibida of recibidas.filter((v) => /^(ADMIN_|PRUEBA_|POSTGRES_|DB_APP_|REDIS_PASSWORD)/.test(v))) {
      assert.fail(`el backend no debería recibir ${prohibida}`);
    }
  });

  test('los secretos obligatorios hacen fallar el arranque si faltan', () => {
    assert.match(api.environment.JWT_SECRET, /\$\{JWT_SECRET:\?/);
    assert.match(api.environment.JWT_REFRESH_SECRET, /\$\{JWT_REFRESH_SECRET:\?/);
  });

  test('los puertos se publican solo en la máquina local', () => {
    for (const servicio of [api, db]) {
      for (const puerto of servicio.ports || []) assert.match(String(puerto), /^127\.0\.0\.1:/, `puerto: ${puerto}`);
    }
    assert.equal(redis.ports, undefined, 'Redis no publica ningún puerto');
  });

  test('el contenedor del backend está endurecido', () => {
    assert.ok(api.security_opt.includes('no-new-privileges:true'));
    assert.deepEqual(api.cap_drop, ['ALL']);
    assert.equal(api.read_only, true);
    assert.ok(api.tmpfs.includes('/tmp'));
    assert.equal(api.init, true);
    assert.ok(api.pids_limit > 0 && api.pids_limit <= 500);
    assert.ok(api.mem_limit);
  });

  test('los tres servicios impiden ganar privilegios', () => {
    for (const [nombre, servicio] of Object.entries({ backend: api, 'postgres-db': db, redis })) {
      assert.ok((servicio.security_opt || []).includes('no-new-privileges:true'), nombre);
    }
  });

  test('el backend espera a que la base y Redis estén saludables', () => {
    assert.equal(api.depends_on['postgres-db'].condition, 'service_healthy');
    assert.equal(api.depends_on.redis.condition, 'service_healthy');
  });
});

test.describe('.dockerignore y .gitignore', () => {
  const dockerignore = lineas(leer(backend, '.dockerignore'));
  const gitignore = lineas(leer(raiz, '.gitignore'));

  test('la imagen nunca recibe secretos, tests, scripts ni respaldos', () => {
    for (const entrada of ['.env', '.env.*', 'node_modules', 'test', 'scripts', 'crearAdmin.js', 'seedDemo.js', '*.dump', '*.pem', '*.key']) {
      assert.ok(dockerignore.includes(entrada), `.dockerignore debería incluir ${entrada}`);
    }
  });

  test('Git nunca recibe .env, claves ni volcados de la base (el repositorio es público)', () => {
    for (const entrada of ['.env', '*.dump', '*.dump.enc', '*.pem', '*.key']) {
      assert.ok(gitignore.includes(entrada), `.gitignore debería incluir ${entrada}`);
    }
  });

  test('las reglas de .gitignore ignoran los respaldos pero NO los scripts que los hacen', () => {
    const ignorado = (ruta) => spawnSync('git', ['check-ignore', '-q', ruta], { cwd: raiz }).status;
    if (spawnSync('git', ['--version']).status !== 0) return; // sin git disponible: se omite
    // 0 = ignorado, 1 = no ignorado
    for (const ruta of ['backend/respaldos/salux_supabase_20261023.dump.enc', 'salux.dump', 'claves/salux-respaldo-privada.pem', 'backend/.env']) {
      assert.equal(ignorado(ruta), 0, `${ruta} debería estar ignorado`);
    }
    for (const ruta of ['backend/scripts/respaldo/respaldar.sh', 'backend/scripts/respaldo/README.md', 'backend/.env.example']) {
      assert.equal(ignorado(ruta), 1, `${ruta} NO debería estar ignorado`);
    }
  });

  test('no hay ningún .env, clave o volcado versionado', () => {
    const versionados = spawnSync('git', ['ls-files'], { cwd: raiz, encoding: 'utf-8' });
    if (versionados.status !== 0) return; // sin git disponible: se omite
    const prohibidos = versionados.stdout.split('\n').filter((f) => /(^|\/)\.env($|\.(?!example))|\.pem$|\.key$|\.dump(\.enc)?$|\.sql\.gz$/.test(f));
    assert.deepEqual(prohibidos, []);
  });
});

test.describe('vercel.json', () => {
  const vercel = JSON.parse(leer(raiz, 'vercel.json'));
  const cabecera = (fuente, nombre) => vercel.headers.find((h) => h.source === fuente).headers.find((x) => x.key === nombre)?.value;

  test('solo la rama main se despliega (los previews no corren con los secretos de producción)', () => {
    const correr = (rama) => spawnSync('sh', ['-c', vercel.ignoreCommand], { env: { ...process.env, VERCEL_GIT_COMMIT_REF: rama } }).status;
    // Vercel: salida 0 = omitir el build, salida 1 = construir.
    assert.equal(correr('main'), 1, 'main se construye');
    for (const rama of ['feature/algo', 'fix/seguridad', 'dependabot/npm_and_yarn/x', 'main2', 'Main']) {
      assert.equal(correr(rama), 0, `${rama} se omite`);
    }
  });

  test('envía todas las cabeceras de seguridad', () => {
    for (const nombre of [
      'Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy',
      'Strict-Transport-Security', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-Permitted-Cross-Domain-Policies',
    ]) {
      assert.ok(cabecera('/(.*)', nombre), `falta ${nombre}`);
    }
  });

  test('la política de contenido (CSP) es estricta', () => {
    const csp = cabecera('/(.*)', 'Content-Security-Policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.ok(!/unsafe-eval/.test(csp), 'sin unsafe-eval');
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'sin scripts en línea');
  });

  test('las respuestas de la API no se guardan en caché', () => {
    assert.equal(cabecera('/api/(.*)', 'Cache-Control'), 'no-store');
  });

  test('la tarea diaria de mantenimiento está programada', () => {
    assert.ok(vercel.crons.some((c) => c.path === '/api/cron/mantenimiento'));
  });
});

test.describe('workflows de GitHub', () => {
  const dir = path.join(raiz, '.github', 'workflows');
  const workflows = fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => [f, YAML.parse(leer(dir, f))]);

  test('hay workflows que revisar', () => assert.ok(workflows.length >= 2));

  test('todos fijan permisos mínimos (solo leer el código)', () => {
    for (const [archivo, wf] of workflows) assert.deepEqual(wf.permissions, { contents: 'read' }, archivo);
  });

  test('ninguno usa pull_request_target (daría acceso a secretos a código de terceros)', () => {
    for (const [archivo, wf] of workflows) assert.ok(!('pull_request_target' in (wf.on || {})), archivo);
  });

  test('el respaldo corre solo por calendario o a mano, y solo si se lo activó', () => {
    const wf = Object.fromEntries(workflows)['respaldo.yml'];
    assert.deepEqual(Object.keys(wf.on).sort(), ['schedule', 'workflow_dispatch']);
    assert.match(wf.jobs.respaldo.if, /RESPALDO_ACTIVO/);
  });

  test('el CI prueba con Node 22 y 24 y verifica la imagen de Docker', () => {
    const wf = Object.fromEntries(workflows)['tests.yml'];
    assert.deepEqual(wf.jobs.backend.strategy.matrix.node, [22, 24]);
    assert.ok(wf.jobs.docker, 'falta el job docker');
  });

  test('Dependabot cubre npm, Docker y las acciones de GitHub', () => {
    const dep = YAML.parse(leer(raiz, '.github', 'dependabot.yml'));
    const ecosistemas = dep.updates.map((u) => u['package-ecosystem']);
    for (const e of ['npm', 'docker', 'github-actions']) assert.ok(ecosistemas.includes(e), e);
  });
});
