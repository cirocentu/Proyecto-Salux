## Qué cambia y por qué

<!-- Una o dos frases. El "porqué" importa más que el "qué". Cerrá el issue si hay uno: Closes #123 -->

## Tipo de cambio

- [ ] Corrección de un error
- [ ] Funcionalidad nueva
- [ ] Documentación / pruebas / mantenimiento

## Cómo se probó

<!-- Pruebas automáticas agregadas y/o pasos manuales. Para un error: la prueba que fallaba antes y pasa ahora. -->

## Lista de verificación

- [ ] `npm run lint`, `npm test` y `npm run build` pasan
- [ ] `cd backend && npm test` pasa
- [ ] Si toca pantallas: `npm run test:a11y` pasa y lo probé con el teclado
- [ ] Si cambia una regla de negocio: actualicé `docs/REGLAS-DE-NEGOCIO.md`
- [ ] No hay secretos, `.env` ni datos reales de pacientes

## Base de datos (completar solo si hay migraciones)

- [ ] La migración es **aditiva** (el código viejo sigue andando con la base ya migrada)
- [ ] Orden de despliegue: **primero** `prisma migrate deploy` en producción, **después** el merge (ver `docs/DESPLIEGUE.md`)

## Riesgos y cosas a mirar en la revisión

<!-- Permisos, datos personales, concurrencia, compatibilidad. "Ninguno" también es una respuesta. -->
