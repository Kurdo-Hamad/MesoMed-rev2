# Secrets Rotation — Anthropic (AI Triage)

**Adapter:** `packages/platform/src/ai-anthropic.ts` (`createAnthropicAiGateway`)
**Env vars:** `ANTHROPIC_API_KEY`, `AI_TRIAGE_MODEL` (optional, defaults to `claude-haiku-4-5`)
**Consumers:** `ai.triageSymptoms` (public procedure, `apps/api/src/modules/ai/router.ts`) via `createTriageService` (`apps/api/src/modules/ai/triage-service.ts`)

## Blast radius

`ANTHROPIC_API_KEY` authenticates all Claude API usage billed to the
workspace it belongs to. If leaked: an attacker can consume the
workspace's API budget (cost risk) and, if the key isn't scoped to a
restricted workspace, could access usage/billing data for that workspace.
It does not grant any access to MesoMed's own database, patient data, or
other secrets — the triage service sends only the sanitized symptom text
(never a patient identifier) to the model, per `triage-service.ts`'s
`delimitUserText`/prompt-injection-delimiting design and the "never logs
raw symptom text" invariant proven by
`apps/api/test/ai/triage-service.test.ts`'s "never logs the raw symptom
text" test. Recommend creating the key under a workspace/project scoped
to this use only, so a leak's cost exposure is bounded and revocation
doesn't affect unrelated Anthropic usage elsewhere in the organization.

## Rotation steps (zero-downtime)

1. In the Anthropic Console → API Keys, create a **new** key in the same
   workspace/project. Do not revoke the old key yet.
2. Set the new key as `ANTHROPIC_API_KEY` in the deployment's secret store.
3. Roll the API instances (rolling restart).
4. Once every instance confirms on the new key (canary call — trigger
   `ai.triageSymptoms` with an innocuous symptom string and confirm
   `engine: "model"` in the response, not `"keyword"`), revoke the OLD key
   in the Anthropic Console.
5. Confirm: a request signed with the old key returns `401` from the
   Claude API. `createTriageService`'s `tryModel()` treats ANY gateway
   failure (including auth failure) as a signal to fall back to the
   deterministic keyword engine — proven by
   `apps/api/test/ai/triage-service.test.ts`'s "falls back to the keyword
   engine when the model provider is killed" — so triage keeps answering
   throughout the rotation window; it just temporarily loses model-quality
   specialty matching in favor of the keyword fallback.

## Production guardrail interaction

If `ANTHROPIC_API_KEY` is unset, `buildServer` falls back to the mock AI
gateway, and `NODE_ENV=production` refuses to boot
(`apps/api/test/mock-production-guard.test.ts`). Note this guardrail only
covers total absence of a key — an expired/revoked-but-still-set key is a
runtime failure the keyword fallback absorbs (see above), not a boot-time
one.

## Changing `AI_TRIAGE_MODEL`

`AI_TRIAGE_MODEL` is not a secret but is documented here because it shares
this adapter: changing it does not require rotation steps, only a rolling
restart (or even none, if hot-reloaded — the current implementation reads
it once at boot). The red-flag pre-screen (`containsRedFlag`) and keyword
fallback are model-independent, so a bad model swap degrades quality, not
safety — the deterministic paths are unaffected.
