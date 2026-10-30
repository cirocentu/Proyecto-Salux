-- ============================================================================
-- Preparación de Supabase para Salux (ejecutar UNA vez)
-- Dónde: Supabase > SQL Editor > New query  (se ejecuta como el usuario `postgres`)
--
-- Crea un rol propio para la aplicación en lugar de usar el superusuario
-- `postgres`: si alguna vez se filtrara la cadena de conexión de la app, el
-- daño queda limitado a la base de Salux (no puede crear roles, ni extensiones,
-- ni leer otros esquemas de la plataforma).
--
-- IMPORTANTE: cambiá 'CAMBIA_ESTA_CONTRASEÑA' por una contraseña larga y
-- aleatoria (solo letras y números, para no tener que escapar la URL).
-- ============================================================================

create role salux_app
  login
  password 'CAMBIA_ESTA_CONTRASEÑA'
  nosuperuser nocreatedb nocreaterole noinherit;

-- Supabase necesita que `postgres` pueda administrar el rol
grant salux_app to postgres;

-- La app crea sus tablas con las migraciones de Prisma: tiene que poder crear
-- objetos en el esquema public. Al ser su dueña, las tablas son suyas (y las
-- políticas de Row Level Security de la migración no la afectan).
grant usage, create on schema public to salux_app;

-- Verificación (debe devolver una fila con rolsuper = false):
select rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = 'salux_app';
