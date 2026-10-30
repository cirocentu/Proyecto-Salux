-- CreateTable
CREATE TABLE "RateLimitContador" (
    "clave" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitContador_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "RateLimitContador_expiraEn_idx" ON "RateLimitContador"("expiraEn");

-- Misma política de seguridad que el resto de las tablas: ninguna política RLS
-- = inaccesible por la API REST pública de Supabase (el dueño no se ve afectado).
ALTER TABLE "RateLimitContador" ENABLE ROW LEVEL SECURITY;

-- "Cardiologia" y "cardiologia" son la misma especialidad: PostgreSQL distingue
-- mayúsculas, así que la unicidad se hace sobre lower(nombre).
CREATE UNIQUE INDEX "Especialidad_nombre_lower_key" ON "Especialidad"(lower("nombre"));
