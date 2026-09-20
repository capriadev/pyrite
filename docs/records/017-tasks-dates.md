# Registro: fechas y horarios de tasks (spec 017)

- Spec: `.agents/memory/specs/017-tasks-dates.md`
- Rama: `feature/tasks-dates` (spec en `bee46ec`, implementacion en esta rama)
- Fecha de la verificacion: 2026-09-20
- Entorno: humo contra `pyrite_test` con el backend compilado en el puerto 30097; migracion
  0010 aplicada en `pyrite` y en `pyrite_test`.

## Que se construyo

- Migracion 0010, aditiva: tablas `task_dates` (rango, hora, hora de fin y etiqueta por
  entrada) y `task_weekdays` (dias seleccionados con hora propia), el enum `leap_day_mode` y
  su columna en `task_recurrence`, el horario unico de la serie en la misma tabla, y
  `scheduled_time`, `time_to` y `label` en `task_expectations`.
- Motor: la puntual se expande desde sus entradas (un rango se ve dia por dia y varias
  entradas son el formato multiple, cada una con su hora y etiqueta); la semanal con dias
  seleccionados emite esos dias dentro de cada paso de semana, anclado a la semana de inicio;
  la anual resuelve el 29 de febrero con el switch (`feb28` se queda en el mes, `mar01` pasa
  al 1 de marzo); y la hora viaja a la expectativa en todos los casos (global en las series,
  por dia en la semanal).
- `starts_on` se deriva de la entrada mas temprana cuando la puntual trae fechas, y sigue
  siendo un dato de entrada en el resto.
- El calendario expone `scheduledTime`, `timeTo` y `label` en cada entrada.

## Verificacion

- `npm run tsc` limpio (backend y frontend) y `npm run build:backend` limpio.
- Motor: **30 aserciones en verde** (las 21 de la 015 mas 9 nuevas de la 017) sobre puntual
  multiple, rango, semanal con dos dias, hora global heredada, bisemanal anclada y los dos
  modos del 29 de febrero.
- Humo de fechas y horarios: **15 chequeos en verde** (`temp/smoke-dates2.mjs`): tres fechas
  exactas con hora y etiqueta, rango visto dia por dia, semanal con hora por dia, bisemanal,
  29 de febrero en febrero y en marzo, el calendario mostrando hora y etiqueta, y 400 para
  hora invalida, dia de semana invalido y rango invertido.
- Sin regresion: humo de organizacion (17 chequeos) y humo de calendario (18 chequeos) en
  verde, con las 21 aserciones originales del motor intactas.

## Notas

- Los dos primeros fallos de la verificacion fueron de mis pruebas, no del motor: use fechas
  anteriores a hoy (la ventana filtra desde el dia actual) y espere `null` en un dia sin hora
  propia cuando el motor hereda la hora global, que es lo documentado.
- `drizzle-kit migrate` volvio a fallar en silencio; la 0010 se aplico por psql en las dos
  bases.
- El humo de organizacion se volvio idempotente (nombres con sufijo por corrida): la base de
  prueba acumula y la carpeta raiz ya existia, lo que daba un 409 falso.

## Fuera de alcance

Notificaciones y recordatorios (feature #27), que es donde el switch y la hora previa al
inicio van a tener consumidor; pagos v2 (018) y toda la UI (#24).
