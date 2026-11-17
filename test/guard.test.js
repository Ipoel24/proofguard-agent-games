// ProofGuard end-to-end test: approve + reject + boundaries + tamper +
// wrong-decision must fail + input validation + prime-wrap regression.
//
// The SHIPPED copies (api/circuit/) are the ones that deploy, so proofs
// are generated against them; a hash check first asserts they are
// byte-identical to the source copies in circuit/.
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { parseRequest, decide, circuitInput, publicSignals } = require('../api/_policy');
const { decodeAll } = require('../scripts/decode-artifacts');

const SHIPPED = path.join(__dirname, '..', 'api', 'circuit');
const WASM = path.join(SHIPPED, 'payment_guard.wasm');
const ZKEY = path.join(SHIPPED, 'payment_guard_final.zkey');
const VK = path.join(SHIPPED, 'verification_key.json');
const SOURCE = path.join(__dirname, '..', 'circuit');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertShippedMatchesSource() {
  for (const f of ['payment_guard_final.zkey', 'verification_key.json']) {
    if (sha256(path.join(SOURCE, f)) !== sha256(path.join(SHIPPED, f))) {
      throw new Error(`artifact drift: ${f} differs between circuit/ and api/circuit/`);
    }
  }
  if (sha256(path.join(SOURCE, 'payment_guard_js', 'payment_guard.wasm')) !== sha256(path.join(SHIPPED, 'payment_guard.wasm'))) {
    throw new Error('artifact drift: payment_guard.wasm differs between circuit/ and api/circuit/');
  }
  console.log('--- artifacts: circuit/ and api/circuit/ copies are byte-identical');
}

async function proveCase(name, body, expectDecision) {
  const req = parseRequest(body);
  const { decision, reasonCodes } = decide(req);
  console.log(`--- ${name}: decision=${decision} (${decision ? 'APPROVE' : 'REJECT'}) reasons=[${reasonCodes.join(',')}]`);
  if (decision !== expectDecision) throw new Error(`${name}: expected decision ${expectDecision}, got ${decision}`);
  const t0 = Date.now();
  const { proof, publicSignals: signals } = await snarkjs.groth16.fullProve(circuitInput(req, decision), WASM, ZKEY);
  console.log(`    prove took ${Date.now() - t0}ms, publicSignals=${JSON.stringify(signals)}`);
  // The snarkjs output must match the JS-computed public signals exactly.
  const expected = publicSignals(req, decision);
  if (JSON.stringify(signals) !== JSON.stringify(expected)) {
    throw new Error(`${name}: snarkjs public signals do not match JS publicSignals()`);
  }
  const vkey = require(VK);
  const ok = await snarkjs.groth16.verify(vkey, signals, proof);
  console.log(`    verify: ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) throw new Error(`${name}: proof did not verify`);
  return { proof, publicSignals: signals };
}

// Expect fullProve to fail at witness generation with an assertion error.
// Any other error (e.g. a missing wasm file) is a test bug, not a pass.
async function expectProveFails(name, input) {
  try {
    await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  } catch (e) {
    if (/Assert Failed/.test(e.message)) {
      console.log(`--- safety: ${name} correctly REJECTED (${e.message.split('\n')[0]})`);
      return;
    }
    throw new Error(`${name}: proof failed for the WRONG reason: ${e.message.split('\n')[0]}`);
  }
  throw new Error(`SAFETY FAIL: ${name} proof was generated!`);
}

async function tamperTest(proof, signals) {
  const vkey = require(VK);
  // Flip the taskHash signal (index 9): the receipt must stop verifying.
  const tamperedHash = [...signals];
  tamperedHash[9] = (BigInt(tamperedHash[9]) + 1n).toString();
  const okHash = await snarkjs.groth16.verify(vkey, tamperedHash, proof);
  console.log(`--- tamper taskHash: verify=${okHash} (expect false)`);
  if (okHash) throw new Error('TAMPER FAIL: flipped taskHash still verified');
  // Flip the decision signal (index 0): same expectation.
  const tamperedDecision = [...signals];
  tamperedDecision[0] = tamperedDecision[0] === '1' ? '0' : '1';
  const okDecision = await snarkjs.groth16.verify(vkey, tamperedDecision, proof);
  console.log(`--- tamper decision: verify=${okDecision} (expect false)`);
  if (okDecision) throw new Error('TAMPER FAIL: flipped decision still verified');
}

function expectParseThrows(name, body, pattern) {
  try {
    parseRequest(body);
  } catch (e) {
    if (pattern && !pattern.test(e.message)) throw new Error(`${name}: wrong error: ${e.message}`);
    console.log(`--- validation: ${name} correctly rejected (${e.message})`);
    return;
  }
  throw new Error(`VALIDATION FAIL: ${name} was accepted`);
}

async function main() {
  // Make sure the binaries exist (decode from the committed .b64 if needed).
  for (const r of decodeAll()) {
    if (r.status !== 'up-to-date') console.log(`--- decode: ${r.status}: ${r.rel}`);
  }
  assertShippedMatchesSource();
  const base = {
    taskId: 'task-001', token: 'USDC',
    amount: 500, maxAmount: 1000, balance: 1500, minBalance: 1000,
    currentBlock: 100, expiryBlock: 200,
    recipient: '0x1111111111111111111111111111111111111111',
    expectedRecipient: '0x1111111111111111111111111111111111111111',
  };
  // 1. approve: everything passes
  const approve = await proveCase('approve', base, 1);
  // 2. reject: amount over cap
  await proveCase('reject-amount', { ...base, taskId: 'task-002', amount: 1500 }, 0);
  // 3. reject: recipient mismatch
  await proveCase('reject-recipient', { ...base, taskId: 'task-003', expectedRecipient: '0x2222222222222222222222222222222222222222' }, 0);
  // 4. reject: expired
  await proveCase('reject-expired', { ...base, taskId: 'task-004', currentBlock: 200 }, 0);
  // 5. reject: balance below minimum
  await proveCase('reject-balance', { ...base, taskId: 'task-005', balance: 500 }, 0);
  // 6. boundary: amount == maxAmount approves
  await proveCase('boundary-amount-eq', { ...base, taskId: 'task-008', amount: 1000, maxAmount: 1000 }, 1);
  // 7. boundary: balance == minBalance approves
  await proveCase('boundary-balance-eq', { ...base, taskId: 'task-009', balance: 1000, minBalance: 1000 }, 1);
  // 8. boundary: currentBlock == expiryBlock rejects (strict <)
  await proveCase('boundary-expiry-eq', { ...base, taskId: 'task-010', currentBlock: 200, expiryBlock: 200 }, 0);
  // 9. boundary: 2^128-1 is the largest legal value and approves
  const MAX128 = (1n << 128n) - 1n;
  await proveCase('boundary-max-128', { ...base, taskId: 'task-011', amount: MAX128.toString(), maxAmount: MAX128.toString(), balance: MAX128.toString(), minBalance: MAX128.toString() }, 1);
  // 10. tampered receipt must not verify
  await tamperTest(approve.proof, approve.publicSignals);
  // 11. SAFETY: try to prove decision=1 when amount > cap — must FAIL at witness generation
  const bad = parseRequest({ ...base, taskId: 'task-012', amount: 1500 });
  await expectProveFails('wrong-decision (amount over cap, decision=1)', circuitInput(bad, 1));
  // 12. SAFETY: try decision=0 when everything passes — must FAIL too
  const good = parseRequest({ ...base, taskId: 'task-013' });
  await expectProveFails('false-reject (all pass, decision=0)', circuitInput(good, 0));
  // 13. REGRESSION (old soundness gap): a value near the field prime used
  // to wrap through the LessThan sign-bit trick. The circuit's
  // Num2Bits(128) range checks must reject it even when the JS
  // validation is bypassed.
  const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const wrapInput = {
    decision: '1',
    amount: (P - 1n).toString(),
    maxAmount: '1000',
    balance: '1500',
    minBalance: '1000',
    currentBlock: '100',
    expiryBlock: '200',
    recipient: BigInt('0x1111111111111111111111111111111111111111').toString(),
    expectedRecipient: BigInt('0x1111111111111111111111111111111111111111').toString(),
    taskHash: '123',
  };
  await expectProveFails('wrap-amount-near-prime', wrapInput);
  // 14. input validation
  expectParseThrows('amount >= 2^128', { ...base, taskId: 'task-014', amount: (1n << 128n).toString() }, /2\^128/);
  expectParseThrows('number above 2^53', { ...base, taskId: 'task-015', amount: 9007199254740993 }, /safe integer/);
  expectParseThrows('negative amount', { ...base, taskId: 'task-016', amount: -5 }, /non-negative/);
  expectParseThrows('fractional amount', { ...base, taskId: 'task-017', amount: 1.5 }, /safe integer/);
  expectParseThrows('malformed address', { ...base, taskId: 'task-018', recipient: '0x123' }, /40-hex-char/);
  console.log('ALL TESTS PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
