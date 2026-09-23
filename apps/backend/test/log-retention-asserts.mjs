import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { parseLogDate, planPurge, purgeLogs } = require(resolve(here, '../dist/src/bll/logs/log-retention.js'));

/** Aserciones de la retencion de logs (spec 023): modulo puro sobre un directorio temporal. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const NOW = new Date('2026-09-22T12:00:00.000Z');
const OPTIONS = { retentionDays: 120, now: NOW, minAgeHours: 2 };
const day = (offset) => {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};
const nameOf = (offset, suffix = '1') => {
  const stamp = day(offset).toISOString().slice(0, 10).replace(/-/g, '');
  return `backend.${stamp}.${suffix}.log`;
};

// ---------- el nombre decide ----------
check(parseLogDate('backend.20260922.3.log')?.toISOString().slice(0, 10) === '2026-09-22', 'la fecha del nombre se lee');
check(parseLogDate('errors.20260101.1.log') !== null, 'el archivo de errores tambien es del logger');
check(parseLogDate('notas.txt') === null, 'un archivo ajeno no es del logger');
check(parseLogDate('backend.log') === null, 'un nombre sin fecha no es del logger');
check(parseLogDate('backend.20261340.1.log') === null, 'una fecha imposible se rechaza');

// ---------- el plan ----------
const plan = planPurge(
  [
    { name: nameOf(-200) },
    { name: nameOf(-121) },
    { name: nameOf(-119) },
    { name: nameOf(0) },
    { name: 'notas.txt' },
  ],
  OPTIONS,
);
check(plan.remove.includes(nameOf(-200)), 'lo mas viejo que la retencion se borra');
check(plan.remove.includes(nameOf(-121)), 'un dia mas alla del limite alcanza para borrar');
check(!plan.remove.includes(nameOf(-119)), 'lo que esta dentro de la retencion se queda');
check(plan.keep.includes(nameOf(0)), 'el archivo de hoy nunca se toca');
check(plan.foreign.includes('notas.txt'), 'un archivo ajeno se marca aparte y no se borra');

const recent = planPurge([{ name: nameOf(-300), mtimeMs: NOW.getTime() - 60_000 }], OPTIONS);
check(recent.keep.includes(nameOf(-300)), 'un archivo tocado hace un minuto no se borra aunque su fecha sea vieja');

// ---------- el trabajo real sobre disco ----------
const dir = mkdtempSync(join(tmpdir(), 'pyrite-logs-'));
const write = (name, content, offsetDays) => {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  const when = day(offsetDays);
  utimesSync(path, when, when);
};

write(nameOf(-200), 'x'.repeat(100), -200);
write(nameOf(-200, '2'), 'y'.repeat(50), -200);
write(nameOf(-10), 'z'.repeat(10), -10);
write(nameOf(0), 'hoy', 0);
writeFileSync(join(dir, 'ajeno.txt'), 'no me toques', 'utf8');

const result = purgeLogs(dir, OPTIONS);
check(result.files === 2, 'borra exactamente los dos archivos vencidos', `${result.files}`);
check(result.bytes === 150, 'mide los bytes liberados', `${result.bytes}`);
check(result.skipped === 0, 'sin bloqueados no hay salteados');
const left = readdirSync(dir).sort();
check(left.length === 3, 'quedan los tres que no correspondia borrar', left.join(','));
check(left.includes('ajeno.txt'), 'el archivo ajeno sigue ahi');
check(left.includes(nameOf(0)), 'el de hoy sigue ahi');
check(!existsSync(join(dir, nameOf(-200))), 'el vencido ya no esta');

const empty = purgeLogs(join(dir, 'no-existe'), OPTIONS);
check(empty.files === 0 && empty.bytes === 0, 'un directorio inexistente no es un error');

rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? '\nRETENCION DE LOGS EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
