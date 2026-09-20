import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30096;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: { ...process.env, BACKEND_PORT: String(PORT), LOG_LEVEL: 'error', DB_NAME: 'pyrite_test' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
let serverLog = '';
child.stdout.on('data', (c) => { serverLog += c.toString(); });

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok || res.status === 503) return true;
    } catch { /* todavia no escucha */ }
    await sleep(1000);
  }
  return false;
}

const monthly = { frequencyUnit: 'month', interval: 1, endsMode: 'never' };
const subscription = (payment, title) => request('POST', '/tasks', {
  title, type: 'pago', startsOn: '2026-10-31', recurrence: monthly, payment,
});
const firstCharge = async (id) => ((await request('GET', `/tasks/${id}/expectations`)).body ?? [])[0];

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  const month = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount: 1, trialUnit: 'month' }, 'Un mes de prueba');
  const monthFirst = await firstCharge(month.body?.id);
  check(month.status === 201, 'alta con prueba de un mes', `${month.status}`);
  check(monthFirst?.expectedOn === '2026-11-30', 'un mes cae en el ultimo dia de noviembre', `${monthFirst?.expectedOn}`);
  check(month.body?.payment?.trialCount === 1 && month.body?.payment?.trialUnit === 'month', 'la prueba quedo guardada con su unidad');

  const weeks = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount: 2, trialUnit: 'week' }, 'Dos semanas de prueba');
  check((await firstCharge(weeks.body?.id))?.expectedOn === '2026-11-14', 'dos semanas son catorce dias');

  const days = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount: 14, trialUnit: 'day' }, 'Catorce dias de prueba');
  check((await firstCharge(days.body?.id))?.expectedOn === '2026-11-14', 'catorce dias son catorce dias');

  const none = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount: 0, trialUnit: 'day' }, 'Sin prueba');
  check((await firstCharge(none.body?.id))?.expectedOn === '2026-10-31', 'sin prueba cobra el mismo dia');

  const legacy = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialDays: 14 }, 'Campo viejo');
  check(legacy.status === 400, 'el campo viejo trialDays da 400', `${legacy.status}`);
  check(String(legacy.body?.message ?? '').includes('trialCount'), 'el error nombra el reemplazo', `${legacy.body?.message}`);

  const badUnit = await subscription({ mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD', trialCount: 1, trialUnit: 'year' }, 'Unidad invalida');
  check(badUnit.status === 400, 'unidad de prueba invalida da 400', `${badUnit.status}`);

  const installments = await request('POST', '/tasks', {
    title: 'Cuotas con prueba', type: 'pago', startsOn: '2026-10-31', recurrence: monthly,
    payment: { mode: 'cuotas', priceFixed: true, priceAmount: '15000.00', priceCurrency: 'ARS', trialCount: 30, trialUnit: 'day', installmentsCount: 12 },
  });
  check((await firstCharge(installments.body?.id))?.expectedOn === '2026-10-31', 'las cuotas siguen ignorando la prueba');
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nPAGOS V2 EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
