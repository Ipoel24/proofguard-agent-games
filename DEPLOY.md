# Deploy — ProofGuard

The repo is deployment-ready. Two things need a human with accounts:
creating the GitHub repo and importing it into Vercel. No tokens or
passwords are needed in chat.

## 1. Create the GitHub repo (user, ~2 minutes) — done

1. Go to https://github.com/new (signed in as **Ipoel24**).
2. Repository name: `proofguard-agent-games`
3. Description: `ProofGuard — a payment-guard agent that returns a Groth16 proof its decision follows a published policy. zkVerify Agent Games, Wildcard Track.`
4. Public. Do NOT add a README / .gitignore / license (the local repo already has them).
5. Create repository.

The code is pushed by the agent through the GitHub connector (the user
has no PC for `git push`). The connector only accepts text files, so the
binary circuit artifacts are committed as base64 (`.b64`) and decoded
after checkout — see "Artifacts in the repo" in the README. After the
push, verify on GitHub that every file is present and that the `.b64`
files decode to the hashes listed in the README.

## 2. Deploy to Vercel (user, ~3 minutes)

Option A — dashboard (recommended, auto-deploys on every push):
1. Go to https://vercel.com/new (sign in / sign up — free Hobby plan is enough).
2. "Import Git Repository" → pick `Ipoel24/proofguard-agent-games`.
3. Framework preset: **Other**. Root directory: `./`. Leave build/output empty.
4. Deploy. Vercel installs dependencies (`snarkjs`) and deploys the
   `api/*.js` serverless functions + the `public/` demo page.
5. Note the URL, e.g. `https://proofguard-agent-games.vercel.app`.

Option B — CLI:
```bash
npm i -g vercel   # if the CLI is not installed
vercel login      # browser sign-in (user does this)
vercel deploy --prod
```

## 3. Verify the live endpoint (anyone, ~1 minute)

```bash
URL=https://proofguard-agent-games.vercel.app
curl -s $URL/api/health
curl -s -X POST $URL/api/guard -H 'Content-Type: application/json' -d \
  '{"taskId":"demo-001","token":"USDC","amount":500,"maxAmount":1000,"balance":1500,"minBalance":1000,"currentBlock":100,"expiryBlock":200,"recipient":"0x1111111111111111111111111111111111111111","expectedRecipient":"0x1111111111111111111111111111111111111111"}'
```

Expected: `decision: "APPROVE"`, `proveMs` under ~5000 ms. Then verify
the receipt with snarkjs as described in the README.

## 4. Submit the Wildcard entry (user, dashboard)

1. Go to https://agentgames.zkverify.io/register (already registered for
   the Creator Track — same account, multi-track entry is allowed).
2. Open the Wildcard track / submission form and fill in:
   - **Agent link:** https://github.com/Ipoel24/proofguard-agent-games
   - **Public endpoint:** https://proofguard-agent-games.vercel.app
   - **Use case:** paste the "The problem" + "What ProofGuard does" sections from the README.
   - **Build context:** paste the "How it works" section from the README.
   - **zkVerify (optional):** paste the "zkVerify (optional plus)" section from the README.
3. Submit before **21 Nov 2026, 22:00 UTC** (22 Nov 05:00 WIB). Judging 22–30 Nov.

## Notes

- No environment variables are needed. No keys, no database, no secrets.
- `vercel.json` pins `maxDuration: 30` for `/api/guard` (proof ~1 s)
  and includes the circuit artifacts (both the binaries and their `.b64`
  copies, so a cold start can decode them) in the function bundle.
- The binary artifacts are committed as base64 (`.b64`); see "Artifacts
  in the repo" in the README. If you ever replace a binary by hand,
  regenerate its `.b64` too (`base64 -w0 <file> > <file>.b64`) and
  re-run `npm test` — the suite asserts the decoded binaries match.
- If Vercel's Hobby 10 s limit ever bites, the same code runs on any
  Node host (`npm run dev` serves the same handlers locally).
