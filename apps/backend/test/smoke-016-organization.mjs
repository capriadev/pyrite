import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30098;
const BASE = `http://127.0.0.1:${PORT}`;
const iso = (date) => date.toISOString().slice(0, 10);
const today = new Date();
/** Sufijo por corrida: la base de prueba acumula y los nombres deben ser unicos. */
const tag = Date.now().toString(36).slice(-5);

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

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  const root = await request('POST', '/tasks/groups', { name: `freelancer-${tag}` });
  const clientes = await request('POST', '/tasks/groups', { name: 'clientes', parentId: root.body?.id });
  const clienteX = await request('POST', '/tasks/groups', { name: 'cliente-x', parentId: clientes.body?.id });
  const proyectoX = await request('POST', '/tasks/groups', { name: 'proyecto-x', parentId: clienteX.body?.id });
  check([root, clientes, clienteX, proyectoX].every((r) => r.status === 201), 'arbol de cuatro niveles', `${root.status}/${clientes.status}/${clienteX.status}/${proyectoX.status}`);

  const duplicate = await request('POST', '/tasks/groups', { name: `freelancer-${tag}` });
  const work = await request('POST', '/tasks/groups', { name: `work-${tag}` });
  const clientes2 = await request('POST', '/tasks/groups', { name: 'clientes', parentId: work.body?.id });
  check(duplicate.status === 409, 'repetido en el mismo nivel da 409', `${duplicate.status}`);
  check(clientes2.status === 201, 'el mismo nombre bajo otro padre se acepta', `${clientes2.status}`);

  const task = await request('POST', '/tasks', {
    title: 'Landing del cliente', type: 'puntual', startsOn: iso(today), groupId: proyectoX.body?.id,
    priority: 'alta', state: 'en_progreso', description: 'armar la landing', sectorName: 'cliente',
  });
  check(task.status === 201 && task.body?.groupId === proyectoX.body?.id, 'tarea asignada al subnivel');
  check(task.body?.priority === 'alta' && task.body?.state === 'en_progreso', 'prioridad y estado guardados');
  check(task.body?.description === 'armar la landing', 'descripcion guardada');
  const sectors = await request('GET', '/tasks/sectors');
  check((sectors.body ?? []).some((s) => s.name === 'cliente'), 'sector al vuelo en el catalogo');

  const branch = await request('GET', `/tasks?group=${root.body?.id}&includeDescendants=true`);
  check((branch.body ?? []).some((t) => t.id === task.body?.id), 'la rama trae la tarea del subnivel');

  const cycle = await request('PUT', `/tasks/groups/${root.body?.id}`, { parentId: proyectoX.body?.id });
  check(cycle.status === 400, 'mover dentro del descendiente da 400', `${cycle.status}`);

  const cleared = await request('PUT', `/tasks/${task.body?.id}`, { priority: null, state: null });
  const badPriority = await request('PUT', `/tasks/${task.body?.id}`, { priority: 'urgente' });
  check(cleared.status === 200 && cleared.body?.priority === null && cleared.body?.state === null, 'prioridad y estado se limpian con null');
  check(badPriority.status === 400, 'prioridad invalida da 400', `${badPriority.status}`);

  const domain = await request('POST', '/tasks', {
    title: 'Dominio', type: 'pago', startsOn: iso(today),
    recurrence: { frequencyUnit: 'month', interval: 1, endsMode: 'never' },
    payment: { mode: 'recurrente', priceFixed: true, priceAmount: '12.00', priceCurrency: 'USD' },
  });
  const expectations = await request('GET', `/tasks/${domain.body?.id}/expectations`);
  const expectationId = (expectations.body ?? [])[0]?.id;
  const linked = await request('PUT', `/tasks/${task.body?.id}`, { linkedExpectationId: expectationId });
  const badLink = await request('PUT', `/tasks/${task.body?.id}`, { linkedExpectationId: '00000000-0000-4000-8000-000000000000' });
  check(linked.status === 200 && linked.body?.linkedExpectationId === expectationId, 'vinculo a la expectativa de otra tarea');
  check(badLink.status === 404, 'expectativa inexistente da 404', `${badLink.status}`);

  const removed = await request('DELETE', `/tasks/groups/${proyectoX.body?.id}`);
  const survivor = await request('GET', `/tasks/${task.body?.id}`);
  const tree = await request('GET', '/tasks/groups/tree');
  const calendar = await request('GET', `/calendar?from=${iso(today)}&to=${iso(today)}`);
  check(removed.status === 200 && survivor.status === 200, 'borrar la carpeta no borra su tarea', `${removed.status}/${survivor.status}`);
  check(Array.isArray(tree.body) && tree.body.length > 0, 'el arbol se lee anidado', `${Array.isArray(tree.body) ? tree.body.length : 'n/a'}`);
  check(calendar.status === 200, 'el calendario sigue respondiendo', `${calendar.status}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nORGANIZACION EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
