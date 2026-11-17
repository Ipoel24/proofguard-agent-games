# Circuit — PaymentGuard

Groth16, BN254, Circom 2.0.0 (compiled with circom 2.2.3). 1,179
constraints (1,161 non-linear + 18 linear), 1,179 wires, 10 public
inputs, 0 private inputs.

## Files

- `payment_guard.circom` — the circuit (self-contained, no circomlib).
- `payment_guard.r1cs` — compiled constraint system.
- `payment_guard_js/payment_guard.wasm` — witness generator.
- `payment_guard_final.zkey` — proving key (Groth16 setup + 2
  contributions + random beacon).
- `verification_key.json` — verification key (also served by the API).
  sha256: `712b0945816cca0fa96006a05bcffd82990de80450169e3cde9f41b123fca69e`.

## Reproduce the setup

```bash
# 1. compile
circom payment_guard.circom --r1cs --wasm --sym -o .

# 2. powers of tau (2^12 is enough for 1,179 constraints)
snarkjs powersoftau new bn128 12 pot12_0000.ptau
snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="proofguard-1"
snarkjs powersoftau contribute pot12_0001.ptau pot12_0002.ptau --name="proofguard-2"
snarkjs powersoftau prepare phase2 pot12_0002.ptau pot12_final.ptau

# 3. groth16 setup
snarkjs groth16 setup payment_guard.r1cs pot12_final.ptau payment_guard_0000.zkey
snarkjs zkey contribute payment_guard_0000.zkey payment_guard_0001.zkey --name="proofguard-1"
snarkjs zkey contribute payment_guard_0001.zkey payment_guard_0002.zkey --name="proofguard-2"
snarkjs zkey beacon payment_guard_0002.zkey payment_guard_final.zkey <random-64-hex> 10
snarkjs zkey export verificationkey payment_guard_final.zkey verification_key.json
snarkjs zkey verify payment_guard.r1cs pot12_final.ptau payment_guard_final.zkey
# → ZKey Ok!
```

Note: the public Hermez/GCS ceremony files were not downloadable from
the build environment (AccessDenied), so the committed `.zkey` was built
from a locally generated powers-of-tau (two contributions, names
"proofguard-1" and "proofguard-2", plus a random beacon as contribution
#3). The ceremony is the one part of the setup that should ideally use a
multi-party ceremony; for this demo the local setup is documented honestly
here, and a receipt is only as trustworthy as the setup that produced it.
Anyone can regenerate the `.zkey` from the `.r1cs` above with their own
ceremony — the verification key changes, the circuit does not.

## Public-input order

`decision, amount, maxAmount, balance, minBalance, currentBlock,
expiryBlock, recipient, expectedRecipient, taskHash`
