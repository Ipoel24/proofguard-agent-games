# ProofGuard — a payment-guard agent that proves its decisions

**zkVerify Agent Games, Season 01 — Wildcard Track.**
Live demo: *(endpoint URL goes here after Vercel deploy — see DEPLOY.md)*

## The problem

AI agents that move money approve payments on the basis of a paragraph of
reasoning. A wrong approval moves real value, and the agent's later report
("it went fine") is a claim, not evidence. There is no checkable receipt
that the decision followed the rules — and logs don't fix it, because
whoever controls the machine can edit the log.

## What ProofGuard does

ProofGuard screens a proposed stablecoin payment against a fixed,
published policy and returns a decision **plus a Groth16 zero-knowledge
proof that the decision follows the policy**. Anyone can re-verify the
receipt offline with snarkjs — no need to trust the agent's word.

```
POST /api/guard
{
  "taskId": "pay-2026-11-16-001",
  "token": "USDC",
  "amount": 500, "maxAmount": 1000,
  "balance": 1500, "minBalance": 1000,
  "currentBlock": 100, "expiryBlock": 200,
  "recipient": "0x1111...1111",
  "expectedRecipient": "0x1111...1111"
}
→ { "decision": "APPROVE", "reasonCodes": [],
    "proof": { "pi_a": [...], "pi_b": [...], "pi_c": [...] },
    "publicSignals": ["1", "500", "1000", ...],
    "verificationKey": { ... } }
```

### The policy (all four must pass to approve)

| Check | Rule | Reason code on failure |
|---|---|---|
| Amount | `amount <= maxAmount` | `AMOUNT_OVERFLOW` |
| Balance | `balance >= minBalance` | `INSUFFICIENT_BALANCE` |
| Expiry | `currentBlock < expiryBlock` | `EXPIRED` |
| Recipient | `recipient == expectedRecipient` | `RECIPIENT_MISMATCH` |

### Why a proof, not just an answer

The circuit (`circuit/payment_guard.circom`, Groth16, BN254, 1,179
constraints: 1,161 non-linear + 18 linear) constrains `decision == 1`
**if and only if** every check passes. A proof for a wrong decision is
mathematically impossible to generate — witness generation fails. This
was tested, not assumed:

- Approve case (all checks pass): proof generated in ~1 s, verifies OK.
- All four reject cases: proof generated in ~0.2–0.3 s, verifies OK.
- Boundary cases: `amount == maxAmount` and `balance == minBalance`
  approve, `currentBlock == expiryBlock` rejects, and the largest legal
  value (2^128 − 1) approves.
- Forged approve (amount over cap, decision forced to 1): witness
  generation **fails** — no proof exists.
- False reject (all checks pass, decision forced to 0): witness
  generation **fails** — no proof exists.
- Prime-wrap regression: an amount near the field prime (which used to
  wrap through the comparison) is **rejected by the circuit's range
  checks** — no proof exists.
- Tampered receipt (a public signal flipped, incl. the task hash):
  verification returns `valid: false`.
- Input validation: values ≥ 2^128, JSON numbers above 2^53, negative
  or fractional amounts, and malformed addresses are rejected before
  any proof is attempted.

Run the tests yourself: `npm install && npm test` (see `test/guard.test.js`).
The suite also asserts the shipped `api/circuit/` artifacts are
byte-identical to the `circuit/` sources.

### Verify a receipt yourself

```bash
# from any /api/guard response, save proof.json, public.json, verification_key.json
snarkjs groth16 verify verification_key.json public.json proof.json
# → OK!
```

Or `POST /api/verify` with `{ proof, publicSignals }` — it returns
`{ "valid": true }` (and `false` for a tampered receipt).

## Who it helps

Anyone who lets an agent touch value: agent operators who want a receipt
for every approval, wallet teams that want a policy gate in front of
signing, and auditors who want to check decisions without re-running the
agent. The agent is a **judge, not a signer** — it never signs or sends a
transaction and holds no keys.

## What it can and cannot do

**Can:** judge any payment request against the 4-check policy in ~1 s
and return a proof anyone can verify. The receipt is bound to one
`taskId` (sha256, first 31 bytes, public signal 10).

**Cannot:**
- Check intent. A payment that passes all four checks but is still a
  scam (the expected recipient itself is malicious) is approved. Policy
  correctness is the deployer's job — the proof only proves the decision
  followed the policy.
- Prevent replay. The same task can be submitted twice; deduping by
  `taskId` is the caller's job.
- Handle amounts or block numbers ≥ 2^128 (rejected by input validation
  and by range checks inside the circuit).
- Hide inputs. The circuit has **zero private inputs**: every value is
  public, so anyone can recompute `decide()` faster than verifying the
  proof. The proof's value is the checkable receipt (and, later,
  aggregation into one cheap on-chain attestation), not secrecy. The
  inputs themselves (balance, block number, recipient) are
  caller-supplied and unattested — the proof only shows the decision
  follows the policy *for those inputs*. Hiding the balance behind a
  commitment is on the roadmap, not in this version.

## How it works (build context)

- **Stack:** Node.js serverless function on Vercel, `snarkjs` 0.7.5.
  No database, no keys, no chain writes, no external API calls at
  runtime. Proof generation ~0.2–1.3 s, inside serverless limits.
- **Circuit:** `circuit/payment_guard.circom` — self-contained Circom
  2.x, no circomlib dependency. Range checks use a hand-written
  `LessThan` (Num2Bits on `a − b + 2^128`, the standard sign-bit trick);
  equality uses the inverse trick. All six numeric inputs are
  range-checked to < 2^128 inside the circuit (a `Num2Bits(128)` on
  each) — without that, a value near the field prime could wrap and
  make a wrong decision provable. 128 bits, not 64, because 2^64 is
  only ~18.4 tokens for 18-decimal tokens. Each check yields a 0/1
  flag, so the circuit is satisfiable for **both** decisions — only a
  decision that disagrees with the flags is unprovable.
- **Trusted setup:** powers-of-tau generated locally with snarkjs
  (2^12, two contributions) because the public ceremony files were
  not downloadable from this environment; the phase-2 key then got two
  contributions plus a random beacon. The setup is documented in
  `circuit/README.md`; anyone can regenerate the `.zkey` from the
  `.r1cs` and their own ceremony. **A receipt is only as trustworthy
  as this setup:** whoever ran the setup could forge proofs, so for
  production the ceremony should be multi-party. The verification key
  for the committed artifacts is pinned here so anyone can check they
  have the right one: sha256 of `verification_key.json` =
  `712b0945816cca0fa96006a05bcffd82990de80450169e3cde9f41b123fca69e`.
  (`snarkjs zkey verify` passes on the committed `.zkey`.)
- **Artifacts in the repo:** the binary circuit artifacts (`.zkey`,
  `.wasm`, `.r1cs`) are stored as base64 text (`.b64`) because the
  push tooling only accepts text files. The `.b64` is the committed
  form; the binary is derived and gitignored. `npm install` decodes
  them (postinstall), or run `npm run decode`. The serverless functions
  also decode to `/tmp` on cold start if the binary is missing (see
  `api/_artifacts.js`). Decoded sha256:
  `.zkey` `956cabce71b4e5ccbc218388ba7c866c7300656773c9e559ea42da91e2dbc47e`,
  `.wasm` `5ab455cbba0fd7d3ada13773729331b6d63b16ebb3c2b63a7caa39e737d8caa5`,
  `.r1cs` `5880ac165317d9d19c84269f99268ecc71d33cef6b70d7a3435f7a10d2d24f84`.
- **Endpoints:** `POST /api/guard` (judge + prove), `POST /api/verify`
  (check a receipt), `GET /api/health`, `GET /api/guard` (usage JSON),
  `GET /` (demo page with a live form). See `DEPLOY.md` for the deploy steps.

## zkVerify (optional plus)

The proof ProofGuard returns is a standard Groth16 proof on BN254 — the
same shape zkVerify verifies natively. Today the receipt is verified
locally with snarkjs, one proof at a time. The natural next step is to
submit these proofs to zkVerify instead: one cheap aggregated
attestation on-chain covers many decisions, and any settlement chain can
check the attestation rather than re-verifying each proof. The checkable
claim is: *"for task T, the guard's decision D follows the published
4-check policy"* — the public signals are the claim, the proof is the
evidence, and zkVerify is where that evidence becomes cheap to check at
scale. No zkVerify integration is wired in yet; the write-up states this
plainly rather than claiming a live integration.

## API reference

```
POST /api/guard
  body: {"taskId","token","amount","maxAmount","balance","minBalance",
         "currentBlock","expiryBlock","recipient","expectedRecipient"}
  → 200 { agent, decision, reasonCodes, taskId, token, policy,
          proof {protocol, curve, pi_a, pi_b, pi_c},
          publicSignals [10 strings], verificationKey, proveMs }
  → 400 { error } on invalid input (all amounts < 2^128, 0x addresses)

GET /api/guard
  → 200 { agent, usage, body, policy, verify } (usage JSON, no proof)

POST /api/verify
  body: {"proof": {"pi_a","pi_b","pi_c"}, "publicSignals": [...]}
  → 200 { "valid": true | false }

GET /api/health
  → 200 { status: "ok", agent, circuit, artifacts }

GET /
  → demo page (try the guard in the browser)
```

## Local development

```bash
npm install
npm test          # approve + 4 rejects + boundaries + tamper + 2 forgery attempts + prime-wrap + validation
npm run dev       # http://localhost:3000
```

## License

MIT. Circuit and code written for this entry; snarkjs (Apache-2.0) and
circom (GPL-3.0, build-time tool only) are separate works.
