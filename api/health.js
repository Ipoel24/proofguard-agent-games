// GET /api/health — liveness + artifact check.
const fs = require('fs');
const { circuitPaths } = require('./_artifacts');

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'method not allowed, use GET' }));
  }
  let paths;
  try {
    paths = circuitPaths();
  } catch (e) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: 'degraded', agent: 'proofguard/1.0.0', error: e.message }));
  }
  const files = { 'payment_guard.wasm': paths.wasm, 'payment_guard_final.zkey': paths.zkey, 'verification_key.json': paths.vk };
  const artifacts = {};
  for (const [name, file] of Object.entries(files)) {
    try { artifacts[name] = fs.statSync(file).size; } catch (e) { artifacts[name] = null; }
  }
  const ok = Object.values(artifacts).every((v) => typeof v === 'number' && v > 0);
  res.statusCode = ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: ok ? 'ok' : 'degraded',
    agent: 'proofguard/1.0.0',
    circuit: 'payment_guard (groth16, bn128, 1179 constraints)',
    artifacts,
  }));
};
