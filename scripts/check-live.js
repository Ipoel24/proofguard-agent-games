// Local live-endpoint check for ProofGuard (mirrors the DEPLOY.md §3 checks).
// Usage: node scripts/check-live.js [baseUrl]  (default http://localhost:3000)
const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const ADDR = '0x1111111111111111111111111111111111111111';

async function req(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json, text: text.slice(0, 200) };
}

function fail(msg) { throw new Error(msg); }

async function main() {
  console.log('base:', BASE);
  // 1. health
  const health = await req('GET', '/api/health');
  console.log('GET /api/health ->', health.status, JSON.stringify(health.json));
  if (health.status !== 200 || health.json.status !== 'ok') fail('health not ok');
  // 2. guard usage (GET)
  const usage = await req('GET', '/api/guard');
  console.log('GET /api/guard ->', usage.status, (usage.json && usage.json.usage) || usage.text);
  if (usage.status !== 200 || !usage.json.usage) fail('guard GET usage missing');
  // 3. approve
  const approveBody = { taskId: 'live-001', token: 'USDC', amount: 500, maxAmount: 1000, balance: 1500, minBalance: 1000, currentBlock: 100, expiryBlock: 200, recipient: ADDR, expectedRecipient: ADDR };
  const approve = await req('POST', '/api/guard', approveBody);
  console.log('POST /api/guard approve ->', approve.status, approve.json && approve.json.decision, 'proveMs=', approve.json && approve.json.proveMs);
  if (approve.status !== 200 || approve.json.decision !== 'APPROVE') fail('approve failed');
  if (!approve.json.proof || !approve.json.proof.pi_a) fail('approve has no proof');
  // 4. verify the approve proof offline with snarkjs
  const vkPath = path.join(__dirname, '..', 'api', 'circuit', 'verification_key.json');
  const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
  const okOffline = await snarkjs.groth16.verify(vk, approve.json.publicSignals, approve.json.proof);
  console.log('snarkjs groth16 verify (offline) ->', okOffline);
  if (!okOffline) fail('offline verify failed');
  // 5. verify via the endpoint
  const verifyOk = await req('POST', '/api/verify', { proof: approve.json.proof, publicSignals: approve.json.publicSignals });
  console.log('POST /api/verify ->', verifyOk.status, JSON.stringify(verifyOk.json));
  if (verifyOk.status !== 200 || verifyOk.json.valid !== true) fail('endpoint verify failed');
  // 6. tampered receipt via the endpoint must be false
  const tampered = [...approve.json.publicSignals];
  tampered[9] = (BigInt(tampered[9]) + 1n).toString();
  const verifyBad = await req('POST', '/api/verify', { proof: approve.json.proof, publicSignals: tampered });
  console.log('POST /api/verify (tampered) ->', verifyBad.status, JSON.stringify(verifyBad.json));
  if (verifyBad.status !== 200 || verifyBad.json.valid !== false) fail('tampered receipt not rejected');
  // 7. reject case
  const reject = await req('POST', '/api/guard', { ...approveBody, taskId: 'live-002', amount: 1500 });
  console.log('POST /api/guard reject ->', reject.status, reject.json && reject.json.decision, JSON.stringify(reject.json && reject.json.reasonCodes));
  if (reject.status !== 200 || reject.json.decision !== 'REJECT' || !reject.json.reasonCodes.includes('AMOUNT_OVERFLOW')) fail('reject failed');
  const okRejectOffline = await snarkjs.groth16.verify(vk, reject.json.publicSignals, reject.json.proof);
  console.log('snarkjs groth16 verify (reject receipt, offline) ->', okRejectOffline);
  if (!okRejectOffline) fail('reject receipt offline verify failed');
  console.log('ALL LIVE CHECKS PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('LIVE CHECK FAILED:', e.message); process.exit(1); });
