// Resolve the circuit artifacts for the serverless functions.
//
// The raw binaries live in api/circuit/ when present (decoded by
// `npm install` via postinstall). If they are missing — e.g. Vercel
// bundled only the .b64 text files — decode the .b64 sibling to /tmp
// on cold start and use that. /tmp persists across warm invocations,
// so the decode happens at most once per function instance.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CIRCUIT_DIR = path.join(__dirname, 'circuit');
const TMP_DIR = path.join(os.tmpdir(), 'proofguard-circuit');

function decodeB64ToTmp(name) {
  const b64Path = path.join(CIRCUIT_DIR, name + '.b64');
  if (!fs.existsSync(b64Path)) throw new Error(`missing artifact ${name} (no binary and no .b64)`);
  const decoded = Buffer.from(fs.readFileSync(b64Path, 'utf8').replace(/\s/g, ''), 'base64');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const outPath = path.join(TMP_DIR, name);
  fs.writeFileSync(outPath, decoded);
  return outPath;
}

function resolveArtifact(name) {
  const raw = path.join(CIRCUIT_DIR, name);
  try {
    if (fs.statSync(raw).size > 0) return raw;
  } catch (e) { /* missing — fall through to decode */ }
  const tmp = path.join(TMP_DIR, name);
  try {
    if (fs.statSync(tmp).size > 0) return tmp;
  } catch (e) { /* not decoded yet */ }
  return decodeB64ToTmp(name);
}

let pathsCache = null;
function circuitPaths() {
  if (!pathsCache) {
    pathsCache = {
      wasm: resolveArtifact('payment_guard.wasm'),
      zkey: resolveArtifact('payment_guard_final.zkey'),
      vk: path.join(CIRCUIT_DIR, 'verification_key.json'),
    };
  }
  return pathsCache;
}

module.exports = { circuitPaths, resolveArtifact, CIRCUIT_DIR };
