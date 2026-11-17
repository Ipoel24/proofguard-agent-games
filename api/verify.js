// POST /api/verify — verify a ProofGuard receipt offline-style.
// Body: { proof: {pi_a, pi_b, pi_c}, publicSignals: [...] }.
// Returns { valid: true|false }. Uses the same verification key the
// guard endpoint publishes, so a receipt can be checked without
// trusting this server's word.
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');

const VK_PATH = path.join(__dirname, 'circuit', 'verification_key.json');
let vkCache = null;
function verificationKey() {
  if (!vkCache) vkCache = JSON.parse(fs.readFileSync(VK_PATH, 'utf8'));
  return vkCache;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) {
        req.destroy();
        reject(new Error('body too large (max 64KB)'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed, use POST' });
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  const { proof, publicSignals } = body || {};
  if (!proof || !Array.isArray(publicSignals) || publicSignals.length !== 10) {
    return json(res, 400, { error: 'need { proof: {pi_a, pi_b, pi_c}, publicSignals: [10 strings] }' });
  }
  try {
    const valid = await snarkjs.groth16.verify(verificationKey(), publicSignals, proof);
    return json(res, 200, { valid });
  } catch (e) {
    // A proof that fails verification is a failed check, not a server
    // error; the reason is not echoed (it can leak internals).
    return json(res, 200, { valid: false });
  }
};
