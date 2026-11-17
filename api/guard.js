// POST /api/guard — screen a payment request, return decision + Groth16 proof.
// Vercel serverless function (CommonJS). No keys, no DB, no external calls.
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const { parseRequest, decide, circuitInput } = require('./_policy');

const { circuitPaths } = require('./_artifacts');

let vkCache = null;
function verificationKey() {
  if (!vkCache) vkCache = JSON.parse(fs.readFileSync(circuitPaths().vk, 'utf8'));
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
  if (req.method === 'GET') {
    return json(res, 200, {
      agent: 'proofguard/1.0.0',
      usage: 'POST /api/guard with a JSON body to screen a payment and get a Groth16 proof of the decision',
      body: { taskId: 'pay-001', token: 'USDC', amount: 500, maxAmount: 1000, balance: 1500, minBalance: 1000, currentBlock: 100, expiryBlock: 200, recipient: '0x1111111111111111111111111111111111111111', expectedRecipient: '0x1111111111111111111111111111111111111111' },
      policy: 'APPROVE iff amount <= maxAmount, balance >= minBalance, currentBlock < expiryBlock, recipient == expectedRecipient',
      verify: 'POST /api/verify with { proof, publicSignals } to check a receipt',
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed, use GET or POST' });
  const t0 = Date.now();
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  let parsed;
  try {
    parsed = parseRequest(body);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  const { decision, reasonCodes } = decide(parsed);
  let proof, publicSignals;
  try {
    const paths = circuitPaths();
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput(parsed, decision), paths.wasm, paths.zkey
    ));
  } catch (e) {
    // Should never happen: decide() and the circuit enforce the same policy.
    // If it does, the agent refuses rather than returning an unproven decision.
    return json(res, 500, { error: 'proof generation failed, decision withheld', detail: String(e.message).slice(0, 200) });
  }
  return json(res, 200, {
    agent: 'proofguard/1.0.0',
    decision: decision === 1 ? 'APPROVE' : 'REJECT',
    reasonCodes,
    taskId: parsed.taskId,
    token: parsed.token,
    policy: {
      amount: parsed.amount.toString(),
      maxAmount: parsed.maxAmount.toString(),
      balance: parsed.balance.toString(),
      minBalance: parsed.minBalance.toString(),
      currentBlock: parsed.currentBlock.toString(),
      expiryBlock: parsed.expiryBlock.toString(),
      recipient: '0x' + parsed.recipient.toString(16).padStart(40, '0'),
      expectedRecipient: '0x' + parsed.expectedRecipient.toString(16).padStart(40, '0'),
    },
    proof: {
      protocol: 'groth16',
      curve: 'bn128',
      pi_a: proof.pi_a,
      pi_b: proof.pi_b,
      pi_c: proof.pi_c,
    },
    publicSignals,
    verificationKey: verificationKey(),
    verifyWith: 'snarkjs groth16 verify verification_key.json public.json proof.json',
    proveMs: Date.now() - t0,
  });
};
