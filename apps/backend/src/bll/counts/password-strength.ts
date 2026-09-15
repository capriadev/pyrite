/**
 * Internal password scoring for the counts vault (spec 012).
 *
 * The score is computed while the plaintext is in memory and persisted as plaintext
 * metadata, so the weak audit never has to decrypt the vault. It is deterministic and
 * dependency-free: the UI maps score -> label using the threshold in settings, so the
 * 0-100 scale (one decimal) is fixed here as the contract.
 */

/** Entropy in bits that earns the maximum score. */
const TOP_OUT_BITS = 128;

/** Common values worth nothing regardless of their entropy. */
const COMMON = new Set([
  'password', 'passw0rd', 'contrasena', 'contraseña', '123456', '12345678', '123456789',
  '1234567890', '111111', '000000', '123123', 'abc123', 'qwerty', 'qwerty123', '1q2w3e4r',
  'asdasd', 'zxcvbnm', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon',
  'football', 'princess', 'sunshine', 'master', 'shadow', 'superman',
]);

const POOLS = [
  { test: /[a-z]/, size: 26 },
  { test: /[A-Z]/, size: 26 },
  { test: /[0-9]/, size: 10 },
  { test: /[^A-Za-z0-9]/, size: 33 },
];

/** Possible characters a brute-force attack would have to cover. */
function charsetSize(password: string): number {
  return POOLS.filter((pool) => pool.test.test(password)).reduce((acc, pool) => acc + pool.size, 0);
}

/** Number of ascending/descending keyboard-free runs ("abc", "987"). */
function sequentialRuns(password: string): number {
  const chars = [...password];
  let runs = 0;
  let run = 1;
  let direction = 0;
  for (let i = 1; i < chars.length; i += 1) {
    const delta = chars[i].charCodeAt(0) - chars[i - 1].charCodeAt(0);
    if (delta === 1 || delta === -1) {
      run = delta === direction || direction === 0 ? run + 1 : 2;
      direction = delta;
      continue;
    }
    if (run >= 3) runs += 1;
    run = 1;
    direction = 0;
  }
  return run >= 3 ? runs + 1 : runs;
}

function penalty(password: string): number {
  let value = 0;
  value += Math.min(sequentialRuns(password) * 10, 30);
  if (/(.)\1{2,}/.test(password)) value += 10;
  if (POOLS.filter((pool) => pool.test.test(password)).length === 1 && password.length < 12) value += 10;
  return value;
}

/**
 * 0-100 score with one decimal. Empty or common passwords top out at 10.
 */
export function scorePassword(password: string): number {
  if (!password) return 0;
  const entropyBits = Math.min(password.length * Math.log2(charsetSize(password)), TOP_OUT_BITS);
  const variety = new Set(password).size / password.length;
  const base = (entropyBits / TOP_OUT_BITS) * 100 * (0.7 + 0.3 * variety);
  const lengthCredit = Math.min(password.length, 20) / 2;
  const raw = base + lengthCredit - penalty(password);
  const score = Math.round(Math.min(Math.max(raw, 0), 100) * 10) / 10;
  return COMMON.has(password.toLowerCase()) ? Math.min(score, 10) : score;
}