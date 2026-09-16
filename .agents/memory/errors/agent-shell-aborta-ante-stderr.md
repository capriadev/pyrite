# El shell del agente aborta el comando cuando un nativo escribe a stderr

## Summary
`git`, `gh`, `ssh` y `curl` escriben mensajes normales a stderr; el wrapper del shell del agente lo interpreta como fallo y corta el comando aunque la accion haya terminado bien.

## Context
Aparece en cada sesion del agente en Windows, con cualquier comando nativo de esos cuatro: `git status`, `git log`, `git push`, `gh pr create`, `ssh`, `curl`. El sintoma es salida vacia o parcial y `[Command exited with code 1]`, aunque el efecto real si ocurrio (un push remoto hecho y reportado como error, por ejemplo). Es un falso negativo del reporte, no de la accion.

## Solution
1. Envolver el comando nativo en `cmd /c "..."` (o en un `.cmd` dentro de `temp/` si es largo).
2. Antes de reintentar, comprobar el efecto real (`git log`, `git status`, `gh pr list`): el corte suele ser del reporte.
3. Nada de comillas escapadas (`\"`) dentro del comando: PowerShell las rompe y ademas come los parentesis (un scope convencional como `docs(specs)` en un mensaje de commit se interpreta como codigo). Para textos largos, escribir un archivo y usar `git commit -F <archivo>` / `gh pr create --body-file <archivo>`.
4. Secuencias con `&&`: van dentro de la MISMA cadena de `cmd /c`, no encadenando dos `cmd /c` en PowerShell.
5. `for` y expresiones con parentesis en `node -e` tampoco sobreviven: usar un `.mjs` en `temp/`.

## Tags
<agente> <windows> <shell> <git> <gh> <entorno>
