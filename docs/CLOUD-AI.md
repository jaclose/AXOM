# AXOM Cloud AI

AXOM Cloud AI lets signed-in learners use Claude without any API key in the app.
Requests go through the `ai-proxy` Supabase Edge Function. The Anthropic key
exists only as a Supabase secret, and each call spends one unit of a per-user
daily allowance (`public.consume_ai_quota`, migration `20260927100000_ai_usage_quota.sql`).

```
app (AI mode: AXOM Cloud AI)
  └─ POST {SUPABASE_URL}/functions/v1/ai-proxy   Authorization: Bearer <user session JWT>
       ├─ gateway verifies the JWT (verify_jwt = true), the function re-checks it
       ├─ { task, input } → tasks.ts builds the prompt, schema, budget and tier
       │  (anything else is a bounded freeform request)
       ├─ consume_ai_quota(limit) with the caller's own JWT → 429 when spent
       └─ Claude Messages API via @anthropic-ai/sdk (server-side key and model)
```

| File | Role |
| --- | --- |
| `supabase/functions/ai-proxy/index.ts` | Deno entry: Supabase auth, quota RPC, the Anthropic SDK call |
| `supabase/functions/ai-proxy/handler.ts` | Request flow with injected I/O (tested in `web/src/lib/ai/cloud.test.ts`) |
| `supabase/functions/ai-proxy/tasks.ts` | Server-owned task prompts and JSON schemas (tested in `web/src/lib/ai/tasks.test.ts`) |
| `supabase/functions/ai-proxy/core.ts` | Validation, request building, stop-reason and error mapping |

## Enable it (one time)

```bash
supabase db push                                   # applies the ai_usage migration
supabase functions deploy ai-proxy
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # never commit or paste into the app
# optional
supabase secrets set AI_DAILY_LIMIT=60 AI_MODEL_FAST=claude-haiku-4-5-20251001 AI_MODEL_QUALITY=claude-sonnet-5
```

Then in AXOM choose **Settings → AI → AXOM Cloud AI** while signed in.

## Server-owned tasks

Card and question generation run as tasks: the app sends only the learner's
inputs, and the Edge Function supplies everything else. Prompts can then
improve with `supabase functions deploy ai-proxy`, without an app release.
Local (Ollama) and Demo modes build the identical prompt in the app from the
same `tasks.ts`, so every mode behaves alike.

| Task | Inputs | Tier | `max_tokens` | Effort | Prompt |
| --- | --- | --- | --- | --- | --- |
| `cards.generate` | material (≤ 16,000 chars), topic, source, style, maxCards (≤ 12) | quality | 8,000 | medium | `cardgen-v2` |
| `questions.generate` | topic or reference (≤ 12,000 chars), category, style, difficulty, count (≤ 10) | quality | 12,000 | medium | `questiongen-v2` |

- Every task uses structured outputs with a closed JSON Schema, so the reply always parses. The app still validates each card and question before review.
- Pasted material is fenced in `<material>` / `<reference>` tags. The prompt tells Claude to treat it as content only, never as instructions.
- Oversized or empty inputs are rejected before any quota is spent.
- To change a prompt, edit `tasks.ts` and bump its `promptVersion`. Saved generations record the version that produced them.

## Behavior

- **Models.** The `fast` tier uses Claude Haiku 4.5 and the `quality` tier uses Claude Sonnet 5. The client can pick a tier, but never a model name.
- **Structured outputs.** Callers may send a JSON Schema. It is forwarded as `output_config.format`, the GA structured-outputs option, which guarantees parseable JSON. Every object in the schema must set `additionalProperties: false`.
- **No schema.** The model is told to reply with one JSON value, and the proxy tolerates stray code fences.
- **Effort.** Tasks ask for `medium` effort. The proxy sends effort only to models that accept it (Sonnet 5, current Opus), never to Haiku 4.5.
- **Limits.**
  - Freeform prompts are capped at 24,000 characters and `max_tokens` at 2,000. Tasks set their own budgets (table above).
  - The daily allowance resets at 00:00 UTC.
  - Upstream errors are mapped to messages that are safe to show a learner.
- **Stop reasons.** A reply that stopped at `max_tokens` (cut off) or `refusal` returns an explanation instead of broken JSON.
- **Transport.** The official `@anthropic-ai/sdk` (pinned in `index.ts`) streams each reply, retries once, and gives up after 120 s. That leaves the error inside the Edge Function's 150 s request limit.
- **CI.** The Quality workflow type-checks the function with Deno.
- **Privacy.** Only the text a feature sends leaves the device, for example a card or a question. Every result still passes through AXOM's review step.

## Where it is used

- Anki Lab:
  - AI card generation.
  - The reviewer coach: Explain, Memory hook, and Sharpen card. Sharpen is applied only when the learner accepts it.
- Question Bank:
  - AI import mapping.
  - Tutor explanations.
  - Weakness coach.

Any code that calls `resolveActiveProvider()` gets Cloud AI automatically when that mode is selected.
