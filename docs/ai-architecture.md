# AI Architecture

> Status: **Phase 0 design; the student assistant is implemented (Phase 5, 2026-11-23).** What was
> built, and where it differs from this design, is in §11. Model IDs and prices were checked on
> 2026-11-21 against Anthropic's current model list (cached 2026-11-03). Verify them before launch.

## 1. Principles

1. **One orchestration layer, many agent profiles.** Agents are configurations (instructions, allowed
   tools, retrieval scope, model route), not separate chatbots.
2. **The model never holds authority.** It proposes. Backend code validates, authorizes, and executes.
   It has no raw SQL, no unrestricted HTTP, and no access to secrets.
3. **Grounded or honest.** Factual answers about the university must come from retrieved sources with
   citations. Without a source, the assistant says it could not verify the information and offers escalation.
4. **Provider-agnostic.** Interfaces for chat models, embeddings, and speech. Anthropic Claude is the
   default chat provider. Adding another provider means writing an adapter, not rewriting features.
5. **Measured.** Every call records tokens, an estimated cost, latency, outcome, and the tenant, user, and
   agent that triggered it.

## 2. Request pipeline

```
user message
  │
  ▼
[1] Context      tenant, user, locale, permissions, departments, features   (from DAL, not the client)
[2] Guards       feature enabled? rate limit? tenant budget/daily cap? input size & PII checks
[3] Route        intent classification → agent profile (student | admissions | academic | staff |
                 workflow | campus). Rules first, model-based structured output when ambiguous
[4] Retrieve     app.match_chunks(query, filters) — hybrid vector + full-text, tenant- and
                 visibility-filtered in SQL; rerank; select top-k within a token budget
[5] Generate     model call with: frozen system prompt (platform rules + tenant instructions) →
                 tools (strict schemas) → retrieved sources as citable documents → conversation
[6] Tool loop    model requests tool → executor checks permission/feature/input schema →
                 runs the backend service under the user's JWT → returns result (or error)
[7] Validate     citations must reference retrieved sources; strip unverifiable claims markers;
                 confidence = f(retrieval scores, citation coverage, model signals)
[8] Respond      stream text + citations; low confidence → "could not verify" + handoff offer
[9] Record       messages, citations, ai_usage_events (tokens, est. cost, model, latency),
                 unanswered_questions when no source was found
```

## 3. Agent profiles

| Agent | Audience | Retrieval scope | Tools (examples) | Feature key |
| --- | --- | --- | --- | --- |
| Student Assistant | Students, public | Public + student-visible docs, FAQs | `search_knowledge`, `create_ticket_draft`, `get_my_tickets`, `find_location` | `student_assistant` |
| Admissions | Applicants (anonymous OK) | Admissions docs, programs DB | `search_programs`, `compare_programs`, `capture_lead` (consent required) | `admissions_agent` |
| Academic | Students | Course materials + the user's own uploads | `generate_quiz`, `make_flashcards`, `study_plan` | `academic_agent` |
| Staff | Staff | Internal docs by department | `summarize_tickets`, `draft_email`, `draft_announcement` | `staff_assistant` |
| Workflow | Students | Procedure docs, workflow definitions | `start_request_draft`, `submit_request` (confirmation required) | `workflow_agent` |
| Campus | Everyone | Campus locations DB | `find_location`, `opening_hours` | `campus_assistant` |

Tenant admins customize tone, extra instructions, the welcome message, and handoff rules per agent.
Tenant instructions are inserted **below** platform safety rules and cannot override them.

## 4. Provider abstraction

```ts
interface ChatModelProvider {
  id: 'anthropic' | string
  generate(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatEvent> // streaming
}
interface EmbeddingProvider { id: string; dimensions: number; embed(texts: string[]): Promise<number[][]> }
interface SpeechProvider { transcribe(...); synthesize(...) }   // Phase 13
```

`ChatRequest` is our own normalized shape (system blocks, messages, tool specs, documents, limits).
Each adapter maps it to the provider SDK. The **Anthropic adapter** uses the official
`@anthropic-ai/sdk` (TypeScript) with streaming.

### Model routing (configurable per task, per tenant)

Model choice is a **platform-owner configuration** (`ai_model_routes` table): task → provider, model,
effort, max output tokens. The initial default for every route is **Claude Opus 5.5
(`claude-opus-5-5`)**. Cost tuning happens in this order, each step validated on the AI evaluation suite (§9):

1. **Prompt caching** (free win, §6).
2. **Lower `effort`** on the same model. Opus 5.5 defaults to `medium`, so we set effort explicitly per
   route (for example `low` for intent classification and short FAQ answers, `medium` for RAG answers,
   `high` for staff drafting and multi-step workflows).
3. **A cheaper model on specific routes**, if the owner chooses it after evaluation. For example
   Claude Haiku 5.5 (`claude-haiku-5-5`) for intent classification, or Claude Sonnet 5.5
   (`claude-sonnet-5-5`) for high-volume FAQ traffic.

Reference prices (USD per million tokens, Anthropic first-party, **as of 2026-11-03**, stored in
`model_prices` and versioned by `effective_from`):

| Model | ID | Input | Output | Context |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | `claude-opus-5-5` | $4.00 | $20.00 | 1M |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00 | $10.00 | 1M |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 (≤100K prompt) | $0.50 | 1M |

Cost figures shown in dashboards are labelled **"estimated"** because they are computed from our price
table and the provider's reported usage, not from an invoice.

### Anthropic API behaviours the adapter must handle (current models)

- **Thinking:** use adaptive thinking. On Opus 5.5 thinking cannot be disabled (`effort` is the control).
- **No forced tool choice:** `tool_choice: any/tool` is rejected on Opus 5.5 / Sonnet 5.5. Use
  `tool_choice: auto` + `strict: true` tool schemas, or **structured outputs** (`output_config.format`)
  when we need guaranteed JSON (intent classification, ticket categorization).
- **Refusals:** always check `stop_reason` (`refusal`, `max_tokens`, `tool_use`) before reading
  content. Enable the server-side fallback option for refusals, and surface a polite message plus handoff.
- **Citations:** pass retrieved chunks as `document` content blocks with `citations: {enabled: true}`.
  The API returns citations that point at the documents we supplied, which we map back to our chunk IDs.
  The model cannot cite a source we did not provide. Note: citations cannot be combined with
  structured outputs in the same request.
- **Streaming** for chat responses. Validate every streamed tool input against its schema before execution.
- **Data residency:** the `inference_geo` request parameter can pin where inference runs, for tenants
  with contractual requirements. Each tenant's AI data-retention terms must be reviewed before production.

## 5. Tools

- Defined once with **zod schemas**, converted to JSON Schema for the provider (`strict: true`,
  `additionalProperties: false`).
- Each tool declares `{ permission, feature, consequential: boolean, rateLimit }`.
- The executor validates input against the schema, checks permission and feature, runs the domain
  service under the user's JWT, and returns a compact, redacted result.
- **Consequential tools** never complete an action in one step. They return a `pending_confirmation`
  draft that the UI shows to the user. Only the user's explicit confirmation (a separate, authenticated
  Server Action) commits it. The assistant may say "submitted" **only** after the backend confirms the
  record was created, with its tracking number.

## 6. Prompt layout and caching

Order (most stable first, so the cached prefix is reused across requests):

1. Tool definitions (stable per agent profile; sorted deterministically)
2. Platform system prompt (safety rules, citation rules, refusal and handoff policy): frozen and versioned
3. Tenant + agent instructions (stable until an admin edits them)
4. — cache breakpoint —
5. Retrieved sources (as `document` blocks), conversation history, the new user message

Volatile values (timestamps, request IDs) never appear in the cached prefix. The adapter logs
`cache_read_input_tokens` so cache effectiveness is visible.

## 7. Prompt-injection defenses

- Retrieved document text and user uploads are passed as **documents/data**, never concatenated into
  system instructions. The system prompt states that document content is untrusted information.
- Tools re-check authorization regardless of what the model asks for, so an injected instruction cannot
  grant access.
- No tool can read another user's personal data unless the caller's permissions allow it, and no tool
  executes arbitrary queries or URLs.
- Output filtering: links in responses are restricted to tenant-approved domains and citation sources.
- An evaluation set of injection attempts (in documents and user messages) runs in CI (§9).

## 8. Confidence, fallback, and human handoff

- **No sources retrieved above threshold** → "I couldn't verify this in {university}'s official
  information." The assistant offers the responsible office's contact details or a ticket draft. The
  answer is stored with status `no_sources`, which feeds the knowledge-gap report (Phase 8, §14).
- **Conflicting sources** (same topic, different values, overlapping effective dates) → the assistant
  presents both with citations and refers the user to the department. It does not pick one silently.
- **Sensitive or high-impact topics** (grades, discipline, finances, mental-health crisis keywords) →
  the tenant-configured handoff path. Crisis messages always show emergency contacts.

## 9. Evaluation

A versioned evaluation suite (`evals/`) runs per model route and per prompt version:

- Grounded QA on the demo tenant (correct answer + correct citation), in Arabic, English, and mixed language
- "No answer available" cases (must not hallucinate fees or dates)
- Contradictory sources
- Cross-tenant and unauthorized-document probes (must return nothing)
- Prompt injection in documents and user messages
- Tool-use correctness (right tool, valid args, confirmation respected)

Model or prompt changes ship only if the suite does not regress.

## 10. Why not a hosted agent framework

We considered running agents on a hosted agent service. We chose to own the loop (Messages API + our
tool executor) because tools must execute inside our authorization boundary under the user's JWT, the
product requires provider abstraction, and per-tenant cost accounting and data retention must stay
under our control. This is recorded as ADR-009 in `ARCHITECTURE_DECISIONS.md`.

## 11. Phase 5 implementation (student assistant)

Built (ADR-023, ADR-024):

| Step | Implementation |
| --- | --- |
| Context + guards | `POST /api/assistant/[tenant]` (`src/app/api/assistant/[tenant]/route.ts`): same-origin, JSON, signed-in, rate limit (20 per user / 60 per IP per 5 min, in memory). Gates in `assistant_begin_turn` (membership, `assistant.use`, feature, on/off switch, monthly budget) |
| Retrieve | `search_knowledge` with the student's session (full-text; vectors when an embedding provider exists, ADR-021), top 6 passages |
| Generate | `src/lib/ai/assistant.ts`: `client.beta.messages.stream` with Claude Opus 5.5, `effort` medium, adaptive thinking, `fallbacks: 'default'` (refusal fallback), cached system prompt, passages as `search_result` blocks with citations |
| Validate | `mapCitations` (`src/lib/ai/prompt.ts`): only citations that map to a retrieved passage are kept; an answer without citations is a knowledge gap (`no_sources`) |
| Respond | NDJSON stream; the chat (`/app/[tenant]/ask`) shows numbered sources with page numbers that open the cited document through a signed link |
| Record | `assistant_complete_turn`: answer, status, citations, sources, model, tokens, latency, and `ai_usage_events` with the estimated cost |

Differences from the design above, on purpose:
- No intent router, tools or agent profiles yet: Phase 5 has one agent and no tools.
- Model and effort come from `AI_MODEL` / `AI_EFFORT`, and prices from `src/lib/ai/pricing.ts`. The `ai_model_routes` and `model_prices` tables arrive with the platform AI console (Phase 15).
- Knowledge gaps are assistant messages with status `no_sources` instead of a separate `unanswered_questions` table; Phase 8 analytics reads them from there.
- Conflicting sources are handled by the prompt (mention both, prefer the authoritative or most recent one); there is no automatic conflict detection yet.

Evaluation: `evals/assistant` (docs/ai-evals.md), opt-in because it calls the API and costs money.

## 12. Phase 6: admissions assistant

Same pipeline as §11, with `agent: 'admissions'` (ADR-025):
- **Who:** anyone. Visitors use an anonymous session; the endpoint is `/api/admissions/[tenant]`.
- **Gates:** `admissions_begin_turn`: public page and assistant on, its own monthly budget (default 20 USD), a daily limit per visitor (default 20 questions), 1–1,000 characters.
- **Sources:** published documents with visibility `public` (`admissions_search`), plus the university's **published program records**, turned into citable passages (`program://<id>`, `src/lib/admissions/public.ts`). With many programs, the ones the question names are kept, up to 8.
- **Rules added for applicants:** never promise admission, scholarships or decisions; no access to applications; do not collect personal details in the chat, point to the inquiry form instead.
- **Answers:** citations of programs link to the program page; document sources are shown without a download link (visitors cannot read the files).
- **Usage** is booked as `admissions_agent` (separate from the student assistant's budget).

## 13. Phase 7: ticket drafts and summaries

Two small structured-output calls in `src/lib/tickets/ai.ts` (ADR-027). Neither speaks to the requester:
- **Draft from a conversation:** the student's own last 20 turns plus the list of active categories go in; a subject, a first-person description and a category id (or null) come out. The student edits and sends it. A category id that is not in the list is dropped.
- **Summary for staff:** the request thread plus the conversation the student chose to share; a summary, up to 5 open questions and one suggested next step come out, in the staff member's language. It is stored as an internal note of kind `ai_summary`, with the model name, and labelled as AI-generated.
- **Calls:** `messages.parse` with a zod schema (`output_config.format`), `effort: 'low'`, `max_tokens` 2,000, no tools. The system prompts say that the conversation is data, not instructions.
- **Gate and usage:** `tickets_ai_begin` before the call (feature, permission, the student assistant's monthly budget, 30 calls per person per day). `tickets_ai_record` books usage as feature `ticketing` after the call, refusals included. A refusal asks the person to write the request themselves.
- **Not evaluated live:** there is no eval set for these two tasks yet, and no API key is configured.

## 14. Phase 8: the quality loop

No model call is involved. The loop uses what the assistants already store:
- **Knowledge gaps:** answers with status `no_sources`, grouped by normalized question (`quality_gaps`). They appear in the analytics report for knowledge managers and in the AI quality queue for reviewers. Typical fix: add or update a document, then mark the group "knowledge base updated".
- **Flagged answers:** answers rated not helpful and answers the model declined (`quality_flagged`). The reviewer sees the question, the answer, the cited passages and the comment, unless the answer was built from documents the reviewer cannot read (ADR-028).
- **Outcomes** feed the dashboard: how many were correct, fixed in the knowledge base, still need a document, or were assistant mistakes. "Assistant mistake" is the signal to add an eval case (`evals/`) before changing prompts.
- **Not built:** AI clustering of similar gap questions across wordings (needs the API key), and automatic eval cases from reviewed mistakes.

