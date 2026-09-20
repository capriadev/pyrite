# Registro: calendario y tasks con motor de recurrencia (spec 015)

- Spec: `.agents/memory/specs/015-calendar-core.md`
- Rama: `feature/calendar-core` (commits `f4ae023` spec, `a198532` backend)
- Fecha de la verificacion: 2026-09-16
- Entorno: humo contra `pyrite_test` con el backend compilado en el puerto 30099; la
  migracion 0008 se aplico tambien a la base de desarrollo.

## Que se construyo

- Migracion 0008, puramente aditiva: `tasks`, `task_recurrence`, `task_price_tiers`,
  `task_payments` y `task_expectations`, con los enums de tipo, estado, frecuencia, fin,
  modalidad y estado de expectativa.
- DAL `TasksRepository`: CRUD, upserts de regla y payload, swap de tramos transaccional,
  agregados en tres queries y expectativas idempotentes por (tarea, fecha).
- BLL: `RecurrenceEngine` (puro, sin DI ni reloj), `TasksService` (validacion de frontera,
  edicion que solo rehace el futuro, soft delete y materializacion rodante) y
  `CalendarService` (vista por dia sobre expectativas y puntuales).
- Gateway: `/tasks` (CRUD, `/tasks/materialize`, `/tasks/:id/expectations`) y
  `/calendar?from=&to=`.
- `isUuid` se extrajo a `types/guards.ts` al aparecer el segundo consumidor.

## Verificacion

Estatica:

- `npm run tsc` limpio (backend y frontend) y `npm run build:backend` limpio.
- 21 aserciones del motor sobre los casos de la spec, todas en verde
  (`apps/backend/test/engine-asserts.mjs`).

Humo HTTP, 18 chequeos en verde (`apps/backend/test/smoke-015-calendar.mjs` levanta el backend compilado, corre los
casos y lo apaga):

- Suscripcion USD con precio fijo y prueba de 14 dias: 201, primer cobro en inicio + 14,
  monto y moneda persistidos y 12 cobros en el horizonte.
- Cuotas: exactamente 12 expectativas y sin desplazamiento por prueba.
- Cumpleanos anual: una aparicion en el ano y sin monto.
- Servicio variable sin precio: todas las expectativas con monto nulo.
- `/calendar` del mes: dias con entradas y las tres tareas del rango presentes.
- `/tasks/materialize` dos veces: la segunda pasada crea cero.
- Edicion del precio: el futuro se rehace con el valor nuevo y el conteo no cambia.
- Borrado suave: sale de la lista y pierde el futuro.
- Frontera: una tarea de pago sin payload responde 400.

## Notas

- `drizzle-kit migrate` volvio a fallar en silencio (exit 1 sin aplicar), como documenta
  `errors/drizzle-kit-migrate-falla-silencioso`: la 0008 se aplico con psql dentro del
  contenedor, en `pyrite` y en `pyrite_test`.
- Los dos primeros intentos del humo fallaron por expectativas del propio test, no por
  defectos: drizzle devuelve los campos en camelCase (`expectedOn`, `estimatedAmount`), y
  una serie de 12 cuotas mensuales que arranca tarde no entra completa en el horizonte de
  365 dias (genera 11, que es lo correcto).

## Fuera de alcance (frente de UI)

Vista de calendario, pantalla de tasks, panel de excepciones y graficas de finances.
