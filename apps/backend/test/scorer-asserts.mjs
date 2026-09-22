import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  normalize,
  tokens,
  nameAffinity,
  metadataAffinity,
  amountFit,
  dateFit,
  rankCandidates,
  decideWithScores,
  SCORING_WEIGHTS,
  EMPTY_HISTORY,
} = require(resolve(here, '../dist/src/bll/disputes/dispute-scorer.js'));

/** Aserciones del scorer probabilistico (spec 020): modulo puro, sin base de datos. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const movement = (id, description, amount, date, note = null) => ({ id, description, note, amount, date });
const task = (title, description = null, notes = null, sectorName = null) => ({ title, description, notes, sectorName });

// ---------- normalizacion ----------
check(normalize('NETFLIX.COM') === 'netflix com', 'los puntos y mayusculas se normalizan');
check(normalize('Suscripcion anual') === 'suscripcion anual', 'los acentos se pliegan');
check(tokens('de la casa').length === 1, 'los tokens cortos son ruido');
check(nameAffinity('Netflix', 'NETFLIX.COM cargo mensual') === 1, 'el nombre coincide entero');
check(nameAffinity('Netflix', 'cargo de spotify') === 0, 'un nombre distinto no coincide');
check(nameAffinity('Personal Flow', 'personal flow abono') === 1, 'un nombre de dos palabras coincide entero');
check(nameAffinity('Personal Datos', 'personal flow abono') === 0.5, 'coincidencia parcial queda en el medio');

// ---------- metadata ----------
check(metadataAffinity(['mixtan218@gmail.com'], 'chatgpt plus mixtan218') === 1, 'el mail aparece en el movimiento');
check(metadataAffinity(['ChatGPT Plus - mixtan'], 'chatgpt plus mixtan218') === 1, 'la nota de la task encuentra al usuario');
check(metadataAffinity([null, null], 'cualquier cosa') === 0, 'sin metadata no hay senal');
check(metadataAffinity(['factura luz de edesur del local'], 'edesur factura') === 1, 'la nota del movimiento con el detalle coincide');

// ---------- monto y fecha ----------
check(amountFit(20, 20, EMPTY_HISTORY) === 1, 'el monto exacto encaja entero');
check(amountFit(19.6, 20, EMPTY_HISTORY) === 1, 'una conversion menor al 15% sigue encajando');
check(amountFit(30, 20, EMPTY_HISTORY) < 1 && amountFit(30, 20, EMPTY_HISTORY) > 0.5, 'un desvio moderado baja la senal');
check(amountFit(500, 20, EMPTY_HISTORY) === 0, 'un desvio enorme la lleva a cero', `${amountFit(500, 20, EMPTY_HISTORY)}`);
check(amountFit(24000, null, { averageDelayDays: 0, sampleCount: 3, lastAmounts: [23579, 24100] }) === 1, 'sin estimado se compara con el historico');
check(amountFit(1, null, EMPTY_HISTORY) === 0.5, 'sin estimado ni historico la senal es neutra');
check(dateFit('2026-09-20', '2026-09-20', { averageDelayDays: 0, sampleCount: 0, lastAmounts: [] }) === 0.5, 'el arranque en frio no decide por fecha');

const lateHistory = { averageDelayDays: 2.2, sampleCount: 7, lastAmounts: [20] };
check(dateFit('2026-09-22', '2026-09-20', lateHistory) === 1, 'la fecha aprendida es la que manda');
check(
  Math.abs(dateFit('2026-09-20', '2026-09-20', lateHistory) - (1 - 2 / 7)) < 0.001,
  'pagar en la fecha esperada puntua menos si la historia dice que paga tarde',
  `${dateFit('2026-09-20', '2026-09-20', lateHistory)}`,
);

// ---------- ranking y compuerta ----------
const ranked = rankCandidates(
  [movement('m1', 'NETFLIX.COM', 20, '2026-09-21'), movement('m2', 'spotify premium', 12, '2026-09-22')],
  task('Netflix'),
  20,
  '2026-09-20',
  EMPTY_HISTORY,
);
check(ranked[0].movementId === 'm1' && ranked[0].rank === 1, 'el candidato que coincide queda primero');
check(ranked[1].movementId === 'm2', 'el que no coincide queda segundo');
check(ranked[0].score > ranked[1].score, 'el puntaje separa a los candidatos');
check(
  Object.keys(ranked[0].signals).sort().join(',') === 'amount,date,metadata,name',
  'las senales viajan con el candidato',
  `${Object.keys(ranked[0].signals).join(',')}`,
);
check(ranked[0].score <= 100 && ranked[0].score > 0, 'el puntaje vive entre 0 y 100', `${ranked[0].score}`);

check(decideWithScores([ranked[0]], { enabled: false, minScore: 85, margin: 25 }).kind === 'consult', 'apagado por defecto todo es consulta');
const nearTie = [
  { movementId: 'a', score: 43, signals: {} },
  { movementId: 'b', score: 37, signals: {} },
];
check(decideWithScores(nearTie, { enabled: true, minScore: 40, margin: 25 }).kind === 'consult', 'un puntaje alto con diferencia minima igual consulta');
check(decideWithScores(nearTie, { enabled: true, minScore: 40, margin: 5 }).kind === 'auto-link', 'con margen suficiente y puntaje alto auto-vincula');
check(
  decideWithScores([{ movementId: 'a', score: 60, signals: {} }], { enabled: true, minScore: 85, margin: 25 }).kind === 'consult',
  'un candidato unico por debajo del umbral consulta',
);
check(
  decideWithScores([{ movementId: 'a', score: 92, signals: {} }], { enabled: true, minScore: 85, margin: 25 }).kind === 'auto-link',
  'un candidato unico por encima del umbral auto-vincula',
);

// ---------- el peso total sigue siendo 100 ----------
const totalWeight = Object.values(SCORING_WEIGHTS).reduce((total, value) => total + value, 0);
check(totalWeight === 100, 'los pesos suman 100', `${totalWeight}`);

console.log(failures === 0 ? '\nSCORER EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
