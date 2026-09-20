# Registro: organizacion de tasks (spec 016)

- Spec: `.agents/memory/specs/016-tasks-organization.md`
- Rama: `feature/tasks-organization` (spec en `700f467`, implementacion en esta rama)
- Fecha de la verificacion: 2026-09-20
- Entorno: humo contra `pyrite_test` con el backend compilado en el puerto 30098; migracion
  0009 aplicada en `pyrite` y en `pyrite_test`.

## Que se construyo

- Migracion 0009: `groups.parent_id` (self-FK, `on delete set null`) con el swap de indices
  (`groups_domain_name_key` reemplazado por dos parciales, uno para raices y otro por nivel),
  la tabla `task_sectors`, los enums `task_priority` y `task_state`, y en `tasks` las columnas
  `description`, `priority`, `state`, `group_id`, `sector_id` y `linked_expectation_id`.
- DAL: `GroupsRepository` con arbol (hijos, ancestros y subarbol por CTE recursiva),
  `TaskSectorsRepository` (catalogo con reactivacion por nombre) y filtro por rama en
  `TasksRepository`.
- BLL: `GroupsService` ahora es un arbol por dominio con nombres unicos por nivel y rechazo
  de ciclos; `TasksService` resuelve la ficha (grupo, sector por id o por `sectorName`,
  prioridad, estado y vinculo) y filtra por rama delegando la resolucion del subarbol.
- Gateway: CRUD de grupos con padre, lectura del arbol, catalogo de sectores y los filtros
  `group` + `includeDescendants` en la lista de tasks.

## Verificacion

- `npm run tsc` limpio (backend y frontend) y `npm run build:backend` limpio.
- Humo de organizacion, 17 chequeos en verde (`temp/smoke-org2.mjs`): arbol de cuatro niveles,
  nombre repetido al mismo nivel (409) y permitido bajo otro padre, tarea asignada al
  subnivel con prioridad, estado, descripcion y sector creado al vuelo, filtro por rama con y
  sin descendientes, ciclo rechazado (400), limpieza de prioridad y estado con `null`,
  prioridad invalida (400), vinculo a la expectativa de otra tarea, expectativa inexistente
  (404), borrado de carpeta que no borra su tarea, lectura anidada del arbol y calendario
  respondiendo.
- Sin regresion de la 015: las 21 aserciones del motor y los 18 chequeos HTTP del humo de
  calendario siguen en verde.

## Correccion hecha durante la implementacion

La spec decia que el vinculo solo aceptaba una expectativa de la misma tarea. El caso real es
el opuesto: "renovar el dominio" apunta a la expectativa de la tarea de pago (otra tarea), asi
que la validacion es que la expectativa exista. Se corrigio la spec antes de commitear el
codigo y el comportamiento implementado es el segundo.

## Fuera de alcance

Fechas y horarios (017), pagos v2 (018), notificaciones (fronte futuro), la UI (#24) y el
board kanban, que es la vista del campo `state` y se construye con la UI.

## Notas del entorno

- `drizzle-kit migrate` volvio a fallar en silencio; la 0009 se aplico por psql en las dos
  bases, como documenta `errors/drizzle-kit-migrate-falla-silencioso`.
- El `DROP CONSTRAINT` de la migracion es un indice (no hay perdida de datos): se reemplaza
  por los dos indices parciales en la misma migracion, y las filas existentes de `groups`
  (apis, notes y counts) quedaron como raices sin cambios.
