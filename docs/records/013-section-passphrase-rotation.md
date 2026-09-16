- Spec: `.agents/memory/specs/013-section-passphrase-rotation.md`
- PR: #17 (merge 9412bd3)
- Fecha de la verificacion: 2026-09-15
- Entorno: `pyrite_test`, sembrada con 30 notas, 8 claves API y 4 cuentas con 8 filas de historial cada una.

# Registro: rotacion de passphrase por seccion (spec 013)

## Mediciones

| Seccion | Unidades | Staging a done |
|---|---|---|
| vault | 0 (inline, sin staging) | 339 ms |
| notes | 25 | 400 ms |
| notes_private | 5 | 503 ms |
| apis | 8 | 1704 ms |
| counts | 12 (4 cuentas + 8 filas de historial, KDF pesado) | 6262 ms |

Reanudaciones despues de un corte: 3413 ms y 4319 ms.

## Hallazgos

- Corte duro a mitad del staging (5/12 y 3/12): las filas preparadas sobreviven, tras el reinicio el job se lee como `interrupted` con una linea en el log y la reanudacion reutiliza el mismo jobId.
- Passphrase vieja 401; reveal e historial 403. Con la passphrase nueva: list, reveal e historial se leen todos.
- Durante el staging una escritura a esa seccion responde 409 y una lectura responde 200 (otra seccion sigue escribible); cancel responde 200 con discarded y deja los datos vivos intactos.
- Conteos de filas por tabla identicos antes y despues; `rotation_jobs` y `rotation_staging` quedan vacias.

## Defectos encontrados y corregidos en la misma pasada

- 32abd3d: el apply inline y cancel respondian 201 en lugar de 200.
- 021ff7f: el progreso de un job reanudado se acumulaba, no era por pasada.
