const prisma = require('../config/prisma');

// Contadores con vencimiento guardados en la tabla "RateLimitContador" (la misma que
// usan los límites de intentos). Sirven para cualquier "no más de N cosas por
// ventana de tiempo" y funcionan en serverless, donde no hay memoria compartida.
// Un upsert atómico por llamada: no hay carreras entre peticiones simultáneas.

// Suma 1 al contador `clave` y devuelve cuántos van en la ventana actual. Si la
// ventana anterior ya venció, arranca una nueva desde 1.
async function incrementar(clave, ventanaMs) {
  const segundos = ventanaMs / 1000;
  const filas = await prisma.$queryRaw`
    INSERT INTO "RateLimitContador" ("clave", "hits", "expiraEn")
    VALUES (${clave}, 1, NOW() + make_interval(secs => ${segundos}::double precision))
    ON CONFLICT ("clave") DO UPDATE SET
      "hits" = CASE WHEN "RateLimitContador"."expiraEn" < NOW() THEN 1 ELSE "RateLimitContador"."hits" + 1 END,
      "expiraEn" = CASE WHEN "RateLimitContador"."expiraEn" < NOW()
                        THEN NOW() + make_interval(secs => ${segundos}::double precision)
                        ELSE "RateLimitContador"."expiraEn" END
    RETURNING "hits"`;
  return Number(filas[0].hits);
}

// Cuántos lleva el contador en su ventana vigente, sin sumar (0 si no existe o venció).
async function leer(clave) {
  const filas = await prisma.$queryRaw`
    SELECT "hits" FROM "RateLimitContador" WHERE "clave" = ${clave} AND "expiraEn" >= NOW()`;
  return filas.length ? Number(filas[0].hits) : 0;
}

// Borra el contador (por ejemplo, tras un inicio de sesión exitoso).
async function reiniciar(clave) {
  await prisma.rateLimitContador.deleteMany({ where: { clave } });
}

module.exports = { incrementar, leer, reiniciar };
