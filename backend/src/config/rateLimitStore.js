const { createClient } = require('redis');

// Los contadores de los límites de intentos se guardan en memoria por defecto:
// se pierden al reiniciar y NO se comparten entre varias instancias del
// backend (cada una contaría por su lado y el límite real sería N veces más
// laxo). Con REDIS_URL configurado se guardan en Redis y valen para todas.

let cliente = null;

function obtenerClienteRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!cliente) {
    cliente = createClient({ url: process.env.REDIS_URL });
    cliente.on('error', (error) => console.error('[redis] ', error.message));
    cliente.connect().catch((error) => console.error('[redis] No se pudo conectar:', error.message));
  }
  return cliente;
}

// Store mínimo para express-rate-limit (INCR + expiración por ventana).
class RedisRateLimitStore {
  constructor(client, prefijo) {
    this.client = client;
    this.prefijo = `rl:${prefijo}:`;
    // express-rate-limit no debe compartir un store entre limiters distintos
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const clave = this.prefijo + key;
    const [totalHits, ttl] = await this.client.multi().incr(clave).pTTL(clave).exec();
    let restanteMs = Number(ttl);
    if (Number(totalHits) === 1 || restanteMs < 0) {
      await this.client.pExpire(clave, this.windowMs);
      restanteMs = this.windowMs;
    }
    return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + restanteMs) };
  }

  async decrement(key) {
    await this.client.decr(this.prefijo + key);
  }

  async resetKey(key) {
    await this.client.del(this.prefijo + key);
  }
}

// Store en la base de datos (Postgres): un upsert atómico por petición. Sirve
// donde no hay Redis ni memoria compartida (Vercel). Cuesta un viaje a la base
// por petición limitada.
class DbRateLimitStore {
  constructor(prefijo) {
    this.prefijo = `${prefijo}:`;
    this.prisma = require('./prisma');
  }

  init(options) {
    this.windowSegundos = options.windowMs / 1000;
  }

  async increment(key) {
    const clave = this.prefijo + key;
    const filas = await this.prisma.$queryRaw`
      INSERT INTO "RateLimitContador" ("clave", "hits", "expiraEn")
      VALUES (${clave}, 1, NOW() + make_interval(secs => ${this.windowSegundos}::double precision))
      ON CONFLICT ("clave") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitContador"."expiraEn" < NOW() THEN 1 ELSE "RateLimitContador"."hits" + 1 END,
        "expiraEn" = CASE WHEN "RateLimitContador"."expiraEn" < NOW()
                          THEN NOW() + make_interval(secs => ${this.windowSegundos}::double precision)
                          ELSE "RateLimitContador"."expiraEn" END
      RETURNING "hits", "expiraEn"`;
    return { totalHits: Number(filas[0].hits), resetTime: new Date(filas[0].expiraEn) };
  }

  async decrement(key) {
    await this.prisma.$executeRaw`
      UPDATE "RateLimitContador" SET "hits" = GREATEST("hits" - 1, 0) WHERE "clave" = ${this.prefijo + key}`;
  }

  async resetKey(key) {
    await this.prisma.$executeRaw`DELETE FROM "RateLimitContador" WHERE "clave" = ${this.prefijo + key}`;
  }
}

// Devuelve las opciones de store para un limiter: {} (memoria, el default de
// express-rate-limit) o el store de Redis con un prefijo propio. Si Redis se
// cae, el limiter deja pasar las peticiones (y lo loguea) en vez de tumbar la API.
function opcionesDeStore(prefijo) {
  const client = obtenerClienteRedis();
  if (client) return { store: new RedisRateLimitStore(client, prefijo), passOnStoreError: true };
  // RATE_LIMIT_STORE=db: contadores en Postgres, compartidos por todas las instancias.
  // Incluye el límite GENERAL de la API ('api'): cuesta un upsert por petición, pero en
  // serverless es lo único que lo hace efectivo. Si ese costo fuera un problema se puede
  // dejar en memoria con API_RATE_LIMIT_MEMORIA=true (a costa de que no limite entre instancias).
  if (process.env.RATE_LIMIT_STORE === 'db' && !(prefijo === 'api' && process.env.API_RATE_LIMIT_MEMORIA === 'true')) {
    return { store: new DbRateLimitStore(prefijo), passOnStoreError: true };
  }
  return {};
}

module.exports = { opcionesDeStore };
