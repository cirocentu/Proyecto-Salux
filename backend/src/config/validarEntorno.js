// Revisa la configuración al arrancar. Los `errores` impiden iniciar el
// servidor (mejor no levantar que levantar inseguro); los `avisos` se loguean.
function validarEntorno(env = process.env) {
  const errores = [];
  const avisos = [];
  const produccion = env.NODE_ENV === 'production';

  const esPlaceholder = (valor) => /GENERA|CAMBIA|changeme/i.test(valor || '');

  for (const nombre of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const valor = env[nombre];
    if (!valor) errores.push(`Falta ${nombre}`);
    else if (valor.length < 32 || esPlaceholder(valor)) {
      errores.push(`${nombre} es demasiado corto (mínimo 32 caracteres) o es un valor de ejemplo`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    errores.push('JWT_SECRET y JWT_REFRESH_SECRET tienen que ser distintos');
  }
  if (!env.DATABASE_URL) errores.push('Falta DATABASE_URL');

  if (produccion) {
    // La app no debería conectarse con el superusuario de la base
    if (/^postgres(ql)?:\/\/postgres[.:@]/i.test(env.DATABASE_URL || '')) {
      avisos.push('DATABASE_URL usa el usuario "postgres" (superusuario): conviene un rol propio de la app (ver docs/DESPLIEGUE.md)');
    }
    if (!/^postgres(ql)?:\/\//i.test(env.DATABASE_URL || '')) {
      errores.push('DATABASE_URL tiene que ser una conexión PostgreSQL (postgresql://...)');
    }
    const origenes = (env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (origenes.length === 0) errores.push('Falta CORS_ORIGIN (URL del frontend)');
    else if (origenes.some((o) => !o.startsWith('https://'))) {
      errores.push('CORS_ORIGIN debe usar https:// en producción');
    }
    if (!/^\d+$/.test(env.TRUST_PROXY || '') || Number(env.TRUST_PROXY) < 1) {
      errores.push('Falta TRUST_PROXY (cantidad de proxies delante del servidor): sin él no se puede detectar HTTPS ni la IP real');
    }
    if (env.REQUIERE_VERIFICACION_EMAIL !== 'true') {
      avisos.push('REQUIERE_VERIFICACION_EMAIL no es "true": el registro revela qué emails/DNI ya existen');
    }
    if (!env.SMTP_HOST) avisos.push('SMTP no configurado: no saldrán los emails (reseteo de contraseña, verificación, turnos)');
    if (!env.REDIS_URL && env.RATE_LIMIT_STORE !== 'db') {
      avisos.push('Sin REDIS_URL ni RATE_LIMIT_STORE=db: los límites de intentos son por instancia y no sirven en serverless');
    }
    if (env.VERCEL && !env.CRON_SECRET) {
      avisos.push('Falta CRON_SECRET: la tarea diaria de mantenimiento (/api/cron/mantenimiento) queda deshabilitada');
    }
  }

  return { errores, avisos };
}

module.exports = { validarEntorno };
