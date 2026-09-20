import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30097;
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

const expectations = async (id) => (await request('GET', `/tasks/${id}/expectations`)).body ?? [];
const days = (rows) => rows.map((row) => row.expectedOn);

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  const multiple = await request('POST', '/tasks', {
    title: 'Turnos medicos', type: 'puntual',
    dates: [
      { date: '2026-09-25', time: '08:00', label: 'con Nico' },
      { date: '2026-09-27' },
      { date: '2026-10-05', time: '19:30', timeTo: '22:00', label: 'cine' },
    ],
  });
  const rows = await expectations(multiple.body?.id);
  check(multiple.status === 201, 'alta de puntual multiple', `${multiple.status}`);
  check(days(rows).join(',') === '2026-09-25,2026-09-27,2026-10-05', 'tres dias exactos', days(rows).join(','));
  check(rows[0]?.scheduledTime === '08:00' && rows[0]?.label === 'con Nico', 'hora y etiqueta viajan');
  check(rows[2]?.timeTo === '22:00' && rows[2]?.label === 'cine', 'rango horario y etiqueta viajan');

  const range = await request('POST', '/tasks', {
    title: 'Congreso', type: 'puntual',
    dates: [{ date: '2026-10-10', dateTo: '2026-10-13', time: '09:00' }],
  });
  check(days(await expectations(range.body?.id)).join(',') === '2026-10-10,2026-10-11,2026-10-12,2026-10-13', 'el rango se ve cada dia');

  const weekly = await request('POST', '/tasks', {
    title: 'Gimnasio', type: 'recurrente', startsOn: '2026-09-21',
    recurrence: {
      frequencyUnit: 'week', interval: 1, endsMode: 'never',
      weekdays: [{ weekday: 1, time: '07:00' }, { weekday: 3, time: '19:00' }],
    },
  });
  const weeklyRows = await expectations(weekly.body?.id);
  check(days(weeklyRows).slice(0, 4).join(',') === '2026-09-21,2026-09-23,2026-09-28,2026-09-30', 'semanal con dos dias', days(weeklyRows).slice(0, 4).join(','));
  check(weeklyRows[0]?.scheduledTime === '07:00' && weeklyRows[1]?.scheduledTime === '19:00', 'hora por dia');

  const biweekly = await request('POST', '/tasks', {
    title: 'Kinesiologia', type: 'recurrente', startsOn: '2026-09-21',
    recurrence: { frequencyUnit: 'week', interval: 2, endsMode: 'never', weekdays: [{ weekday: 1, time: '10:00' }] },
  });
  check(days(await expectations(biweekly.body?.id)).slice(0, 2).join(',') === '2026-09-21,2026-10-05', 'una semana si y otra no');

  const clamp = await request('POST', '/tasks', {
    title: 'Aniversario', type: 'recurrente', startsOn: '2024-02-29',
    recurrence: { frequencyUnit: 'year', interval: 1, endsMode: 'never', leapDayMode: 'feb28' },
  });
  const shift = await request('POST', '/tasks', {
    title: 'Aniversario 2', type: 'recurrente', startsOn: '2024-02-29',
    recurrence: { frequencyUnit: 'year', interval: 1, endsMode: 'never', leapDayMode: 'mar01' },
  });
  check((await expectations(clamp.body?.id)).some((row) => row.expectedOn === '2027-02-28'), '29 de febrero cae en febrero');
  check((await expectations(shift.body?.id)).some((row) => row.expectedOn === '2027-03-01'), '29 de febrero cae en marzo');

  const calendar = await request('GET', '/calendar?from=2026-09-25&to=2026-09-27');
  const entries = (calendar.body ?? []).flatMap((day) => day.entries);
  const labelled = entries.find((entry) => entry.label === 'con Nico');
  check(Boolean(labelled) && labelled.scheduledTime === '08:00', 'el calendario trae hora y etiqueta');

  const badTime = await request('POST', '/tasks', { title: 'x', type: 'puntual', dates: [{ date: '2026-09-25', time: '25:99' }] });
  const badWeekday = await request('POST', '/tasks', { title: 'x', type: 'recurrente', startsOn: '2026-09-21', recurrence: { frequencyUnit: 'week', weekdays: [{ weekday: 9 }] } });
  const badRange = await request('POST', '/tasks', { title: 'x', type: 'puntual', dates: [{ date: '2026-10-05', dateTo: '2026-10-01' }] });
  check(badTime.status === 400, 'hora invalida da 400', `${badTime.status}`);
  check(badWeekday.status === 400, 'dia de semana invalido da 400', `${badWeekday.status}`);
  check(badRange.status === 400, 'rango invertido da 400', `${badRange.status}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nFECHAS Y HORARIOS EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
