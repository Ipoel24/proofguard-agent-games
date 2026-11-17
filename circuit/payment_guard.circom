pragma circom 2.0.0;

// ProofGuard — payment-guard decision circuit (Groth16, BN254).
//
// Public inputs: decision, amount, maxAmount, balance, minBalance,
// currentBlock, expiryBlock, recipient, expectedRecipient, taskHash.
// No private inputs: the proof proves the DECISION follows the public
// policy, not that any value is secret.
//
// decision == 1 (APPROVE) if and only if ALL four checks pass:
//   1. amount <= maxAmount
//   2. balance >= minBalance
//   3. currentBlock < expiryBlock
//   4. recipient == expectedRecipient
// A proof for a wrong decision is impossible to generate: witness
// generation fails when the decision does not match the checks.
//
// Each check produces a 0/1 signal. The circuit is satisfiable for
// BOTH decisions: a failing check yields a 0 flag (not a failed
// constraint), so legitimate REJECTs are provable too. Only a
// decision that disagrees with the flags is unprovable.
//
// taskHash is a public input with no arithmetic constraint. The proof
// commits to it, so the receipt is bound to one task id.
//
// RANGE: all six numeric inputs are range-checked to < 2^128 inside
// the circuit (a Num2Bits(128) on each). Without a range check, a
// value near the field prime could wrap through the LessThan sign-bit
// trick and make a wrong decision provable. 128 bits (not 64) because
// 2^64 is only ~18.4 tokens for 18-decimal tokens; 128 bits covers any
// realistic payment amount. Inputs >= 2^128 are also rejected by the
// API's input validation, so the circuit and the API agree.

template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc += out[i] * (1 << i);
    }
    lc === in;
}

// out = 1 iff in[0] < in[1], for values < 2^n. Never fails witness
// generation: in[0] - in[1] + 2^n always fits in n+1 bits.
template LessThan(n) {
    signal input in[2];
    signal output out;
    component n2b = Num2Bits(n + 1);
    n2b.in <== in[0] - in[1] + (1 << n);
    out <== 1 - n2b.out[n];
}

// out = 1 iff in[0] == in[1], else 0. Standard inverse trick.
template IsEqual() {
    signal input in[2];
    signal output out;
    signal inv;
    signal diff;
    diff <== in[0] - in[1];
    inv <-- diff == 0 ? 0 : 1 / diff;
    out <== 1 - diff * inv;
    diff * out === 0;
}

template PaymentGuard() {
    signal input decision;
    signal input amount;
    signal input maxAmount;
    signal input balance;
    signal input minBalance;
    signal input currentBlock;
    signal input expiryBlock;
    signal input recipient;
    signal input expectedRecipient;
    signal input taskHash;

    // decision must be 0 or 1.
    decision * (1 - decision) === 0;

    // Range checks: every numeric input must be < 2^128.
    // (Recipients are 160-bit addresses compared with IsEqual, which
    // needs no range check: any two field elements compare correctly.)
    component rangeAmount = Num2Bits(128);
    rangeAmount.in <== amount;
    component rangeMaxAmount = Num2Bits(128);
    rangeMaxAmount.in <== maxAmount;
    component rangeBalance = Num2Bits(128);
    rangeBalance.in <== balance;
    component rangeMinBalance = Num2Bits(128);
    rangeMinBalance.in <== minBalance;
    component rangeCurrentBlock = Num2Bits(128);
    rangeCurrentBlock.in <== currentBlock;
    component rangeExpiryBlock = Num2Bits(128);
    rangeExpiryBlock.in <== expiryBlock;

    // Check 1: amount <= maxAmount  <=>  NOT (maxAmount < amount).
    component ltAmount = LessThan(128);
    ltAmount.in[0] <== maxAmount;
    ltAmount.in[1] <== amount;
    signal amountOk;
    amountOk <== 1 - ltAmount.out;

    // Check 2: balance >= minBalance  <=>  NOT (balance < minBalance).
    component ltBalance = LessThan(128);
    ltBalance.in[0] <== balance;
    ltBalance.in[1] <== minBalance;
    signal balanceOk;
    balanceOk <== 1 - ltBalance.out;

    // Check 3: currentBlock < expiryBlock.
    component ltExpiry = LessThan(128);
    ltExpiry.in[0] <== currentBlock;
    ltExpiry.in[1] <== expiryBlock;
    signal expiryOk;
    expiryOk <== ltExpiry.out;

    // Check 4: recipient == expectedRecipient.
    component eq = IsEqual();
    eq.in[0] <== recipient;
    eq.in[1] <== expectedRecipient;
    signal recipientOk;
    recipientOk <== eq.out;

    // decision == 1 iff every check passes (pairwise products, quadratic).
    signal p1 <== amountOk * balanceOk;
    signal p2 <== p1 * expiryOk;
    signal p3 <== p2 * recipientOk;
    decision === p3;
}

component main { public [
    decision, amount, maxAmount, balance, minBalance,
    currentBlock, expiryBlock, recipient, expectedRecipient, taskHash
] } = PaymentGuard();
