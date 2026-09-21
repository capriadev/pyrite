import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  windowOf,
  decide,
  deviationDays,
  amountDeviation,
  lateCandidate,
  unplanned,
} = require(resolve(here, '../dist/src/bll/disputes/dispute-matcher.js'));

/** Aserciones del matcher de disputas (spec 019): modulo puro, sin base de datos. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const CONFIG = { toleranceBefore: 3, toleranceAfter: 7, reviewThresholdPercent: 15 };
const expectation = (expectedOn, estimatedAmount = null) => ({
  id: 'e1',
  taskId: 't1',
  expectedOn,
  estimatedAmount,
});
const movement = (id, date, amount = 100, categoryId = 'c1') => ({ id, date, amount, categoryId });

// ---------- ventana dual ----------
check(windowOf('2026-09-20', CONFIG).from === '2026-09-17', 'la ventana arranca tres dias antes');
check(windowOf('2026-09-20', CONFIG).to === '2026-09-27', 'la ventana cierra siete dias despues');

// ---------- desvios ----------
check(deviationDays('2026-09-20', '2026-09-18') === -2, 'pagar antes da desvio negativo');
check(deviationDays('2026-09-20', '2026-09-22') === 2, 'pagar despues da desvio positivo');
check(amountDeviation(null, 500) === null, 'sin estimado no hay desvio de monto');
check(Math.round(amountDeviation(20, 15)) === -25, 'el desvio de monto se mide en porcentaje');

// ---------- un solo candidato: concilia ----------
const settled = decide(expectation('2026-09-20', 20), [movement('m1', '2026-09-21', 20)], new Set(), '2026-09-22', CONFIG);
check(settled.kind === 'settle' && settled.movementId === 'm1', 'un candidato unico concilia');
check(settled.amountDeviation === 0 && settled.reviewNote === null, 'sin desvio no deja nota');

const deviated = decide(expectation('2026-09-20', 20), [movement('m1', '2026-09-21', 15)], new Set(), '2026-09-22', CONFIG);
check(deviated.kind === 'settle' && String(deviated.reviewNote).includes('-25.00'), 'un desvio grande no invalida y deja nota');

const rotating = decide(expectation('2026-09-20'), [movement('m1', '2026-09-20', 23579)], new Set(), '2026-09-21', CONFIG);
check(rotating.kind === 'settle' && rotating.amountDeviation === null, 'el precio rotativo concilia sin comparar');

// ---------- dos candidatos: consulta ----------
const ambiguous = decide(
  expectation('2026-09-20', 10),
  [movement('m1', '2026-09-20', 10), movement('m2', '2026-09-21', 12)],
  new Set(),
  '2026-09-21',
  CONFIG,
);
check(ambiguous.kind === 'suggest' && ambiguous.movementIds.length === 2, 'dos candidatos abren consulta');

// ---------- consumo unico ----------
const consumed = decide(expectation('2026-09-20', 10), [movement('m1', '2026-09-20', 10)], new Set(['m1']), '2026-09-21', CONFIG);
check(consumed.kind === 'wait', 'un movimiento consumido no vuelve a usarse');

// ---------- ventana cerrada sin nada ----------
check(decide(expectation('2026-09-01'), [], new Set(), '2026-09-20', CONFIG).kind === 'missing', 'ventana cerrada y vacia es faltante');
check(decide(expectation('2026-09-20'), [], new Set(), '2026-09-22', CONFIG).kind === 'wait', 'ventana abierta y vacia espera');

// ---------- tardio ----------
const late = lateCandidate(expectation('2026-09-01'), [movement('m1', '2026-09-12', 15)], new Set(), '2026-09-20', '2026-09-20', CONFIG);
check(late?.id === 'm1', 'un pago posterior a la ventana es candidato tardio');
check(lateCandidate(expectation('2026-09-01'), [movement('m1', '2026-09-12', 15)], new Set(['m1']), '2026-09-20', '2026-09-20', CONFIG) === null, 'un movimiento consumido no es tardio');
check(lateCandidate(expectation('2026-09-01'), [movement('m1', '2026-09-19', 15)], new Set(), '2026-09-18', '2026-09-20', CONFIG) === null, 'pasando la ventana del cobro siguiente ya no es tardio');
check(lateCandidate(expectation('2026-09-01'), [movement('m1', '2026-09-25', 15)], new Set(), '2026-10-01', '2026-09-20', CONFIG) === null, 'un pago futuro no es tardio');

// ---------- no planificado ----------
const waiting = [{ expectation: expectation('2026-09-20'), categoryIds: ['c1'] }];
check(
  unplanned([movement('m1', '2026-09-20')], waiting, new Set(), new Set(), CONFIG).length === 0,
  'un movimiento cubierto por una espera no es no planificado',
);
check(
  unplanned([movement('m1', '2026-09-20')], [], new Set(), new Set(), CONFIG)[0] === 'm1',
  'sin nadie esperandolo es no planificado',
);
check(
  unplanned([movement('m1', '2026-09-20')], waiting, new Set(['m1']), new Set(), CONFIG).length === 0,
  'un movimiento consumido no es no planificado',
);
check(
  unplanned([movement('m1', '2026-09-20')], waiting, new Set(), new Set(['m1']), CONFIG).length === 0,
  'un movimiento ya reclamado por una disputa tardia no se repite',
);

console.log(failures === 0 ? '\nMATCHER EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
