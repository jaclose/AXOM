# AXOM AI Infrastructure & Provider Strategy

This document defines the "Provider-Agnostic" AI layer, ensuring AXOM remains functional regardless of which LLM provider is active.

## 1. The Provider Abstraction
AXOM does not call LLM APIs directly in components. It uses an `AIProvider` interface.

### The Interface
```typescript
interface AIProvider {
  info: ProviderInfo;
  available: () => Promise<AiAvailability>;
  completeJson: (req: AiJsonRequest) => Promise<unknown>;
}
```

### Active Providers
1. **Local (Ollama)**: Primary target. Zero-cost, private.
2. **Cloud (BYOK)**: User provides an API key (OpenAI/Anthropic).
3. **Demo (Internal)**: A restricted proxy for new users to test features.

## 2. The "Reliability" Layer
AI is non-deterministic. To make it "production-ready," AXOM implements:

### Structured Output Enforcement
- **JSON-Mode**: Every request specifies `format: "json"`.
- **Schema Validation**: Response is validated against `schemas.ts` before hitting the store. If invalid, the app automatically retries with a "Correction Prompt."

### The Review Gate (Directive §11)
AI-generated content (cards, questions) NEVER enters the vault automatically.
- **Generation** $\rightarrow$ **User Review** $\rightarrow$ **Validation** $\rightarrow$ **Save**.

## 3. AI Feature Roadmap
- **The Verification Bridge**: Using AI to analyze a user's "incorrect" answer and generate a targeted "Why you missed this" card.
- **Contextual Queueing**: AI analyzes the user's "weak" topics (from QBank) and re-prioritizes the Anki queue.
