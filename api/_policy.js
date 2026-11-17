// Shared policy logic for ProofGuard.
// The policy is the whole point of the agent: 4 checks, published here
// and in the README. The Groth16 circuit enforces exactly these checks,
// so a proof for a wrong decision cannot be generated.

const crypto = require('crypto');

// Numeric inputs are range-checked to < 2^128 in the circuit (Num2Bits(128)
// on each of the six). 128 bits, not 64: 2^64 is only ~18.4 tokens for
// 18-decimal tokens. The API enforces the same bound here so the JS and
// the circuit never disagree.
const MAX_128 = (1n << 128n) - 1n;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function toBigInt(value, name) {
  let v;
  if (typeof value === 'bigint') v = value;
  else if (typeof value === 'number') {
    // JSON numbers above 2^53 are silently rounded, so only safe integers
    // may arrive as numbers; anything bigger must be a decimal string.
    if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer or a decimal string (JSON numbers above 2^53 lose precision)`);
    v = BigInt(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    v = BigInt(value);
  } else {
    throw new Error(`${name} must be a non-negative integer (number or decimal string)`);
  }
  if (v < 0n) throw new Error(`${name} must be a non-negative integer`);
  if (v > MAX_128) throw new Error(`${name} must be < 2^128`);
  return v;
}

function toAddressInt(value, name) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 40-hex-char address`);
  }
  return BigInt(value);
}

// Deterministic task binding: sha256(taskId), first 31 bytes as a field element.
function taskHashOf(taskId) {
  const digest = crypto.createHash('sha256').update(String(taskId)).digest();
  return BigInt('0x' + digest.subarray(0, 31).toString('hex'));
}

function parseRequest(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be a JSON object');
  const taskId = body.taskId;
  if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 128) {
    throw new Error('taskId must be a non-empty string (max 128 chars)');
  }
  const token = typeof body.token === 'string' ? body.token : 'USDC';
  return {
    taskId,
    token,
    amount: toBigInt(body.amount, 'amount'),
    maxAmount: toBigInt(body.maxAmount, 'maxAmount'),
    balance: toBigInt(body.balance, 'balance'),
    minBalance: toBigInt(body.minBalance, 'minBalance'),
    currentBlock: toBigInt(body.currentBlock, 'currentBlock'),
    expiryBlock: toBigInt(body.expiryBlock, 'expiryBlock'),
    recipient: toAddressInt(body.recipient, 'recipient'),
    expectedRecipient: toAddressInt(body.expectedRecipient, 'expectedRecipient'),
    taskHash: taskHashOf(taskId),
  };
}

// Returns { decision: 0|1, reasonCodes: string[] }.
// Mirrors the circuit exactly: approve iff all four checks pass.
function decide(req) {
  const reasonCodes = [];
  if (req.amount > req.maxAmount) reasonCodes.push('AMOUNT_OVERFLOW');
  if (req.balance < req.minBalance) reasonCodes.push('INSUFFICIENT_BALANCE');
  if (req.currentBlock >= req.expiryBlock) reasonCodes.push('EXPIRED');
  if (req.recipient !== req.expectedRecipient) reasonCodes.push('RECIPIENT_MISMATCH');
  return { decision: reasonCodes.length === 0 ? 1 : 0, reasonCodes };
}

// Circuit public-input order: decision, amount, maxAmount, balance,
// minBalance, currentBlock, expiryBlock, recipient, expectedRecipient, taskHash.
function circuitInput(req, decision) {
  return {
    decision: decision.toString(),
    amount: req.amount.toString(),
    maxAmount: req.maxAmount.toString(),
    balance: req.balance.toString(),
    minBalance: req.minBalance.toString(),
    currentBlock: req.currentBlock.toString(),
    expiryBlock: req.expiryBlock.toString(),
    recipient: req.recipient.toString(),
    expectedRecipient: req.expectedRecipient.toString(),
    taskHash: req.taskHash.toString(),
  };
}

function publicSignals(req, decision) {
  return [
    decision.toString(),
    req.amount.toString(),
    req.maxAmount.toString(),
    req.balance.toString(),
    req.minBalance.toString(),
    req.currentBlock.toString(),
    req.expiryBlock.toString(),
    req.recipient.toString(),
    req.expectedRecipient.toString(),
    req.taskHash.toString(),
  ];
}

module.exports = { parseRequest, decide, circuitInput, publicSignals, taskHashOf };
