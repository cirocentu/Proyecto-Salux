# Documentación de Salux

Índice de todo lo que hay documentado. Si no sabés por dónde empezar, seguí este orden.

## Para entender el proyecto
| Documento | Qué vas a encontrar |
|---|---|
| [`../README.md`](../README.md) | Qué es Salux, qué resuelve cada rol y cómo empezar |
| [`ARQUITECTURA.md`](ARQUITECTURA.md) | Componentes, modelo de datos, estados de un turno y flujo de una reserva |
| [`REGLAS-DE-NEGOCIO.md`](REGLAS-DE-NEGOCIO.md) | Qué permite y qué rechaza el sistema, con el código HTTP de cada regla |

## Para trabajar en el código
| Documento | Qué vas a encontrar |
|---|---|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Ramas, commits, pull requests, migraciones y qué significa "terminado" |
| [`../backend/README.md`](../backend/README.md) | La API: configuración, Docker, pruebas, variables de entorno y seguridad |

## Para publicar y operar
| Documento | Qué vas a encontrar |
|---|---|
| [`DESPLIEGUE.md`](DESPLIEGUE.md) | Publicar en Supabase + Vercel + Brevo, secretos, respaldos y checklist de plataformas |
| [`../backend/scripts/respaldo/README.md`](../backend/scripts/respaldo/README.md) | Respaldos cifrados de la base y cómo restaurarlos |

## Seguridad
| Documento | Qué vas a encontrar |
|---|---|
| [`../SECURITY.md`](../SECURITY.md) | Cómo reportar una vulnerabilidad, medidas implementadas y riesgos aceptados |

## Convención
Los documentos están en español y se mantienen junto con el código: una regla de negocio nueva se agrega a `REGLAS-DE-NEGOCIO.md` en el mismo pull request. Hay una prueba automática (`backend/test/unit/documentacion.test.js`) que falla si un enlace de la documentación apunta a algo que no existe.
