import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  listLogFiles,
  readEntries,
  tailFile,
  parseEntry,
  isLogFileName,
  parseCursor,
} = require(resolve(here, '../dist/src/bll/logs/log-reader.js'));

/** Aserciones del lector de logs (spec 024): modulo puro sobre un directorio temporal. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const line = (level, msg, time, reqId) =>
  JSON.stringify({ level, time, msg, ...(reqId ? { reqId } : {}), context: 'Smoke' });

const dir = mkdtempSync(join(tmpdir(), 'pyrite-reader-'));
const write = (name, lines) => writeFileSync(join(dir, name), `${lines.join('\n')}\n`, 'utf8');

// ---------- el nombre decide ----------
check(isLogFileName('backend.20260922.1.log'), 'un nombre del logger se acepta');
check(isLogFileName('errors.20260922.3.log'), 'el stream de errores se acepta');
check(!isLogFileName('notas.txt'), 'un archivo ajeno se rechaza');
check(!isLogFileName('../../etc/passwd'), 'una ruta con separadores se rechaza');
check(!isLogFileName('backend.20260922.1.log.bak'), 'un nombre parecido se rechaza');
check(isLogFileName('..\\..\\backend.20260922.1.log') === false, 'una ruta de Windows se rechaza');

// ---------- el listado ----------
write('backend.20260922.1.log', [line('info', 'uno', '2026-09-22T10:00:00.000Z')]);
write('backend.20260922.2.log', [line('warn', 'dos', '2026-09-22T11:00:00.000Z')]);
write('errors.20260921.1.log', [line('error', 'tres', '2026-09-21T09:00:00.000Z')]);
writeFileSync(join(dir, 'ajeno.txt'), 'no soy un log', 'utf8');

const listing = listLogFiles(dir);
check(listing.files.length === 3, 'solo lista los archivos del logger', `${listing.files.length}`);
check(listing.foreign.includes('ajeno.txt'), 'el ajeno se reporta aparte');
check(listing.files[0].name === 'backend.20260922.2.log', 'viene del mas nuevo al mas viejo', listing.files[0].name);
check(listing.files[0].segment === 2, 'el segmento se lee del nombre', `${listing.files[0].segment}`);
check(listing.files.every((file) => file.bytes > 0), 'el tamaño se mide');
check(listing.files.find((file) => file.stream === 'errors')?.date === '2026-09-21', 'el stream y la fecha se separan');

const missing = listLogFiles(join(dir, 'no-existe'));
check(missing.files.length === 0 && missing.foreign.length === 0, 'un directorio inexistente no es un error');

// ---------- la lectura ----------
const all = readEntries(dir, {});
check(all.entries.length === 3, 'lee los tres registros', `${all.entries.length}`);
check(all.entries[0].msg === 'tres', 'viene en orden de fecha, del mas viejo al mas nuevo', all.entries[0].msg);
check(all.nextCursor === null, 'sin mas que leer no hay cursor');
check(all.entries.every((entry) => entry.context === 'Smoke'), 'los campos se desarman');

const onlyErrors = readEntries(dir, { levels: ['error'] });
check(onlyErrors.entries.length === 1 && onlyErrors.entries[0].msg === 'tres', 'filtra por nivel', `${onlyErrors.entries.length}`);
const twoLevels = readEntries(dir, { levels: ['warn', 'error'] });
check(twoLevels.entries.length === 2, 'acepta mas de un nivel', `${twoLevels.entries.length}`);
const byStream = readEntries(dir, { stream: 'errors' });
check(byStream.entries.length === 1, 'filtra por stream', `${byStream.entries.length}`);
const byText = readEntries(dir, { q: 'DOS' });
check(byText.entries.length === 1 && byText.entries[0].msg === 'dos', 'el texto no distingue mayusculas', `${byText.entries.length}`);
const byDay = readEntries(dir, { from: '2026-09-22', to: '2026-09-22' });
check(byDay.entries.length === 2, 'el rango de un dia elige sus archivos', `${byDay.entries.length}`);
const fromDay = readEntries(dir, { from: '2026-09-22' });
check(fromDay.entries.length === 2, 'solo con desde alcanza', `${fromDay.entries.length}`);

const byReq = readEntries(dir, { reqId: 'abc-123' });
check(byReq.entries.length === 0, 'un reqId ausente no devuelve nada');
write('backend.20260922.1.log', [
  line('info', 'uno', '2026-09-22T10:00:00.000Z', 'abc-123'),
  line('info', 'otro', '2026-09-22T10:05:00.000Z', 'def-456'),
]);
const withReq = readEntries(dir, { reqId: 'abc-123' });
check(withReq.entries.length === 1 && withReq.entries[0].msg === 'uno', 'el reqId aísla una peticion', `${withReq.entries.length}`);

// ---------- paginacion, lineas rotas y tail ----------
const pagedDir = mkdtempSync(join(tmpdir(), 'pyrite-reader-page-'));
const many = [];
for (let index = 1; index <= 10; index += 1) {
  many.push(line('info', `m${index}`, `2026-09-22T10:0${index % 10}:00.000Z`));
}
many.push('{ esto no es json valido');           // linea corrupta (con salto: llega como raw)
// La ultima linea va sin salto de linea: es la que el roller todavia no termino de escribir.
const midWrite = '{"level":"info","msg":"colada';
writeFileSync(join(pagedDir, 'backend.20260922.1.log'), `${many.join('\n')}\n${midWrite}`, 'utf8');

const pageOne = readEntries(pagedDir, { limit: 4 });
check(pageOne.entries.length === 4, 'una pagina respeta el limite', `${pageOne.entries.length}`);
check(pageOne.nextCursor !== null, 'con mas por leer deja cursor');
check(pageOne.truncated === true, 'marca que el rango no se termino');

const pageTwo = readEntries(pagedDir, { limit: 4, cursor: pageOne.nextCursor });
check(pageTwo.entries.length === 4, 'la segunda pagina sigue', `${pageTwo.entries.length}`);
const firstIds = new Set(pageOne.entries.map((entry) => entry.raw));
check(pageTwo.entries.every((entry) => !firstIds.has(entry.raw)), 'la segunda pagina no repite');

let cursor = pageTwo.nextCursor;
const rest = [];
let guard = 0;
while (cursor && guard < 10) {
  const page = readEntries(pagedDir, { limit: 4, cursor });
  rest.push(...page.entries);
  cursor = page.nextCursor;
  guard += 1;
}
const everything = [...pageOne.entries, ...pageTwo.entries, ...rest];
const rawSeen = everything.map((entry) => entry.raw);
check(new Set(rawSeen).size === rawSeen.length, 'ninguna pagina repite una linea', `${rawSeen.length}`);
check(everything.length === 11, 'se leen las once lineas completas', `${everything.length}`);
const corrupt = everything.find((entry) => entry.raw === '{ esto no es json valido');
check(corrupt !== undefined && corrupt.level === null, 'una linea corrupta llega como raw, sin romper');
check(!rawSeen.some((raw) => raw.includes('colada')), 'la linea a medio escribir queda para la proxima');

check(parseCursor('backend.20260922.1.log:120')?.offset === 120, 'el cursor se parsea');
check(parseCursor('cualquiera:10') === null, 'un cursor con nombre ajeno se rechaza');
check(parseCursor('backend.20260922.1.log:-2') === null, 'un cursor con offset negativo se rechaza');

const tailed = tailFile(pagedDir, 'backend.20260922.1.log', 3);
check(tailed.length === 3, 'el tail devuelve las tres ultimas', `${tailed.length}`);
check(tailed[1].msg === 'm10', 'el tail incluye la ultima completa', tailed[1].msg);
check(tailed[2].level === null, 'la ultima es la corrupta, que tambien es una linea', `${tailed[2].level}`);
check(!tailed.some((entry) => entry.raw.includes('colada')), 'el tail no muestra la linea a medio escribir');
check(tailFile(pagedDir, 'ajeno.txt', 3).length === 0, 'el tail no sirve un archivo ajeno');
check(tailFile(pagedDir, 'backend.20260101.1.log', 3).length === 0, 'un archivo que no existe no rompe el tail');

const broken = parseEntry('no-json');
check(broken.raw === 'no-json' && broken.time === null, 'una linea suelta se devuelve cruda');

rmSync(pagedDir, { recursive: true, force: true });

console.log(failures === 0 ? '\nLECTOR DE LOGS EN VERDE' : `\n${failures} chequeo(s) fallan`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
