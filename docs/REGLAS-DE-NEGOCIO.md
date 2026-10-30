# Reglas de negocio de los turnos

Referencia de lo que el sistema permite y rechaza, con el código HTTP que devuelve la API. Cada regla tiene su prueba automática: si cambiás una, tiene que cambiar su prueba y esta tabla.

Pruebas: `backend/test/integration/turnos.test.js` (reglas base) y `backend/test/integration/negocio.test.js` (casos límite y simultaneidad).

## Reservar un turno

| Regla | Respuesta |
|---|---|
| Solo un paciente (con perfil de paciente) puede reservar | 404 si el usuario no tiene perfil de paciente |
| La fecha es un ISO válido, **a minuto exacto** (sin segundos), **futura** y **a no más de un año** | 400 |
| El médico existe y está **activo** | 404 / 422 |
| El médico tiene **al menos una especialidad activa** | 422 |
| Si se indica especialidad, tiene que ser una que el médico atiende y siga activa | 400 |
| Si el médico cargó disponibilidad semanal, el turno entra **completo** en una franja (hora de Argentina). Sin franjas cargadas no hay restricción | 422 |
| El día no cae en una **ausencia** del médico (el día se cuenta en hora de Argentina) | 422 |
| El médico no tiene otro turno vivo que se **superponga** (cada turno ocupa la duración del médico) | 409 |
| El paciente no tiene otro turno vivo que se superponga, **ni siquiera con otro médico** (cada turno ocupa la duración de su médico) | 409 |

"Se superponen" significa que cada uno empieza antes de que el otro termine. Terminar justo cuando empieza el otro **no** es superponerse: 10:00–10:30 y 10:30–11:00 conviven. Un turno cancelado libera su horario.

Dos pedidos simultáneos que se pisan nunca entran los dos: entra uno y el otro recibe 409.

## Cambiar el estado

Estados: `PENDIENTE` → `CONFIRMADO` → `FINALIZADO`, y `CANCELADO`. Los dos últimos son finales.

| Quién | Puede |
|---|---|
| Paciente dueño | Solo **cancelar** su turno |
| Médico dueño | Confirmar, finalizar y cancelar |
| Administrador | Lo mismo que el médico, sobre cualquier turno |
| Cualquier otro | 403 |

| Regla | Respuesta |
|---|---|
| Un turno `FINALIZADO` o `CANCELADO` no admite cambios | 422 |
| No se puede pasar al estado en que ya está | 422 |
| No se **finaliza** un turno que todavía no ocurrió | 422 |
| No se **confirma** un turno cuyo horario ya pasó | 422 |
| Si otro pedido cambió el turno en el mismo instante (ej: lo cancelan mientras se finaliza), el segundo no pisa al primero | 409 |
| Id con letras, decimales, notación científica o fuera de rango | 400 |

## Reprogramar y confirmar asistencia (solo el paciente dueño)

| Regla | Respuesta |
|---|---|
| Se aplican **todas** las reglas de reservar al nuevo horario (sin chocar contra sí mismo) | 409 / 422 |
| El turno vuelve a `PENDIENTE` y pierde la confirmación del paciente | — |
| No se reprograma un turno `FINALIZADO` o `CANCELADO` | 422 |
| No se reprograma ni se confirma la asistencia a un turno **cuyo horario ya pasó** | 422 |
| Si lo cancelaron en el medio, no se "revive" | 409 |

## Vencimiento automático

La tarea de mantenimiento cancela los turnos que siguen `PENDIENTE` cuando llega su horario (nadie los confirmó) y libera el horario. Los `CONFIRMADO` vencidos no se tocan: los cierra el médico con "Finalizar".

## Médicos

| Regla | Respuesta |
|---|---|
| Desactivar a un médico **con turnos futuros** sin cerrar pide confirmación | 409 con la cantidad (`turnosFuturos`) |
| Con `cancelarTurnosFuturos: true` se desactiva, se **cancelan** esos turnos y cada paciente recibe un correo | 200 con `turnosCancelados` |
| El historial (turnos finalizados o cancelados) no se toca | — |
| Un médico desactivado pierde el acceso al instante, no se ofrece para reservar, y su historial sigue visible para los pacientes | 403 |
| No se puede cambiar la **duración del turno** mientras el médico tenga turnos futuros vivos (si no, un turno de 60 min pasaría a ocupar 30 y se podría reservar encima) | 409 |
| La duración va de 5 a 240 minutos | 400 |

## Especialidades

- Dar de baja una especialidad es **lógico**: los turnos que ya la usaban la conservan, y los médicos la siguen teniendo en su lista (el panel de administración la marca como "inactiva").
- Una especialidad dada de baja no se ofrece para reservar ni aparece en el listado público de cada médico. Un médico cuyas especialidades están **todas** dadas de baja no se ofrece.
- "Crear" una especialidad que estaba dada de baja la **reactiva**, con sus médicos.
- Los nombres son únicos sin distinguir mayúsculas.

## Disponibilidad y ausencias (solo el médico dueño)

- Las franjas semanales del mismo día **no pueden superponerse** (409) y la de fin tiene que ser posterior a la de inicio.
- Una **ausencia** bloquea el día completo (hora de Argentina) para nuevas reservas. Las fechas deben existir en el calendario (`2027-02-31` da 400) y el fin no puede ser anterior al inicio.
- Crear una ausencia o borrar una franja **no cancela** los turnos ya reservados: la respuesta de la ausencia informa cuántos quedaron en conflicto (`turnosAfectados`) para que el médico los resuelva.
