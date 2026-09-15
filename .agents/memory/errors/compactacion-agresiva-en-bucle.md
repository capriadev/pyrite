# Compactacion agresiva en bucle (el agente relee en lugar de avanzar)

## Summary
Cuando el contexto inyectado crece, cada lectura dispara una compactacion que borra los resultados de herramientas recien leidos; el agente entonces vuelve a leer lo mismo y entra en un ciclo que no produce codigo y consume cuota.

## Context
Aparece en sesiones largas: el bloque inyectado por el entorno (env, config del workspace, instrucciones de Plan/Act, esquemas de herramientas, catalogo de skills y las notas de compactaciones previas) va sumando. Sintomas, en orden:
- El umbral de compactacion se vuelve cada vez mas bajo (de ~400k a <100k y de ahi a 10k).
- El historial muestra que se pierden los resultados de herramientas: `[migration] Tool result missing...`.
- El agente relee los mismos archivos y ejecuta los mismos greps una y otra vez, y las respuestas dicen "corto el bucle" sin escribirlo.
- Se deja basura de volcados (`temp/*.txt`, `*.md`) en cada vuelta, que al releerse agrava el problema.

## Solution
1. Bajar el ruido inyectado: desinstalar skills que no se usen (el catalogo completo se inyecta siempre), y cerrar tareas viejas del chat.
2. Regla dura de turno: **leer una vez y escribir en el MISMO turno**. Ninguna lectura cuyo resultado no se use inmediatamente para una edicion.
3. Una sola lectura por turno, de archivos chicos; para lo grande, grep de declaraciones (firmas) en vez del cuerpo.
4. El estado vive en disco (git), no en la memoria del agente: commitear por etapa y usar `git --no-pager log --oneline` para saber donde se esta.
5. No volcar contratos a `temp/` para "sobrevivir a la compactacion": leer esos volcados es justo lo que dispara la siguiente compactacion.
6. Respuestas cortas a proposito: hablar tambien llena contexto.
7. Si aun asi reaparece: cerrar la tarea y continuar en una nueva (el contexto arranca limpio).

## Tags
<agente> <entorno> <compactacion> <cuota> <metodologia>