import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30099;
const BASE = `http://127.0.0.1:${PORT}`;
const DAY = 86400000;
const iso = (date) => date.toISOString().slice(0, 10);
const today = new Date();
const inDays = (days) => iso(new Date(today.getTime() + days * DAY));

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

const expectations = async (id) => {
  const res = await request('GET', `/tasks/${id}/expectations`);
  return Array.isArray(res.body) ? res.body : [];
};

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

try {
  check(await waitForHealth(), 'el backend arranca y responde /health');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  const sub = await request('POST', '/tasks', {
    title: 'Netflix', type: 'pago', startsOn: iso(today), recurrence: monthly,
    payment: { mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD', trialCount: 14, trialUnit: 'day' },
  });
  const subId = sub.body?.id;
  const subRows = await expectations(subId);
  check(sub.status === 201 && Boolean(subId), 'alta de suscripcion USD con prueba', `${sub.status}`);
  check(subRows[0]?.expectedOn === inDays(14), 'primer cobro = inicio + 14 dias', `${subRows[0]?.expectedOn}`);
  check(subRows[0]?.estimatedAmount === '20.00' && subRows[0]?.currency === 'USD', 'precio fijo USD persistido');
  check(subRows.length === 12, 'doce cobros en el horizonte', `${subRows.length}`);

  const cuotas = await request('POST', '/tasks', {
    title: 'Notebook en 12 cuotas', type: 'pago', startsOn: inDays(5), recurrence: monthly,
    payment: { mode: 'cuotas', priceFixed: true, priceAmount: '15000.00', priceCurrency: 'ARS', trialCount: 30, trialUnit: 'day', installmentsCount: 12 },
  });
  const cuotaRows = await expectations(cuotas.body?.id);
  check(cuotaRows.length === 12, 'cuotas genera exactamente 12', `${cuotaRows.length}`);
  check(cuotaRows[0]?.expectedOn === inDays(5), 'cuotas ignora la prueba');

  const birthday = await request('POST', '/tasks', {
    title: 'Cumple de X', type: 'recurrente', startsOn: inDays(30),
    recurrence: { frequencyUnit: 'year', interval: 1, endsMode: 'never' },
  });
  const birthdayRows = await expectations(birthday.body?.id);
  check(birthdayRows.length === 1 && birthdayRows[0]?.estimatedAmount === null, 'cumple anual: una aparicion, sin monto');

  const utility = await request('POST', '/tasks', {
    title: 'Luz', type: 'pago', startsOn: inDays(3), recurrence: monthly,
    payment: { mode: 'recurrente', priceFixed: false, trialCount: 0, trialUnit: 'day' },
  });
  const utilityRows = await expectations(utility.body?.id);
  check(utilityRows.length > 0 && utilityRows.every((r) => r.estimatedAmount === null), 'servicio variable: monto nulo siempre');

  const calendar = await request('GET', `/calendar?from=${iso(today)}&to=${inDays(31)}`);
  const days = Array.isArray(calendar.body) ? calendar.body : [];
  const titles = days.flatMap((d) => d.entries.map((e) => e.title));
  check(calendar.status === 200 && days.length > 0, 'calendario devuelve dias con entradas', `${days.length}`);
  check(titles.includes('Netflix') && titles.includes('Luz') && titles.includes('Notebook en 12 cuotas'), 'la vista trae las tareas del rango');

  const pass1 = await request('POST', '/tasks/materialize');
  const pass2 = await request('POST', '/tasks/materialize');
  check(pass1.status < 300 && pass2.body?.created === 0, 'materialize idempotente', `creadas=${pass2.body?.created}`);

  const edited = await request('PUT', `/tasks/${subId}`, {
    title: 'Netflix',
    payment: { mode: 'recurrente', priceFixed: true, priceAmount: '25.00', priceCurrency: 'USD', trialCount: 14, trialUnit: 'day' },
  });
  const afterEdit = await expectations(subId);
  check(edited.body?.payment?.priceAmount === '25.00', 'edicion del precio', `${edited.status}`);
  check(afterEdit.length === subRows.length, 'la edicion no duplica', `antes=${subRows.length} despues=${afterEdit.length}`);
  check(afterEdit[0]?.estimatedAmount === '25.00', 'el futuro se rehace con el precio nuevo');

  const removed = await request('DELETE', `/tasks/${subId}`);
  const listed = (await request('GET', '/tasks')).body ?? [];
  check(removed.status === 200 && !listed.some((t) => t.id === subId), 'borrado suave: sale de la lista');
  check((await expectations(subId)).length === 0, 'la tarea borrada pierde el futuro');

  const bad = await request('POST', '/tasks', { title: 'x', type: 'pago', startsOn: iso(today) });
  check(bad.status === 400, 'pago sin payload responde 400', `${bad.status}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nHUMO HTTP EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
