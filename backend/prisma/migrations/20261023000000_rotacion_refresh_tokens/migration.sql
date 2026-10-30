-- Rotación de refresh tokens con detección de reutilización.
-- Cambio ADITIVO (columnas nulas): el código anterior sigue funcionando con estas
-- columnas presentes, por eso la migración se aplica ANTES de desplegar el código nuevo.
--   jtiActual   : identificador del refresh token vigente de la sesión.
--   jtiAnterior : el inmediatamente anterior (se tolera unos segundos por si dos
--                 pestañas renuevan a la vez).
--   rotadaEn    : cuándo se rotó por última vez.
-- Las sesiones que ya existen quedan con jtiActual nulo y empiezan a rotar en su
-- próxima renovación.
--
-- IF NOT EXISTS: es seguro ejecutarla dos veces. Si alguien la corre a mano en el
-- editor SQL de Supabase, un `prisma migrate deploy` posterior no falla: la vuelve a
-- ejecutar sin efecto y recién ahí queda registrada en _prisma_migrations.
ALTER TABLE "Sesion"
  ADD COLUMN IF NOT EXISTS "jtiActual" TEXT,
  ADD COLUMN IF NOT EXISTS "jtiAnterior" TEXT,
  ADD COLUMN IF NOT EXISTS "rotadaEn" TIMESTAMP(3);
