# editor: old_text de una sola linea (el reemplazo multilinea falla en silencio)

## Summary
En este entorno la herramienta de edicion solo casa `old_text` de UNA linea; con `old_text` multilinea responde "No replacement performed: text not found" aunque el texto exista.

## Context
Al intentar editar cualquier archivo del repo con un bloque de varias lineas como `old_text` (por ejemplo el cuerpo de un metodo o una constante de 4 lineas), la edicion falla siempre, tanto con finales `\n` como `\r\n`. Los archivos del repo son CRLF con BOM, asi que la hipotesis de los finales de linea solo hace perder tiempo: la causa es que el matching multilinea no funciona.

Lo que SI funciona:
- `old_text` de una sola linea, siempre (aunque no sea unica: en ese caso el error es "multiple occurrences", que es otra cosa y avisa claro).
- `new_text` multilinea, sin problema.
- Crear un archivo nuevo con `new_text` (sin `old_text`).
- Insertar con `insert_line`.

## Solution
1. Para cambios puntuales: `old_text` de una sola linea + `new_text` multilinea (asentar el ancla en una linea unica cerca del punto; si hay duplicados, anclar en el encabezado del metodo).
2. Para reescribir un archivo entero: crear `<archivo>.next` con la herramienta (trozos de ~100 lineas con `insert_line` al final) y luego reemplazar con `Copy-Item -Force <archivo>.next <archivo>`. Avisar al usuario: el contenido previo queda recuperable en git.
3. Para reescribir por terminal: `[System.IO.File]::WriteAllLines/AppendAllLines` con `[string[]]@(...)` (el cast es obligatorio: con `@(...)` sin cast falla "no overload for AppendAllLines with 3 arguments"). Comillas simples de PowerShell con comillas simples duplicadas para el TS; NO usar comillas dobles (los backticks de los template literals y `$` se comen). Para CRLF dentro de una cadena de comillas simples: `$nl=[string]([char]13)+[string]([char]10)`.
4. Verificar siempre con `npx tsc -p apps/backend/tsconfig.json --noEmit` y, si toca el wire, con un `NestFactory.createApplicationContext(AppModule)` que arranca y termina solo (valida DI real sin levantar puerto).
5. Ojo con el auto-indent: al insertar bloques JSDoc el editor a veces los sangra de mas; revisar y normalizar con `[System.IO.File]::ReadAllText` + `Replace`.

## Tags
<agente> <entorno> <editor> <powershell> <ts> <windows>