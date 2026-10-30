const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Guardias de la documentación y del pipeline: lo que se rompe en silencio si nadie lo mira
// (un enlace muerto, un archivo comunitario que desaparece, un trabajo de CI que no cuenta).

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

const DOCUMENTOS = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/DESPLIEGUE.md',
  'docs/ARQUITECTURA.md', 'docs/REGLAS-DE-NEGOCIO.md', 'docs/README.md',
  'backend/README.md', 'backend/scripts/respaldo/README.md',
];

test.describe('documentación', () => {
  test('existen los archivos que un repositorio profesional tiene que tener', () => {
    for (const ruta of [
      'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/DESPLIEGUE.md', 'docs/ARQUITECTURA.md', 'docs/REGLAS-DE-NEGOCIO.md', 'docs/README.md',
      '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/error.yml', '.github/ISSUE_TEMPLATE/mejora.yml',
      '.github/ISSUE_TEMPLATE/config.yml', '.github/dependabot.yml', '.editorconfig', '.nvmrc',
    ]) {
      assert.ok(fs.existsSync(path.join(RAIZ, ruta)), `falta ${ruta}`);
    }
  });

  for (const doc of DOCUMENTOS) {
    test(`${doc}: todos los enlaces relativos apuntan a algo que existe`, () => {
      const texto = leer(doc).replace(/```[\s\S]*?```/g, '');
      const enlaces = [...texto.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)].map((m) => m[1]);
      for (const enlace of enlaces) {
        const archivo = decodeURIComponent(enlace.split('#')[0]);
        if (!archivo) continue;
        const destino = path.resolve(RAIZ, path.dirname(doc), archivo);
        assert.ok(fs.existsSync(destino), `${doc} enlaza a "${enlace}", que no existe`);
      }
    });
  }

  test('el README raíz enlaza a cada documento principal', () => {
    const readme = leer('README.md');
    for (const ruta of ['docs/ARQUITECTURA.md', 'docs/REGLAS-DE-NEGOCIO.md', 'docs/README.md', 'docs/DESPLIEGUE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'backend/README.md']) {
      assert.ok(readme.includes(`(${ruta}`), `el README no enlaza a ${ruta}`);
    }
  });

  test('las reglas de negocio documentadas mencionan sus pruebas, y esas pruebas existen', () => {
    const reglas = leer('docs/REGLAS-DE-NEGOCIO.md');
    for (const prueba of reglas.match(/backend\/test\/[\w/.-]+\.js/g) || []) {
      assert.ok(fs.existsSync(path.join(RAIZ, prueba)), `no existe ${prueba}`);
    }
  });
});

test.describe('pipeline de CI', () => {
  const tests = leer('.github/workflows/tests.yml');
  const trabajos = (texto) => [...texto.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1])
    .filter((n) => !['postgres', 'run', 'env'].includes(n));

  test('el chequeo único "CI OK" espera a TODOS los demás trabajos', () => {
    const cuerpoJobs = tests.slice(tests.indexOf('\njobs:'));
    const todos = trabajos(cuerpoJobs).filter((n) => n !== 'ci-ok' && n !== 'jobs');
    const needs = (cuerpoJobs.match(/needs: \[([^\]]+)\]/) || [])[1];
    assert.ok(needs, 'ci-ok no declara needs');
    const esperados = needs.split(',').map((s) => s.trim());
    for (const trabajo of todos) {
      assert.ok(esperados.includes(trabajo), `el trabajo "${trabajo}" no está en los needs de ci-ok: no frenaría un merge`);
    }
    assert.ok(/name: CI OK/.test(tests), 'el trabajo se tiene que llamar "CI OK" (es el que se exige en main)');
  });

  test('ci-ok corre siempre (si no, un trabajo caído lo dejaría "omitido" y contaría como éxito)', () => {
    assert.match(tests, /ci-ok:[\s\S]*?if: always\(\)/);
  });

  test('todos los workflows declaran permisos mínimos y cancelan los PR viejos', () => {
    for (const archivo of fs.readdirSync(path.join(RAIZ, '.github', 'workflows')).filter((f) => f.endsWith('.yml'))) {
      const texto = leer(`.github/workflows/${archivo}`);
      assert.match(texto, /^permissions:\s*\n\s+contents: read/m, `${archivo}: falta "permissions: contents: read" a nivel del archivo`);
    }
    assert.match(tests, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });

  test('los trabajos tienen tope de tiempo', () => {
    const cantidadTrabajos = (tests.match(/^ {4}runs-on:/gm) || []).length;
    const cantidadTopes = (tests.match(/^ {4}timeout-minutes:/gm) || []).length;
    assert.equal(cantidadTopes, cantidadTrabajos);
  });
});

test.describe('plantillas', () => {
  test('la plantilla de PR pide lo que CONTRIBUTING.md exige', () => {
    const plantilla = leer('.github/PULL_REQUEST_TEMPLATE.md');
    for (const clave of ['npm test', 'test:a11y', 'REGLAS-DE-NEGOCIO', 'migraci']) {
      assert.ok(plantilla.includes(clave), `la plantilla no menciona "${clave}"`);
    }
  });

  test('los formularios de issues derivan las vulnerabilidades al reporte privado', () => {
    assert.match(leer('.github/ISSUE_TEMPLATE/config.yml'), /security\/advisories\/new/);
  });
});
