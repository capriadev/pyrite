# Finances balance drift engine

## Summary
Un motor que recalcula el saldo de cada `balance_key` desde los movimientos activos y reporta el
desfase contra el balance almacenado (feature #31 del indice, descartada antes de implementarse).

## What was tried
Analisis completo del modelo: `balances` se acumula por deltas (`getBalance` + `setBalance`), los
movimientos guardan `paidAmount` en la moneda real del balance, y existe `POST /finances/balances`
que fija el saldo a mano. Se evaluaron dos caminos: registrar cada ajuste manual como un ancla
(`balance_anchors` con la suma del ledger en ese momento) para separar anclaje de desincronizacion,
o una auditoria simple de "almacenado vs suma" sin anclas.

## Why it was discarded
El desvio no es un error en este sistema: los rendimientos de billeteras virtuales y el conteo real
de efectivo + virtual hacen que el saldo **deba** moverse por fuera del ledger. Un motor que reporte
"el balance no coincide con la suma de movimientos" avisaria todos los meses por algo esperado, o
sea ruido: no aporta informacion util. El diagnostico que se buscaba (`/logs` enseña que el valor
esta en lo que se puede accionar) no existe aca: la accion del usuario ya es el ajuste manual.

## Alternative chosen
Ninguna: el ajuste manual sigue siendo la herramienta, sin registro adicional.

## Recorded for later
El analisis destapo un defecto real e independiente del motor: `createMovement` hace
`getBalance` -> suma -> `setBalance`, un read-modify-write **no atomico**, asi que dos escrituras
simultaneas leen el mismo saldo y una pisa a la otra (se pierde un delta). No es deteccion de
desvio, es correctitud, y se corrige con un update atomico (`amount = amount + delta`). Entra en la
spec de refactor de acoplamientos (025).

Aparte, el usuario anoto una mejora posible mas grande: soporte de multiples entradas en finances
(registrar varios movimientos en una operacion), que se resolveria con cola FIFO u optimistic
locking (`version` + compare-and-swap). Registrada como feature pendiente, no es parte del fix.

## Tags
<finance> <architecture> <discarded>
