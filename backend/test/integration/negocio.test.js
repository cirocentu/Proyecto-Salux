const test = require('node:test');
const assert = require('node:assert/strict');
const {
  app, prisma, request, limpiarBase, crearUsuario, iniciarSesion, conToken, crearEspecialidad, proximaFecha,
} = require('../helpers');

// Auditoría Fase 4: reglas de negocio de los turnos en sus casos límite — solapamientos
// parciales, carreras entre pedidos simultáneos, integridad del borrado lógico y entradas extremas.

test.before(limpiarBase);
test.after(() => prisma.$disconnect());

const MINUTO = 60 * 1000;

async function medicoConEspecialidad(opcionesMedico = {}) {
  const especialidad = await crearEspecialidad(`Esp-${Math.random().toString(36).slice(2, 8)}`);
  const medico = await crearUsuario({ rol: 'medico', medico: opcionesMedico });
  await prisma.medico.update({
    where: { idMedico: medico.medico.idMedico },
    data: { especialidades: { connect: { idEspecialidad: especialidad.idEspecialidad } } },
  });
  return {
    especialidad, medico,
    idMedico: medico.medico.idMedico,
    tokenMedico: (await iniciarSesion(medico.email)).token,
  };
}

async function paciente() {
  const usuario = await crearUsuario({ rol: 'paciente' });
  return { usuario, idPaciente: usuario.paciente.idPaciente, token: (await iniciarSesion(usuario.email)).token };
}

async function admin() {
  const a = await crearUsuario({ rol: 'admin' });
  return (await iniciarSesion(a.email)).token;
}

const reservar = (token, medicoId, fecha, extra = {}) =>
  request(app).post('/api/turnos').set(conToken(token)).send({ medicoId, fechaYhora: fecha.toISOString(), ...extra });

const cambiar = (token, id, estado) => request(app).patch(`/api/turnos/${id}`).set(conToken(token)).send({ estado });

test.describe('solapamientos parciales', () => {
  test('un paciente no puede tener dos turnos que se pisan, aunque sean con médicos distintos', async () => {
    const m1 = await medicoConEspecialidad({ duracionTurnoMinutos: 30 });
    const m2 = await medicoConEspecialidad({ duracionTurnoMinutos: 30 });
    const ana = await paciente();
    const base = proximaFecha(3, 10);
    assert.equal((await reservar(ana.token, m1.idMedico, base)).status, 201);
    const pisado = await reservar(ana.token, m2.idMedico, new Date(base.getTime() + 15 * MINUTO));
    assert.equal(pisado.status, 409, 'a las 10:15 todavía está en el turno de las 10:00');
    assert.equal((await reservar(ana.token, m2.idMedico, new Date(base.getTime() + 30 * MINUTO))).status, 201, 'justo al terminar, sí');
  });

  test('el solapamiento del paciente respeta la duración del turno que YA tenía (60 min)', async () => {
    const largo = await medicoConEspecialidad({ duracionTurnoMinutos: 60 });
    const corto = await medicoConEspecialidad({ duracionTurnoMinutos: 15 });
    const ana = await paciente();
    const base = proximaFecha(3, 10);
    assert.equal((await reservar(ana.token, largo.idMedico, base)).status, 201);
    assert.equal((await reservar(ana.token, corto.idMedico, new Date(base.getTime() + 45 * MINUTO))).status, 409);
    assert.equal((await reservar(ana.token, corto.idMedico, new Date(base.getTime() + 60 * MINUTO))).status, 201);
  });

  test('reprogramar tampoco permite pisar otro turno propio', async () => {
    const m1 = await medicoConEspecialidad();
    const m2 = await medicoConEspecialidad();
    const ana = await paciente();
    const base = proximaFecha(3, 10);
    await reservar(ana.token, m1.idMedico, base);
    const otro = (await reservar(ana.token, m2.idMedico, proximaFecha(3, 15))).body.data;
    const res = await request(app).patch(`/api/turnos/${otro.idTurno}/reprogramar`).set(conToken(ana.token))
      .send({ fechaYhora: new Date(base.getTime() + 10 * MINUTO).toISOString() });
    assert.equal(res.status, 409);
  });

  test('no se puede acortar la duración del turno de un médico si eso deja turnos futuros pisados', async () => {
    const m = await medicoConEspecialidad({ duracionTurnoMinutos: 60 });
    const ana = await paciente();
    const beto = await paciente();
    const base = proximaFecha(3, 10);
    assert.equal((await reservar(ana.token, m.idMedico, base)).status, 201);

    const tokenAdmin = await admin();
    const cambio = await request(app).patch(`/api/medicos/${m.idMedico}`).set(conToken(tokenAdmin)).send({ duracionTurnoMinutos: 30 });
    assert.equal(cambio.status, 409, 'hay un turno futuro reservado con la duración vieja');
    assert.equal((await reservar(beto.token, m.idMedico, new Date(base.getTime() + 30 * MINUTO))).status, 409, 'el turno de las 10:00 sigue ocupando hasta las 11:00');
  });

  test('cambiar la duración sin turnos futuros activos sí se puede', async () => {
    const m = await medicoConEspecialidad({ duracionTurnoMinutos: 60 });
    const ana = await paciente();
    const t = (await reservar(ana.token, m.idMedico, proximaFecha(3, 10))).body.data;
    await cambiar(ana.token, t.idTurno, 'CANCELADO');
    const tokenAdmin = await admin();
    const cambio = await request(app).patch(`/api/medicos/${m.idMedico}`).set(conToken(tokenAdmin)).send({ duracionTurnoMinutos: 30 });
    assert.equal(cambio.status, 200);
  });
});

test.describe('pedidos simultáneos (carreras)', () => {
  test('con reservas parcialmente superpuestas a la vez, entra una sola', async () => {
    const m = await medicoConEspecialidad({ duracionTurnoMinutos: 30 });
    const pacientes = await Promise.all([1, 2, 3, 4, 5, 6].map(() => paciente()));
    const base = proximaFecha(4, 10);
    // 10:00, 10:05, 10:10 ... todas se pisan entre sí
    const respuestas = await Promise.all(pacientes.map((p, i) => reservar(p.token, m.idMedico, new Date(base.getTime() + i * 5 * MINUTO))));
    const creadas = respuestas.filter((r) => r.status === 201).length;
    assert.equal(creadas, 1, `estados: ${respuestas.map((r) => r.status).join(',')}`);
    assert.ok(respuestas.every((r) => [201, 409].includes(r.status)), 'el resto responde 409, nunca 500');
    const enBase = await prisma.turno.count({ where: { medicoId: m.idMedico, estado: { not: 'CANCELADO' } } });
    assert.equal(enBase, 1);
  });

  test('un mismo paciente reservando a la vez con dos médicos en horarios que se pisan: entra uno', async () => {
    const m1 = await medicoConEspecialidad();
    const m2 = await medicoConEspecialidad();
    const ana = await paciente();
    const base = proximaFecha(4, 11);
    const [a, b] = await Promise.all([
      reservar(ana.token, m1.idMedico, base),
      reservar(ana.token, m2.idMedico, new Date(base.getTime() + 10 * MINUTO)),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  });

  test('cancelar y reprogramar a la vez no "revive" un turno cancelado', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    for (let i = 0; i < 8; i += 1) {
      const t = (await reservar(ana.token, m.idMedico, proximaFecha(2, 8 + i))).body.data;
      const [cancelar, mover] = await Promise.all([
        cambiar(ana.token, t.idTurno, 'CANCELADO'),
        request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(ana.token)).send({ fechaYhora: proximaFecha(2, 8 + i, 0, 2).toISOString() }),
      ]);
      const final = await prisma.turno.findUnique({ where: { idTurno: t.idTurno } });
      if (cancelar.status === 200) {
        assert.equal(final.estado, 'CANCELADO', `iteración ${i}: se canceló (200) pero quedó ${final.estado} (reprogramar respondió ${mover.status})`);
      }
    }
  });

  test('dos cambios de estado a la vez: el segundo no pisa al primero', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    for (let i = 0; i < 6; i += 1) {
      const t = await prisma.turno.create({
        data: { fechaYhora: new Date(Date.now() - 3600000 - i * 3600000), medicoId: m.idMedico, pacienteId: ana.idPaciente, estado: 'CONFIRMADO' },
      });
      const [fin, canc] = await Promise.all([cambiar(m.tokenMedico, t.idTurno, 'FINALIZADO'), cambiar(ana.token, t.idTurno, 'CANCELADO')]);
      const final = await prisma.turno.findUnique({ where: { idTurno: t.idTurno } });
      const ganadores = [fin, canc].filter((r) => r.status === 200).length;
      assert.equal(ganadores, 1, `iteración ${i}: ${fin.status}/${canc.status}, estado final ${final.estado}`);
    }
  });
});

test.describe('ausencias y hora Argentina', () => {
  test('una ausencia cubre el día completo de Argentina, también a la noche (22:00 ya es el día siguiente en UTC)', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const noche = proximaFecha(3, 22);
    const dia = new Date(noche.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const abre = await request(app).post('/api/disponibilidad/ausencias').set(conToken(m.tokenMedico)).send({ fechaInicio: dia, fechaFin: dia });
    assert.equal(abre.status, 201);

    const res = await reservar(ana.token, m.idMedico, noche);
    assert.equal(res.status, 422, 'el miércoles 22:00 de Argentina cae dentro de la ausencia del miércoles');
    assert.match(res.body.message, /ausencia/i);
    const madrugada = new Date(noche.getTime() + 2.5 * 3600 * 1000); // jueves 00:30 Argentina
    assert.equal((await reservar(ana.token, m.idMedico, madrugada)).status, 201, 'el jueves 00:30 ya no');
  });
});

test.describe('turnos en el pasado', () => {
  test('no se reprograma ni se confirma asistencia a un turno cuyo horario ya pasó (422)', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const pasado = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() - 2 * 3600000), medicoId: m.idMedico, pacienteId: ana.idPaciente, estado: 'CONFIRMADO' },
    });
    const mover = await request(app).patch(`/api/turnos/${pasado.idTurno}/reprogramar`).set(conToken(ana.token))
      .send({ fechaYhora: proximaFecha(2, 10).toISOString() });
    assert.equal(mover.status, 422);
    const conf = await request(app).patch(`/api/turnos/${pasado.idTurno}/confirmar-asistencia`).set(conToken(ana.token));
    assert.equal(conf.status, 422);
  });
});

test.describe('entradas extremas', () => {
  test('la fecha del turno debe ser un minuto exacto (sin segundos ni milésimas)', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const base = proximaFecha(2, 10);
    const conSegundos = await request(app).post('/api/turnos').set(conToken(ana.token))
      .send({ medicoId: m.idMedico, fechaYhora: new Date(base.getTime() + 30 * 1000).toISOString() });
    const conMilis = await request(app).post('/api/turnos').set(conToken(ana.token))
      .send({ medicoId: m.idMedico, fechaYhora: new Date(base.getTime() + 500).toISOString() });
    assert.equal(conSegundos.status, 400);
    assert.equal(conMilis.status, 400);
  });

  test('no se reservan turnos a más de un año vista (400)', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const lejano = new Date(Date.now() + 400 * 24 * 3600 * 1000);
    lejano.setUTCSeconds(0, 0);
    assert.equal((await reservar(ana.token, m.idMedico, lejano)).status, 400);
    assert.equal((await reservar(ana.token, m.idMedico, new Date('9999-12-31T12:00:00.000Z'))).status, 400);
  });

  test('ids fuera de rango o con basura responden 400, nunca 500', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const tokenAdmin = await admin();

    assert.equal((await reservar(ana.token, 99999999999, proximaFecha(2, 10))).status, 400, 'medicoId enorme');
    assert.equal((await cambiar(m.tokenMedico, '99999999999', 'CONFIRMADO')).status, 400, 'id de turno enorme');
    assert.equal((await cambiar(m.tokenMedico, '12abc', 'CONFIRMADO')).status, 400, 'id con letras');
    assert.equal((await cambiar(m.tokenMedico, '1e3', 'CONFIRMADO')).status, 400, 'notación científica');
    assert.equal((await cambiar(m.tokenMedico, '2.5', 'CONFIRMADO')).status, 400, 'decimal');
    assert.equal((await request(app).patch('/api/medicos/99999999999').set(conToken(tokenAdmin)).send({ consultorio: 'A' })).status, 400);
    assert.equal((await request(app).patch('/api/medicos/7x/estado').set(conToken(tokenAdmin)).send({ activo: false })).status, 400);
    assert.equal((await request(app).delete('/api/especialidades/99999999999').set(conToken(tokenAdmin))).status, 400);
    assert.equal((await request(app).get('/api/disponibilidad/medico/99999999999').set(conToken(ana.token))).status, 400);
  });

  test('una ausencia con un día que no existe (31 de febrero) es 400, no 500', async () => {
    const m = await medicoConEspecialidad();
    const res = await request(app).post('/api/disponibilidad/ausencias').set(conToken(m.tokenMedico))
      .send({ fechaInicio: '2027-02-31', fechaFin: '2027-02-31' });
    assert.equal(res.status, 400);
  });
});

test.describe('borrado lógico: integridad', () => {
  test('desactivar un médico con turnos futuros pide confirmación (409) y no toca nada', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const t = (await reservar(ana.token, m.idMedico, proximaFecha(2, 10))).body.data;
    const tokenAdmin = await admin();

    const res = await request(app).patch(`/api/medicos/${m.idMedico}/estado`).set(conToken(tokenAdmin)).send({ activo: false });
    assert.equal(res.status, 409);
    assert.equal(res.body.turnosFuturos, 1);
    const usuario = await prisma.usuario.findUnique({ where: { idUsuario: m.medico.idUsuario } });
    assert.equal(usuario.activo, true);
    assert.equal((await prisma.turno.findUnique({ where: { idTurno: t.idTurno } })).estado, 'PENDIENTE');
  });

  test('con cancelarTurnosFuturos se desactiva y se cancelan solo los turnos futuros vivos', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const futuro = (await reservar(ana.token, m.idMedico, proximaFecha(2, 10))).body.data;
    const futuroConfirmado = (await reservar(ana.token, m.idMedico, proximaFecha(2, 12))).body.data;
    await cambiar(m.tokenMedico, futuroConfirmado.idTurno, 'CONFIRMADO');
    const yaCancelado = (await reservar(ana.token, m.idMedico, proximaFecha(2, 14))).body.data;
    await cambiar(ana.token, yaCancelado.idTurno, 'CANCELADO');
    const historico = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() - 86400000), medicoId: m.idMedico, pacienteId: ana.idPaciente, estado: 'FINALIZADO' },
    });
    const tokenAdmin = await admin();

    const res = await request(app).patch(`/api/medicos/${m.idMedico}/estado`).set(conToken(tokenAdmin))
      .send({ activo: false, cancelarTurnosFuturos: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.turnosCancelados, 2);
    const estado = async (id) => (await prisma.turno.findUnique({ where: { idTurno: id } })).estado;
    assert.equal(await estado(futuro.idTurno), 'CANCELADO');
    assert.equal(await estado(futuroConfirmado.idTurno), 'CANCELADO');
    assert.equal(await estado(historico.idTurno), 'FINALIZADO', 'el historial no se toca');
  });

  test('desactivar sin turnos futuros funciona directo; activar nunca pide nada', async () => {
    const m = await medicoConEspecialidad();
    const tokenAdmin = await admin();
    const off = await request(app).patch(`/api/medicos/${m.idMedico}/estado`).set(conToken(tokenAdmin)).send({ activo: false });
    assert.equal(off.status, 200);
    const on = await request(app).patch(`/api/medicos/${m.idMedico}/estado`).set(conToken(tokenAdmin)).send({ activo: true });
    assert.equal(on.status, 200);
  });

  test('un médico desactivado pierde el acceso al instante, pero su historial sigue visible para el paciente', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const t = (await reservar(ana.token, m.idMedico, proximaFecha(2, 10))).body.data;
    await cambiar(ana.token, t.idTurno, 'CANCELADO');
    await prisma.usuario.update({ where: { idUsuario: m.medico.idUsuario }, data: { activo: false } });

    assert.equal((await request(app).get('/api/turnos/agenda-medico').set(conToken(m.tokenMedico))).status, 403, 'el token vigente deja de servir');
    const mis = await request(app).get('/api/turnos/mis-turnos').set(conToken(ana.token));
    assert.equal(mis.status, 200);
    assert.ok(mis.body.data.some((x) => x.idTurno === t.idTurno), 'el turno histórico sigue apareciendo');
    const lista = await request(app).get('/api/medicos').set(conToken(ana.token));
    assert.ok(!lista.body.data.some((x) => x.idMedico === m.idMedico), 'y el médico no se ofrece para reservar');
  });

  test('un médico sin ninguna especialidad activa no recibe reservas (422)', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    await prisma.especialidad.update({ where: { idEspecialidad: m.especialidad.idEspecialidad }, data: { activo: false } });
    assert.equal((await reservar(ana.token, m.idMedico, proximaFecha(2, 10))).status, 422);
  });

  test('dar de baja una especialidad no borra los turnos que ya la usaban', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const t = (await reservar(ana.token, m.idMedico, proximaFecha(2, 10))).body.data;
    const tokenAdmin = await admin();
    const res = await request(app).delete(`/api/especialidades/${m.especialidad.idEspecialidad}`).set(conToken(tokenAdmin));
    assert.equal(res.status, 200);
    const mis = await request(app).get('/api/turnos/mis-turnos').set(conToken(ana.token));
    const turno = mis.body.data.find((x) => x.idTurno === t.idTurno);
    assert.equal(turno.especialidad.nombre, m.especialidad.nombre);
  });

  test('el listado público de médicos no ofrece especialidades dadas de baja', async () => {
    const m = await medicoConEspecialidad();
    const viva = await crearEspecialidad(`Viva-${Date.now()}`);
    await prisma.medico.update({ where: { idMedico: m.idMedico }, data: { especialidades: { connect: { idEspecialidad: viva.idEspecialidad } } } });
    await prisma.especialidad.update({ where: { idEspecialidad: m.especialidad.idEspecialidad }, data: { activo: false } });
    const ana = await paciente();
    const lista = await request(app).get('/api/medicos').set(conToken(ana.token));
    const publico = lista.body.data.find((x) => x.idMedico === m.idMedico);
    assert.deepEqual(publico.especialidades.map((e) => e.idEspecialidad), [viva.idEspecialidad]);
  });

  test('registrar una ausencia avisa cuántos turnos futuros quedan afectados', async () => {
    const m = await medicoConEspecialidad();
    const ana = await paciente();
    const fecha = proximaFecha(2, 10);
    await reservar(ana.token, m.idMedico, fecha);
    const dia = fecha.toISOString().slice(0, 10);
    const res = await request(app).post('/api/disponibilidad/ausencias').set(conToken(m.tokenMedico)).send({ fechaInicio: dia, fechaFin: dia });
    assert.equal(res.status, 201);
    assert.equal(res.body.turnosAfectados, 1);
  });
});
