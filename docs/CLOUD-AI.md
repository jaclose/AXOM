# AXOM Cloud AI

AXOM Cloud AI lets signed-in learners use Claude without any API key in the app.
Requests go through the `ai-proxy` Supabase Edge Function. The Anthropic key
exists only as a Supabase secret, and each call spends one unit of a per-user
daily allowance (`public.consume_ai_quota`, migration `20260927100000_ai_usage_quota.sql`).

```
app (AI mode: AXOM Cloud AI)
  └─ POST {SUPABASE_URL}/functions/v1/ai-proxy   Authorization: Bearer <user session JWT>
       ├─ gateway verifies the JWT (verify_jwt = true), the function re-checks it
       ├─ consume_ai_quota(limit) with the caller's own JWT → 429 when spent
       └─ POST api.anthropic.com/v1/messages (server-side key; model chosen server-side)
```

## Enable it (one time)

```bash
supabase db push                                   # applies the ai_usage migration
supabase functions deploy ai-proxy
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # never commit or paste into the app
# optional
supabase secrets set AI_DAILY_LIMIT=60 AI_MODEL_FAST=claude-haiku-4-5-20251001 AI_MODEL_QUALITY=claude-sonnet-5
```

Then in AXOM choose **Settings → AI → AXOM Cloud AI** while signed in.

## Behavior

- **Models.** The `fast` tier uses Claude Haiku 4.5 and the `quality` tier uses Claude Sonnet 5. The client can pick a tier, but never a model name.
- **Structured outputs.** Callers may send a JSON Schema. It is forwarded as `output_config.format`, the GA structured-outputs option, which guarantees parseable JSON. Every object in the schema must set `additionalProperties: false`.
- **No schema.** The model is told to reply with one JSON value, and the proxy tolerates stray code fences.
- **Limits.**
  - Prompts are capped at 24,000 characters and `max_tokens` at 2,000.
  - The daily allowance resets at 00:00 UTC.
  - Upstream errors are mapped to messages that are safe to show a learner.
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
