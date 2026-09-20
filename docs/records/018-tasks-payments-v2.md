# Registro: pagos v2, la prueba con unidad (spec 018)

- Spec: `.agents/memory/specs/018-tasks-payments-v2.md`
- Rama: `feature/tasks-payments-v2` (spec en `664d2ff`, implementacion en esta rama)
- Fecha de la verificacion: 2026-09-20
- Entorno: humo contra `pyrite_test` con el backend compilado en el puerto 30096; migracion
  0011 aplicada en `pyrite_test` y en `pyrite` con confirmacion explicita.

## Que se construyo

- Migracion 0011 (escrita a mano, porque drizzle no puede distinguir un renombre de un
  alta mas baja sin preguntar, y el shell no tiene TTY): el enum `trial_unit`, las columnas
  `trial_count` y `trial_unit` en `task_payments`, el movimiento de los valores existentes
  (`UPDATE task_payments SET trial_count = trial_days`) y recien despues el
  `DROP COLUMN trial_days`.
- Motor: `firstChargeDay` suma la prueba en su unidad. Un mes pasa por la aritmetica
  calendario que ya recorta al ultimo dia del mes destino (un cobro del 31 de octubre con un
  mes de prueba cae el 30 de noviembre, no en diciembre), y una semana son siete dias.
- API: `payment.trialCount` y `payment.trialUnit` reemplazan a `trialDays`; enviar el campo
  viejo responde 400 nombrando el reemplazo, para que un cliente viejo falle fuerte y no cobre
  en el dia equivocado.

## Verificacion

- `npm run tsc` limpio (backend y frontend) y `npm run build:backend` limpio.
- **Conversion de datos antes y despues**: la base de prueba tenia 17 filas con 220 dias
  sumados (maximo 30 por fila) antes de migrar, y despues tiene las mismas 17 filas con 220 de
  `trial_count` y las 17 en unidad `day`; `trial_days` ya no figura en las columnas de la
  tabla. La base de desarrollo tenia 0 filas.
- Motor: **34 aserciones en verde** (las 30 anteriores mas 4 nuevas: dos semanas, un mes que
  recorta al ultimo dia, cero y tres dias).
- Humo de pagos v2: **11 chequeos en verde** (`temp/smoke-payments2.mjs`): un mes de prueba
  cayendo el 30 de noviembre, dos semanas y catorce dias llegando al mismo dia, sin prueba
  cobrando el mismo dia, el campo viejo devolviendo 400 con el reemplazo nombrado, unidad
  invalida con 400 y las cuotas ignorando la prueba como antes.
- Sin regresion: calendario 18/18, organizacion 17/17 y fechas y horarios 15/15.

## Notas

- Los verificadores (motor y humo de la 015) usaban el campo viejo `trialDays`; se
  actualizaron a `trialCount` mas `trialUnit`, que es lo que hace que los 34 casos sigan
  corriendo contra la API nueva.
- El campo `trialDays` no se acepta como alias a proposito: la UI todavia no existe, asi que
  el costo de un error explicito hoy es cero y evita un dia de cobro mal calculado manana.

## Alcance del payload (recordado para el frente de UI)

El resto del payload de pago no necesito nada nuevo: "cuotas o fija" del modal mapea al modo
`cuotas` con `installmentsCount` (serie finita) y a `fija` (pago unico); el caso de la promo
que se convierte en precio regular es la secuencia de `task_price_tiers` de la 015; y el
precio rotativo es `priceFixed` en falso, con finance llenando el monto real.
