import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { occurrencesOf } = require(resolve(here, '../dist/src/bll/tasks/recurrence-engine.js'));

const TODAY = '2026-09-16';
const HORIZON = '2027-09-16';

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      esperado ${JSON.stringify(expected)}\n      obtenido ${JSON.stringify(actual)}`);
}

function task(overrides) {
  return {
    id: 'task-1',
    title: 'test',
    icon: null,
    type: 'pago',
    status: 'active',
    notes: null,
    startsOn: TODAY,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function aggregate({ task: taskRow, recurrence = null, payment = null, tiers = [], dates = [], weekdays = [] }) {
  return { task: task(taskRow), recurrence, payment, tiers, dates, weekdays };
}

const monthly = { taskId: 'task-1', frequencyUnit: 'month', interval: 1, endsMode: 'never', endsOn: null, occurrencesCount: null, leapDayMode: 'feb28', time: null, timeTo: null };

// 1. Puntual: una sola aparicion, sin monto.
{
  const agg = aggregate({ task: { type: 'puntual', startsOn: '2026-09-20' } });
  check('puntual aparece su dia', occurrencesOf(agg, TODAY, HORIZON).map((o) => o.expectedOn), ['2026-09-20']);
  check('puntual sin precio no inventa monto', occurrencesOf(agg, TODAY, HORIZON)[0].estimatedAmount, null);
}

// 2. Cumpleanos anual: una aparicion por ano dentro de la ventana.
{
  const agg = aggregate({
    task: { type: 'recurrente', startsOn: '2026-12-05' },
    recurrence: { ...monthly, frequencyUnit: 'year' },
  });
  check('cumple anual genera una por ano', occurrencesOf(agg, TODAY, '2027-12-31').map((o) => o.expectedOn), ['2026-12-05', '2027-12-05']);
  check('fuera del horizonte no genera', occurrencesOf(agg, TODAY, HORIZON).map((o) => o.expectedOn), ['2026-12-05']);
}

// 3. Suscripcion USD fija con prueba de 14 dias: primer cobro desplazado, monto estable.
{
  const agg = aggregate({
    task: { type: 'pago', startsOn: '2026-09-20' },
    recurrence: monthly,
    payment: { taskId: 'task-1', mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD', trialCount: 14, trialUnit: 'day', installmentsCount: null },
  });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('prueba de 14 dias desplaza el primer cobro', result[0].expectedOn, '2026-10-04');
  check('precio fijo USD se mantiene', [result[0].estimatedAmount, result[0].currency], ['20.00', 'USD']);
  check('el segundo cobro es un mes despues', result[1].expectedOn, '2026-11-04');
}

// 4. Finito: termina tras N cobros.
{
  const agg = aggregate({
    task: { type: 'recurrente', startsOn: '2026-10-01' },
    recurrence: { ...monthly, endsMode: 'after_count', occurrencesCount: 3 },
  });
  check('after_count corta en 3', occurrencesOf(agg, TODAY, HORIZON).length, 3);
}

// 5. Cuotas: 12 cuotas de monto fijo, sin prueba.
{
  const agg = aggregate({
    task: { type: 'pago', startsOn: '2026-10-01' },
    recurrence: monthly,
    payment: { taskId: 'task-1', mode: 'cuotas', priceFixed: true, priceAmount: '15000.00', priceCurrency: 'ARS', trialCount: 30, trialUnit: 'day', installmentsCount: 12 },
  });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('cuotas genera 12', result.length, 12);
  check('cuotas ignora la prueba', result[0].expectedOn, '2026-10-01');
  check('cuotas de monto fijo', result[11].estimatedAmount, '15000.00');
}

// 6. Tramos: promo los dos primeros cobros, precio regular desde el tercero.
{
  const agg = aggregate({
    task: { type: 'pago', startsOn: '2026-10-01' },
    recurrence: monthly,
    payment: { taskId: 'task-1', mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS', trialCount: 0, trialUnit: 'day', installmentsCount: null },
    tiers: [
      { id: 't1', taskId: 'task-1', position: 1, amount: '1000.00', currency: 'ARS', appliesFromOccurrence: 1 },
      { id: 't2', taskId: 'task-1', position: 2, amount: '2500.00', currency: 'ARS', appliesFromOccurrence: 3 },
    ],
  });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('promo en los dos primeros cobros', [result[0].estimatedAmount, result[1].estimatedAmount], ['1000.00', '1000.00']);
  check('precio regular desde el tercero', result[2].estimatedAmount, '2500.00');
  check('el tramo viaja con la expectativa', [result[0].tierPosition, result[2].tierPosition], [1, 2]);
}

// 7. Servicio variable: expectativa solo-fecha, sin monto inventado.
{
  const agg = aggregate({
    task: { type: 'pago', startsOn: '2026-09-20' },
    recurrence: monthly,
    payment: { taskId: 'task-1', mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS', trialCount: 0, trialUnit: 'day', installmentsCount: null },
  });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('variable sin precio: monto nulo', result[0].estimatedAmount, null);
  check('variable sin precio: sin moneda', result[0].currency, null);
  check('variable igual genera fechas', result.length, 12);
  check('la serie mensual respeta el horizonte', result[11].expectedOn, '2027-08-20');
}

// 8. Borrada: no genera nada.
{
  const agg = aggregate({ task: { type: 'pago', startsOn: '2026-10-01', status: 'deleted' }, recurrence: monthly });
  check('tarea borrada no materializa', occurrencesOf(agg, TODAY, HORIZON).length, 0);
}

// 9. La ventana no reescribe el pasado.
{
  const agg = aggregate({ task: { type: 'recurrente', startsOn: '2026-01-10' }, recurrence: monthly });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('la ventana arranca en hoy', result[0].expectedOn >= TODAY, true);
  check('la ventana respeta el horizonte', result[result.length - 1].expectedOn <= HORIZON, true);
}

// 017: puntual multiple y rango.
{
  const agg = aggregate({
    task: { type: 'puntual', startsOn: '2026-09-10' },
    dates: [
      { id: 'd1', taskId: 'task-1', date: '2026-09-25', dateTo: null, time: '08:00', timeTo: null, label: 'con Nico' },
      { id: 'd2', taskId: 'task-1', date: '2026-09-27', dateTo: null, time: null, timeTo: null, label: null },
      { id: 'd3', taskId: 'task-1', date: '2026-10-05', dateTo: null, time: '19:30', timeTo: '22:00', label: 'cine' },
    ],
  });
  const result = occurrencesOf(agg, TODAY, HORIZON);
  check('puntual multiple: tres dias exactos', result.map((o) => o.expectedOn), ['2026-09-25', '2026-09-27', '2026-10-05']);
  check('hora y etiqueta de la entrada viajan', [result[0].scheduledTime, result[0].label], ['08:00', 'con Nico']);
  check('rango horario y etiqueta viajan', [result[2].timeTo, result[2].label], ['22:00', 'cine']);
}

{
  const agg = aggregate({
    task: { type: 'puntual', startsOn: '2026-10-01' },
    dates: [{ id: 'd1', taskId: 'task-1', date: '2026-10-01', dateTo: '2026-10-04', time: '09:00', timeTo: null, label: null }],
  });
  check('el rango se ve cada dia', occurrencesOf(agg, TODAY, HORIZON).map((o) => o.expectedOn), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
}

// 017: semanal con dias seleccionables y hora por dia.
{
  const weekly = { taskId: 'task-1', frequencyUnit: 'week', interval: 1, endsMode: 'never', endsOn: null, occurrencesCount: null, leapDayMode: 'feb28', time: null, timeTo: null };
  const agg = aggregate({
    task: { type: 'recurrente', startsOn: '2026-09-21' },
    recurrence: weekly,
    weekdays: [
      { id: 'w1', taskId: 'task-1', weekday: 1, time: '08:00', timeTo: null },
      { id: 'w2', taskId: 'task-1', weekday: 3, time: null, timeTo: null },
    ],
  });
  const result = occurrencesOf(agg, '2026-09-21', '2026-10-04');
  check('semanal con dos dias seleccionados', result.map((o) => o.expectedOn), ['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30']);
  check('la unica hora actua de global', [result[0].scheduledTime, result[1].scheduledTime], ['08:00', '08:00']);
}

// 017: cada dos semanas, anclado al inicio.
{
  const biweekly = { taskId: 'task-1', frequencyUnit: 'week', interval: 2, endsMode: 'never', endsOn: null, occurrencesCount: null, leapDayMode: 'feb28', time: null, timeTo: null };
  const agg = aggregate({
    task: { type: 'recurrente', startsOn: '2026-09-21' },
    recurrence: biweekly,
    weekdays: [{ id: 'w1', taskId: 'task-1', weekday: 1, time: null, timeTo: null }],
  });
  check('una semana si y otra no', occurrencesOf(agg, '2026-09-21', '2026-10-18').map((o) => o.expectedOn), ['2026-09-21', '2026-10-05']);
}

// 017: 29 de febrero segun el switch.
{
  const yearly = (mode) => ({ taskId: 'task-1', frequencyUnit: 'year', interval: 1, endsMode: 'never', endsOn: null, occurrencesCount: null, leapDayMode: mode, time: null, timeTo: null });
  const clamp = aggregate({ task: { type: 'recurrente', startsOn: '2024-02-29' }, recurrence: yearly('feb28') });
  const shift = aggregate({ task: { type: 'recurrente', startsOn: '2024-02-29' }, recurrence: yearly('mar01') });
  check('29 de febrero en febrero', occurrencesOf(clamp, '2024-01-01', '2027-12-31').map((o) => o.expectedOn), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
  check('29 de febrero en marzo', occurrencesOf(shift, '2024-01-01', '2027-12-31').map((o) => o.expectedOn), ['2024-02-29', '2025-03-01', '2026-03-01', '2027-03-01']);
}

// 018: la prueba gratuita se mide en su unidad.
{
  const withTrial = (trialCount, trialUnit) => aggregate({
    task: { type: 'pago', startsOn: '2026-10-31' },
    recurrence: monthly,
    payment: { taskId: 'task-1', mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount, trialUnit, installmentsCount: null },
  });
  check('prueba de 2 semanas corre 14 dias', occurrencesOf(withTrial(2, 'week'), TODAY, HORIZON)[0].expectedOn, '2026-11-14');
  check('prueba de 1 mes cae en el ultimo dia del mes', occurrencesOf(withTrial(1, 'month'), TODAY, HORIZON)[0].expectedOn, '2026-11-30');
  check('prueba de 0 cobra el mismo dia', occurrencesOf(withTrial(0, 'day'), TODAY, HORIZON)[0].expectedOn, '2026-10-31');
  check('prueba de 3 dias', occurrencesOf(withTrial(3, 'day'), TODAY, HORIZON)[0].expectedOn, '2026-11-03');
}

console.log(failures === 0 ? '\nTODOS LOS CASOS PASAN' : `\n${failures} caso(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
