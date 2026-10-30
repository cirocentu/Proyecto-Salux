// Utilidades compartidas por los tests de integración.
require('./entorno');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const request = require('supertest');

const app = require('../src/app');
const prisma = require('../src/config/prisma');

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

// Costo bajo: acelera los tests. bcrypt.compare funciona igual con cualquier costo.
const hash = (clave) => bcrypt.hashSync(clave, 4);

let contador = 0;
const unico = () => `${Date.now().toString(36)}${(contador += 1)}`;

// Vacía todas las tablas (menos el historial de migraciones). Solo corre si
// entorno.js confirmó que la base es de test.
async function limpiarBase() {
  const tablas = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tablas.length === 0) return;
  const lista = tablas.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

const CLAVE = 'ClaveDePrueba2026x';

// Crea un usuario directo en la base (sin pasar por la API). `rol`: paciente | medico | admin.
async function crearUsuario({ rol = 'paciente', email, dni, nomYape, contrasena = CLAVE, extra = {}, medico = {} } = {}) {
  const id = unico();
  const datos = {
    email: email || `${rol}.${id}@prueba.test`,
    dni: dni || String(10000000 + (contador % 89999999)),
    nomYape: nomYape || `Persona ${id}`,
    contrasena: hash(contrasena),
    ...extra,
  };
  if (rol === 'paciente') datos.paciente = { create: {} };
  if (rol === 'admin') datos.admin = { create: {} };
  if (rol === 'medico') {
    datos.medico = { create: { matricula: `MP-${id}`, consultorio: 'A', ...medico } };
  }
  const usuario = await prisma.usuario.create({ data: datos, include: { paciente: true, medico: true, admin: true } });
  return { ...usuario, contrasenaPlana: contrasena };
}

// Inicia sesión por la API; devuelve el token y la cookie de refresh.
async function iniciarSesion(identificador, contrasena = CLAVE) {
  const res = await request(app).post('/api/auth/login').send({ identificador, contrasena });
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión (${res.status}): ${JSON.stringify(res.body)}`);
  return { token: res.body.token, cookie: res.headers['set-cookie'], res };
}

const conToken = (token) => ({ Authorization: `Bearer ${token}` });

// Crea una especialidad directo en la base.
const crearEspecialidad = (nombre) => prisma.especialidad.create({ data: { nombre } });

// Próxima fecha futura que cae en `diaSemana` (0=domingo..6=sábado, hora Argentina)
// a la hora `hora`:`minuto` Argentina, como ISO UTC. Sirve para probar disponibilidad.
function proximaFecha(diaSemana, hora = 9, minuto = 0, semanasAdelante = 1) {
  const OFFSET_HS = 3; // Argentina = UTC-3 todo el año
  const base = new Date(Date.now() - OFFSET_HS * 3600 * 1000); // "reloj" argentino en campos UTC
  base.setUTCHours(0, 0, 0, 0);
  let dias = (diaSemana - base.getUTCDay() + 7) % 7;
  if (dias === 0) dias = 7;
  dias += 7 * (semanasAdelante - 1);
  const dia = new Date(base.getTime() + dias * 24 * 3600 * 1000);
  dia.setUTCHours(hora + OFFSET_HS, minuto, 0, 0);
  return dia;
}

module.exports = {
  app, prisma, request, sha256, hash, CLAVE,
  limpiarBase, crearUsuario, iniciarSesion, conToken, crearEspecialidad, proximaFecha,
};
