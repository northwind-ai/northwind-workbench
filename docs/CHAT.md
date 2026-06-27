# AI Codebase Chat

Ask natural-language questions about your repository — "ChatGPT for the repo", but
**grounded**: every answer is derived from existing Package Workbench intelligence
and cites the evidence behind it. Offline-first; an LLM is an optional enhancement.

```
Q: Why is auth unhealthy?

Answer:
  @repo/auth health score is 62/100 due to 3 issues.

Evidence:
  - [health] 1 circular dependency(ies)
  - [health] MISSING_DEPENDENCY: Missing module: zod
  - [scenario] 2 scenario failure(s)

Suggested Actions:
  1. Add "zod": "^3.22.4" to dependencies
  2. Break cycle by extracting @repo/core-types

Confidence: High
```

## Architecture

```
 Question
   ↓  intent detection        (intent.ts)      → query type + entities + timeframe
   ↓  context retrieval       (context.ts)      → compressed, relevant slice only
   ↓  reasoning               (reason.ts)       → grounded answer per query type
   ↓  response generation     (render.ts)       → answer · evidence · actions · confidence
```

It performs **no analysis of its own**. It reasons over a `WorkbenchKnowledge`
bundle — exactly what the engines already produce:

| Source                 | Used for                                              |
| ---------------------- | ----------------------------------------------------- |
| package health (`run`) | health / failure answers                              |
| dependency graph       | dependency / architecture answers, cycles             |
| package intelligence   | size / performance answers                            |
| refactor plan          | "what should I refactor first?" + suggested actions   |
| history + delta        | regression / "what changed?" / CI-instability answers |
| fix plan               | grounded suggested actions                            |

## Intent detection

Deterministic keyword/pattern classification into eight query types: `health`,
`dependency`, `architecture`, `failure`, `regression`, `refactor`, `performance`,
`general`. Package entities are resolved against the actual package names in the run
(exact + short-name match); the timeframe ("since last week", "last run") is detected
too.

## Context retrieval (compression)

Only the relevant slice is selected — never the whole repo. Subject resolution:
explicit entities → session focus (follow-ups) → a sensible default for the intent
(e.g. the worst package for a failure query). The focus, its graph neighbourhood, and
relevant regressions are compressed into a small `RetrievedContext`, which keeps
heuristic reasoning sharp and (for an LLM) the prompt tiny.

## Reasoning modes

- **Heuristic (required, offline).** Deterministic per-type reasoning. Every claim is
  backed by a fact in the knowledge bundle and emitted as cited evidence; confidence
  reflects how much supporting data was actually available (a regression question with
  no history is honestly `low`, with empty evidence).
- **LLM (optional, provider-agnostic).** Wraps any `LLMClient`. It may only rewrite the
  answer prose; it cannot change the evidence, confidence, or actions, and it degrades
  to the heuristic answer on any error — so the chat is never worse than offline and
  never hallucinates new facts.

## Conversational memory

A `ChatSession` carries `focusEntities` — the packages most recently discussed — so a
follow-up without a subject reuses them:

```
You: Why is auth unhealthy?      → focus = [@repo/auth]
You: what depends on it?         → reuses @repo/auth, answers dependents
```

## CLI

```bash
package-workbench chat "What is the riskiest package?"
package-workbench chat "Why is @repo/auth unhealthy?" --pretty
package-workbench chat "What should I refactor first?" --format json
```

## Desktop

The **Chat** tab is a full chat interface: suggested starter prompts, clickable
package references (jump to the package), cited evidence, copyable answers, and a
confidence badge. Knowledge is gathered once per workspace and reused across the
conversation (instant follow-ups); a new scan invalidates it.

## VS Code

The command **"Package Workbench: Ask About This Repo (Chat)"** prompts for a question
and answers it in the output channel — reusing the extension's already-cached analysis
(no re-scan).

## Sample transcripts

```
Q: What should I refactor first?
A: Refactor first: Break cycle by extracting @repo/core-types — expected 100% fewer
   cycles, +12 health.
   Evidence: [refactor] auth and core form a cycle; [refactor] breaks the cycle.
   Confidence: High

Q: Which package is the largest?
A: Largest package(s): @repo/chart (600 KB).
   Evidence: [size] @repo/chart: 600 KB across 5 file(s).
   Confidence: High

Q: What changed since last week?
A: Since the baseline, the score moved -8 with 1 regression(s).
   Evidence: [history] [critical] @repo/auth: runtime import now fails.
   Confidence: High
```

## Limitations

- Answers are only as good as the analysis they reason over — regression/CI answers
  need run history; size answers need built packages.
- Heuristic reasoning covers the common question families; very open-ended questions
  fall back to a grounded workspace summary rather than guessing.
- The LLM mode is prose-only by design — it cannot introduce facts or raise
  confidence (anti-hallucination).

```

```
