import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, utimesSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30088;
const BASE = `http://127.0.0.1:${PORT}`;

/** Los logs se purgan en un directorio propio de la corrida: nunca los de verdad. */
const logDir = mkdtempSync(join(tmpdir(), 'pyrite-smoke-logs-'));

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: {
    ...process.env,
    BACKEND_PORT: String(PORT),
    DB_NAME: 'pyrite_test',
    LOG_DIR: logDir,
    LOG_LEVEL: 'error',
  },
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
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok || res.status === 503) return true;
    } catch { /* todavia no escucha */ }
    await sleep(1000);
  }
  return false;
}

const day = (offset) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};
const oldLog = (offset, suffix) => {
  const stamp = day(offset).toISOString().slice(0, 10).replace(/-/g, '');
  return `backend.${stamp}.${suffix}.log`;
};

try {
  // Archivos mucho mas viejos que cualquier retencion posible (el maximo aceptado son 3650 dias)
  // mas uno de hace cinco dias, que solo es candidato si la retencion se baja.
  for (const [offset, suffix] of [[-4000, '1'], [-3999, '2'], [-5, '1']]) {
    const path = join(logDir, oldLog(offset, suffix));
    writeFileSync(path, 'x'.repeat(200), 'utf8');
    const when = day(offset);
    utimesSync(path, when, when);
  }

  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  // ---------- el pase del boot queda registrado ----------
  const afterBoot = (await request('GET', '/logs/purges')).body ?? [];
  const boot = afterBoot.find((run) => run.origin === 'boot');
  check(Boolean(boot), 'el boot deja su corrida registrada', `${afterBoot.length} corridas`);
  check(boot?.files === 2, 'el boot borro los dos archivos vencidos de cualquier manera', `${boot?.files}`);
  check(boot?.bytes === 400, 'el boot midio los bytes liberados', `${boot?.bytes}`);
  check(boot?.dir === logDir, 'la corrida registra el directorio');

  const survivor = oldLog(-5, '1');
  check(readdirSync(logDir).includes(survivor), 'lo que esta dentro de la retencion sigue en disco');

  // ---------- settings: se dejan en los valores por defecto y se leen de vuelta ----------
  await request('POST', '/logs/settings', { retentionDays: 120, purgeIntervalHours: 24 });
  const settings = (await request('GET', '/logs/settings')).body;
  check(settings?.retentionDays === 120, 'la retencion por defecto es la de siempre', `${settings?.retentionDays}`);
  check(settings?.purgeIntervalHours === 24, 'el intervalo por defecto son 24 horas', `${settings?.purgeIntervalHours}`);

  const updated = await request('POST', '/logs/settings', { retentionDays: 30, purgeIntervalHours: 6 });
  check(updated.body?.retentionDays === 30 && updated.body?.purgeIntervalHours === 6, 'los settings se actualizan');
  const badDays = await request('POST', '/logs/settings', { retentionDays: 0 });
  const badHours = await request('POST', '/logs/settings', { purgeIntervalHours: -3 });
  check(badDays.status === 400, 'una retencion invalida da 400', `${badDays.status}`);
  check(badHours.status === 400, 'un intervalo invalido da 400', `${badHours.status}`);

  // ---------- con una retencion de 30 dias, el archivo de hace cinco no es candidato ----------
  const shortRetention = await request('POST', '/logs/purge');
  check(shortRetention.body?.origin === 'manual', 'el pase manual queda registrado como manual', `${shortRetention.body?.origin}`);
  check(shortRetention.body?.retentionDays === 30, 'usa la retencion configurada', `${shortRetention.body?.retentionDays}`);
  check(shortRetention.body?.files === 0, 'con 30 dias no borra el de hace cinco', `${shortRetention.body?.files}`);

  // ---------- el intervalo se mide contra la ultima corrida ----------
  await request('POST', '/logs/settings', { purgeIntervalHours: 8760 });
  const before = ((await request('GET', '/logs/purges')).body ?? []).length;
  await sleep(1200);
  const after = ((await request('GET', '/logs/purges')).body ?? []).length;
  check(after === before, 'con el intervalo lejos no corre ninguna pasada sola', `${before} -> ${after}`);

  // ---------- con la retencion en 1 dia, el de hace cinco ya corresponde ----------
  await request('POST', '/logs/settings', { retentionDays: 1 });
  const manual = await request('POST', '/logs/purge');
  check(manual.status === 201, 'el pase manual responde', `${manual.status}`);
  check(manual.body?.retentionDays === 1, 'toma la retencion nueva sin reiniciar', `${manual.body?.retentionDays}`);
  check(manual.body?.files === 1, 'ahora si borra el de hace cinco', `${manual.body?.files}`);
  check(!readdirSync(logDir).includes(survivor), 'ese archivo ya no esta');

  const history = (await request('GET', '/logs/purges?limit=2')).body ?? [];
  check(history.length === 2, 'el historial respeta el limite', `${history.length}`);
  check(new Date(history[0].startedAt) >= new Date(history[1].startedAt), 'el historial viene del mas nuevo al mas viejo');

  const summary = (await request('GET', '/logs/purges/summary')).body;
  check(summary?.runs >= 3, 'el resumen cuenta las corridas', `${summary?.runs}`);
  check(summary?.files >= 3 && summary?.bytes >= 600, 'el resumen acumula archivos y bytes', `${summary?.files}/${summary?.bytes}`);

  // El motor queda como estaba para la proxima corrida.
  await request('POST', '/logs/settings', { retentionDays: 120, purgeIntervalHours: 24 });
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
  rmSync(logDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nPURGE DE LOGS EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
