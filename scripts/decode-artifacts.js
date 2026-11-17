// Decode the base64 circuit artifacts back to binaries.
//
// The binary artifacts (.zkey, .wasm, .r1cs) are stored in the repo as
// base64 text (.b64) because the push tooling only accepts text files.
// The .b64 file is the source of truth; the binary is derived and
// gitignored. Run `npm run decode` (or let `npm install` do it via
// postinstall) after cloning, and the serverless functions decode to
// /tmp on cold start if the binary is still missing (see api/_artifacts.js).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// [relative path of the binary] — the .b64 sits next to it.
const PAIRS = [
  'circuit/payment_guard.r1cs',
  'circuit/payment_guard_final.zkey',
  'circuit/payment_guard_js/payment_guard.wasm',
  'api/circuit/payment_guard_final.zkey',
  'api/circuit/payment_guard.wasm',
];

function decodeOne(rel) {
  const b64Path = path.join(ROOT, rel + '.b64');
  const outPath = path.join(ROOT, rel);
  if (!fs.existsSync(b64Path)) return { rel, status: 'no-b64' };
  const decoded = Buffer.from(fs.readFileSync(b64Path, 'utf8').replace(/\s/g, ''), 'base64');
  let current = null;
  try { current = fs.readFileSync(outPath); } catch (e) { /* missing */ }
  if (current && current.equals(decoded)) return { rel, status: 'up-to-date', bytes: decoded.length };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, decoded);
  return { rel, status: current ? 'overwritten (was stale)' : 'decoded', bytes: decoded.length };
}

function decodeAll() {
  return PAIRS.map(decodeOne);
}

if (require.main === module) {
  for (const r of decodeAll()) {
    console.log(`${r.status}: ${r.rel}${r.bytes ? ` (${r.bytes} bytes)` : ''}`);
  }
}

module.exports = { decodeAll, decodeOne, PAIRS };
