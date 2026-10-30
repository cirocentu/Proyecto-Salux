-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'FINALIZADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "idUsuario" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "nomYape" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "debeCambiarContrasena" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificado" BOOLEAN NOT NULL DEFAULT true,
    "verificacionToken" TEXT,
    "verificacionExpira" TIMESTAMP(3),
    "resetPasswordToken" TEXT,
    "resetPasswordExpira" TIMESTAMP(3),

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("idUsuario")
);

-- CreateTable
CREATE TABLE "Sesion" (
    "idSesion" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("idSesion")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "idPaciente" SERIAL NOT NULL,
    "obraSocial" TEXT,
    "telefono" TEXT,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("idPaciente")
);

-- CreateTable
CREATE TABLE "Medico" (
    "idMedico" SERIAL NOT NULL,
    "matricula" TEXT NOT NULL,
    "consultorio" TEXT,
    "duracionTurnoMinutos" INTEGER NOT NULL DEFAULT 30,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Medico_pkey" PRIMARY KEY ("idMedico")
);

-- CreateTable
CREATE TABLE "AusenciaMedico" (
    "idAusencia" SERIAL NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "medicoId" INTEGER NOT NULL,

    CONSTRAINT "AusenciaMedico_pkey" PRIMARY KEY ("idAusencia")
);

-- CreateTable
CREATE TABLE "Disponibilidad" (
    "idDisponibilidad" SERIAL NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicioMinutos" INTEGER NOT NULL,
    "horaFinMinutos" INTEGER NOT NULL,
    "medicoId" INTEGER NOT NULL,

    CONSTRAINT "Disponibilidad_pkey" PRIMARY KEY ("idDisponibilidad")
);

-- CreateTable
CREATE TABLE "Administrador" (
    "idAdmin" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Administrador_pkey" PRIMARY KEY ("idAdmin")
);

-- CreateTable
CREATE TABLE "Especialidad" (
    "idEspecialidad" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Especialidad_pkey" PRIMARY KEY ("idEspecialidad")
);

-- CreateTable
CREATE TABLE "Turno" (
    "idTurno" SERIAL NOT NULL,
    "fechaYhora" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'PENDIENTE',
    "confirmadoPorPaciente" BOOLEAN NOT NULL DEFAULT false,
    "pacienteId" INTEGER NOT NULL,
    "medicoId" INTEGER NOT NULL,
    "especialidadId" INTEGER,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("idTurno")
);

-- CreateTable
CREATE TABLE "_EspecialidadToMedico" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_dni_key" ON "Usuario"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_verificacionToken_key" ON "Usuario"("verificacionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_resetPasswordToken_key" ON "Usuario"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_idx" ON "Sesion"("usuarioId");

-- CreateIndex
CREATE INDEX "Sesion_expiraEn_idx" ON "Sesion"("expiraEn");

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_usuarioId_key" ON "Paciente"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Medico_matricula_key" ON "Medico"("matricula");

-- CreateIndex
CREATE UNIQUE INDEX "Medico_usuarioId_key" ON "Medico"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Disponibilidad_medicoId_diaSemana_horaInicioMinutos_key" ON "Disponibilidad"("medicoId", "diaSemana", "horaInicioMinutos");

-- CreateIndex
CREATE UNIQUE INDEX "Administrador_usuarioId_key" ON "Administrador"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Especialidad_nombre_key" ON "Especialidad"("nombre");

-- CreateIndex
CREATE INDEX "Turno_medicoId_idx" ON "Turno"("medicoId");

-- CreateIndex
CREATE INDEX "Turno_pacienteId_idx" ON "Turno"("pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "_EspecialidadToMedico_AB_unique" ON "_EspecialidadToMedico"("A", "B");

-- CreateIndex
CREATE INDEX "_EspecialidadToMedico_B_index" ON "_EspecialidadToMedico"("B");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medico" ADD CONSTRAINT "Medico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AusenciaMedico" ADD CONSTRAINT "AusenciaMedico_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "Medico"("idMedico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disponibilidad" ADD CONSTRAINT "Disponibilidad_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "Medico"("idMedico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administrador" ADD CONSTRAINT "Administrador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("idPaciente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "Medico"("idMedico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"("idEspecialidad") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EspecialidadToMedico" ADD CONSTRAINT "_EspecialidadToMedico_A_fkey" FOREIGN KEY ("A") REFERENCES "Especialidad"("idEspecialidad") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EspecialidadToMedico" ADD CONSTRAINT "_EspecialidadToMedico_B_fkey" FOREIGN KEY ("B") REFERENCES "Medico"("idMedico") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Unicidad de horario SOLO entre turnos activos (no cancelados).
-- Un turno cancelado libera su horario; Prisma no puede expresar índices
-- parciales en el schema, por eso van acá.
-- ============================================================================
CREATE UNIQUE INDEX "Turno_medicoId_fechaYhora_activo_key"
  ON "Turno"("medicoId", "fechaYhora") WHERE "estado" <> 'CANCELADO';
CREATE UNIQUE INDEX "Turno_pacienteId_fechaYhora_activo_key"
  ON "Turno"("pacienteId", "fechaYhora") WHERE "estado" <> 'CANCELADO';

-- ============================================================================
-- Seguridad en Supabase: la plataforma expone automáticamente las tablas del
-- esquema `public` por una API REST (PostgREST) usable con la clave pública
-- ("anon key", que cualquiera puede ver en un navegador). Esta app NO usa esa
-- API (accede con Prisma por conexión directa), así que se cierra del todo:
--   1) Row Level Security activado, sin ninguna política => nadie que entre por
--      esa API puede leer ni escribir. El dueño de las tablas (el rol con el que
--      conecta Prisma) no se ve afectado.
--   2) Se quitan los permisos de los roles públicos de la API (si existen).
-- En un PostgreSQL común (Docker local) los roles anon/authenticated no existen
-- y esa parte simplemente se omite.
-- ============================================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
