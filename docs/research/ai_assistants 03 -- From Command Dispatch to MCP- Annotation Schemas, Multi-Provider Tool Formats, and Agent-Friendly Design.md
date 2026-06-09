# From Command Dispatch to MCP: Annotation Schemas, Multi-Provider Tool Formats, and Agent-Friendly Design

*Author: Thor Whalen — May 18, 2026*

---

## TL;DR

- **One annotation pass, many surfaces.** A typed, decorated command registry with a small superset of metadata (id, summary, description, schema, side-effect class, scopes, audience tags) can mechanically emit (i) an MCP server, (ii) a Zod schema bundle for the frontend, (iii) an `argh`/Click CLI, (iv) an OpenAPI 3.1 document — and, by extension, OpenAI/Anthropic/Google tool definitions. JSON Schema is the universal pivot.
- **MCP standardized only half the contract.** The MCP tool record is `{name, description, inputSchema, outputSchema?, annotations?}` [1]. The remaining half — *which* annotations to use, *how* to scope tools per user, *when* to escalate to a human — is being filled in by Specification Enhancement Proposals (SEPs), framework conventions (FastMCP, mcp-agent, mcp-use), and host-specific behaviour (Claude Code, Cursor, ChatGPT Apps).
- **The current spec annotation vocabulary is `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, plus `title`** [2,3]. These are *hints*, not contracts — useful for client UX (auto-approve vs. confirm) but never for security enforcement [4]. Several SEPs are pushing for richer risk taxonomy (`reads_private_data`, `sees_untrusted_content`, `can_exfiltrate`) to detect the "lethal trifecta" at the runtime layer [4].
- **Provider tool formats are converging on JSON Schema but diverge in envelope.** OpenAI uses `tools: [{type: "function", function: {name, description, parameters}}]`; Anthropic uses `tools: [{name, description, input_schema}]`; Google uses `function_declarations: [{name, description, parameters}]` [5,6,7]. The AI SDK (TypeScript) and LiteLLM (Python) both normalize this in production; promptfoo specifically uses the OpenAI shape as canonical and auto-translates [8,9,10].
- **Tool description quality is now the rate-limiting factor for agent reliability.** Anthropic's own benchmark on SWE-bench Verified showed that iterative description refinement produced state-of-the-art results [11]. Arcade.dev's tooling-evaluation framework treats tool definitions as menu items: agents pick from the description; the schema is the order form [12]. SEP-1382 is formalizing description-vs-schema documentation conventions [13].
- **Context-window overflow from large tool catalogs is real and now solved at the protocol level.** Anthropic's Tool Search Tool (advanced-tool-use-2025-11-20 beta, GA February 2026) marks tools with `defer_loading: true`; Claude only loads matching tools after a regex or BM25 search. Anthropic-reported gains: ~85% reduction in tool-definition tokens, Opus 4 jumping from 49% to 74% MCP-eval accuracy, Opus 4.5 from 79.5% to 88.1% [14,15,16]. Third-party stress testing (Arcade.dev with 4,027 tools) found ~60% retrieval accuracy, which is a real cap on naive use [17].
- **The recommended annotation taxonomy** layers cleanly onto the file-based skill SSOT from the previous Prompt 2 report: YAML frontmatter in a `COMMAND.md` (or `SKILL.md` for skill-style commands) carries identity, side-effect class, approval policy, OAuth scopes, audience tags, and tool-search keywords. The Python decorator reads frontmatter and a Pydantic schema; emitters consume the union as JSON Schema with vendor extensions (`x-side-effect`, `x-approval`, `x-scopes`, `x-tags`).
- **Transport choice is now a two-option decision: stdio for local subprocesses, Streamable HTTP for everything else.** SSE was deprecated in protocol revision 2026-03-26 [18,19]. The recommended default for production is Streamable HTTP with OAuth 2.1 + PKCE + Protected Resource Metadata (RFC 9728) [20,21].
- **Per-user permission scoping is enforced in two layers:** (1) filter the `tools/list` response by the authenticated user's JWT scopes, (2) re-check scopes inside each tool handler so direct calls that bypass listing are still rejected [22]. The Atlassian MCP Server is the canonical example of inheriting permissions from the underlying product rather than granting any of its own [23].
- **Multi-server composition is solved by namespacing.** FastMCP's `mount()`, the OpenAI Agents Python SDK's `include_server_in_tool_names`, and mcp-use's "Server Manager" all attach a server prefix to tool names to avoid collisions [24,25,26].

---

## 1. The Command Dispatch → MCP Bridge Problem

The prior report on command-dispatch architecture [27] argued for three primitives — state model, command registry, schema bridge — and showed how a single typed command definition can serve a command palette, keyboard shortcuts, AI tool calling, MCP, tests, macros, telemetry, undo/redo, and extensions. That report was frontend-centric (TypeScript, Zod). This report addresses the Python and protocol side: once we have a registry of typed, documented commands in *any* language, how do we cleanly turn it into a multi-surface deliverable — MCP server, multi-provider tool catalogue, CLI, HTTP API, frontend schemas — without authoring those representations independently and watching them drift?

The MCP specification gives us part of the answer. A tool in MCP is a record with `name`, `description`, `inputSchema` (JSON Schema), an optional `outputSchema` (JSON Schema), and an optional `annotations` object [1]. Servers expose tools via `tools/list`, clients invoke via `tools/call`. Crucially, both the OpenAI Agents SDK [28] and the MCP TypeScript SDK [29] accept schema-library objects (Zod, Pydantic, Standard Schema [30]) as peer dependencies, converting them to JSON Schema at registration time. Function-calling APIs from Anthropic, OpenAI, and Google all use JSON Schema for the parameter contract, with differences confined to envelope structure [5,6,7].

This convergence means the *mechanical* part of the bridge — turning a function with type hints and a docstring into a tool record on every surface — is no longer an open research problem. The *non-mechanical* part is everything that does not have a slot in `{name, description, inputSchema}`:

- **Behaviour metadata.** Is this tool a read or a write? Idempotent? Destructive? Does it touch the open world?
- **Approval policy.** Should the client confirm before calling? Should the server elicit additional input mid-flight?
- **Permission scoping.** Which authenticated users may see this tool? Which scopes does it require?
- **Discoverability hints.** Should it be deferred from initial context? What keywords help the agent find it?
- **Audience routing.** Is this command exposed to humans (palette), agents (MCP), or both? In which UI surface?

The rest of this report surveys how this missing metadata is being formalized, and proposes a single annotation taxonomy that emits cleanly onto MCP, multi-provider tool catalogues, OpenAPI, CLI, and the frontend.

---

## 2. The Framework Landscape

### 2.1 FastMCP (Python)

FastMCP is the de facto Python framework. FastMCP 1.0 was folded into the official MCP Python SDK; FastMCP 2.x and 3.x are independent successors that add deployment, authentication, OpenAPI generation, mounting, middleware, and tool transformation [31,32]. The current minimum-viable server uses one decorator:

```python
from fastmcp import FastMCP
mcp = FastMCP("Demo")

@mcp.tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b
```

The decorator inspects type annotations and the docstring, builds a JSON Schema for the input, and registers the tool [33]. For structured returns (Pydantic models, dataclasses, dicts), FastMCP automatically populates the `structuredContent` block introduced in the 2025-06-18 spec revision [33].

For the bridge concern, three FastMCP capabilities matter most:

1. **`FastMCP.from_openapi()` / `from_fastapi()`** — generates an MCP server directly from an OpenAPI 3.0/3.1 document or a FastAPI application by extracting its OpenAPI spec [34,35]. Operations become tools; route mapping is configurable. FastMCP's own documentation cautions that auto-converted servers underperform hand-curated ones on complex APIs and recommends this path for prototyping rather than long-term production [34].
2. **`mount()` and `import_server()`** — compose multiple FastMCP servers into a parent server with optional namespacing (`weather_get_forecast`, `news_get_headlines`) [25,36]. `mount()` keeps a live link; `import_server()` takes a snapshot.
3. **`ctx.elicit()`** — pauses tool execution and asks the user for structured input via the MCP `elicitation` capability [37]. The response type can be a Pydantic dataclass, a `Literal[...]`, or `None` for plain approve/reject.

FastMCP 3.x added the `AggregateProvider` and `Transform` primitives, which let composed servers be filtered by tag, renamed, or wrapped in middleware — the same building blocks used by `mount()` internally [38].

### 2.2 The MCP TypeScript SDK and Standard Schema

The TypeScript SDK uses Standard Schema [30] — meaning Zod v4, Valibot, ArkType, or any compatible library can author tool input schemas [29,39]:

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });
server.registerTool(
  'greet',
  { description: 'Greet someone by name', inputSchema: z.object({ name: z.string() }) },
  async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] }),
);
```

The SDK ships small middleware packages for Express, Hono, and Node.js HTTP that handle the transport plumbing without adding MCP-level features [29]. Output schemas (also Standard Schema) enable type-safe consumption on the client side [40]. Note that `mcp-types` is a community-maintained mirror that removes the `passthrough()` calls from the upstream Zod schemas, which would otherwise let arbitrary fields slip through validation [41].

### 2.3 mcp-agent (LastMile AI)

mcp-agent positions itself as a Python framework purpose-built for MCP, implementing Anthropic's *Building Effective Agents* patterns [42,43]. Every project is built around an `MCPApp` runtime that loads configuration, registers agents (each of which couples an instruction prompt with the MCP servers it may call), and wires them into compositional patterns: parallel fan-out, router, intent classifier, orchestrator, deep-research, evaluator-optimizer, OpenAI Swarm-style handoffs [43]. The execution engine is pluggable; Temporal-backed durable execution is first-class for long-horizon or human-in-the-loop workflows [43]. `AgentSpec` records can be authored as YAML/JSON files on disk and turned into agents via factory helpers — a useful pattern for keeping the agent layer in the same file-based SSOT as skills and prompts.

### 2.4 mcp-use

mcp-use is a smaller framework (TypeScript and Python) that focuses on the *client* side of MCP: connect an LLM (LangChain, ChatOpenAI, etc.) to one or more MCP servers and let an agent reason across them [26,44]. Its `MCPClient` reads a JSON config of `mcpServers` (the same shape Claude Desktop and Cursor use); its `MCPAgent` has a `use_server_manager=True` mode that intelligently selects which server's tools to load based on the current step [26]. This is a useful runtime-level mitigation for the same tool-overflow problem Anthropic's Tool Search Tool addresses at the protocol level (Section 8).

mcp-use also ships an `MCPServer` decorator API for building servers, plus a `useWidget` React hook for ChatGPT-Apps-style generative UI widgets that read typed props from an MCP tool [44].

### 2.5 OpenAI Agents SDK MCP Integration

The OpenAI Agents SDK (Python) treats MCP servers as first-class agent dependencies via `MCPServerStdio`, `MCPServerSse`, and `MCPServerStreamableHttp` [28]. Two switches matter for the bridge:

- `mcp_config["convert_schemas_to_strict"] = True` attempts to upgrade MCP input schemas to OpenAI's strict JSON Schema dialect (closed objects, required fields). This is opportunistic — it skips schemas that cannot be strictly converted [28].
- `include_server_in_tool_names = True` prefixes each MCP tool with its server name when exposed to the model, avoiding collisions when multiple servers publish a `search` tool [28].

The SDK also supports `require_approval` policies (`"always"`, `"never"`, or a per-tool dict) and an `on_approval_request` callback for human-in-the-loop confirmation before tool execution [28] — the same pattern Cloudflare's Agents framework exposes via `needsApproval` and Mastra exposes via `requireToolApproval` [45,46].

---

## 3. The Schema Layer: Pydantic, Zod, JSON Schema, and Portability

### 3.1 The Pivot Format

Across every framework surveyed, the lingua franca is JSON Schema (specifically draft 2020-12, which is what OpenAPI 3.1 and the MCP spec align on). Pydantic v2's `BaseModel.model_json_schema()` produces JSON Schema directly [47]; Zod v4's `z.toJSONSchema()` does the same on the TypeScript side [48]. Both libraries support refinements, descriptions, examples, and constrained types that round-trip cleanly to JSON Schema.

The portability question is therefore not "can my Python schema reach my TypeScript frontend?" but "which side is the source of truth?" Three strategies are in production use:

1. **Schema-first (JSON Schema as SSOT).** Both sides generate native types: `datamodel-code-generator` for Python, `json-schema-to-zod` or `quicktype` for TypeScript [49,50]. Strongest portability; weakest authoring ergonomics.
2. **Python-first (Pydantic as SSOT).** Use `pydantic-to-typescript` to emit TypeScript interfaces, or generate Zod via JSON Schema as an intermediate hop [49,51]. Tools like SyntaxSnap, openapi-fastapi-client, and the bespoke Pydantic→Zod converters all work this way [52,53].
3. **TypeScript-first (Zod as SSOT).** Use `zod-to-typescript` plus a JSON Schema export for the Python side. This is what Genkit does internally: Zod is the source, `zod-to-json-schema` produces the interchange format, `datamodel-code-generator` emits Pydantic for the Python runtime [54].

For a command-dispatch SSOT in Python, the right default is *Python-first*: author the schema in Pydantic alongside the handler (so type-checking and IDE support match the runtime), and generate everything else. The exception is when the frontend is the dominant consumer and needs Zod-native refinements that don't round-trip well through JSON Schema — in which case keep the Zod schemas hand-authored and validate alignment in CI by emitting JSON Schema from both sides and diffing.

### 3.2 The Round-Tripping Gotchas

Several Zod and Pydantic features do not survive the JSON Schema round-trip:

- **Zod transforms and refinements** carry no JSON Schema representation; they apply at parse time only [48,55].
- **Pydantic validators** (`@field_validator`, `@model_validator`) are runtime-only; they must be expressed as JSON Schema `pattern`, `minimum`, `enum`, etc., to propagate.
- **Discriminated unions** survive but the JSON Schema representation (`oneOf` + `discriminator`) is supported unevenly by clients. FastMCP automatically *dereferences* `$ref` entries in schemas because some MCP clients (notably VS Code Copilot and Claude Desktop) do not handle them robustly [33].
- **Zod v3 vs. v4.** AI SDK 5 supports both, but recommends v4 for new projects [56]. The Vercel AI SDK ecosystem still has packages pinned to Zod v3 via `zod-to-json-schema`, which is being phased out now that Zod v4 has native JSON Schema support [57].

The practical rule: keep the *command parameter schemas* declarative and shallow. Move complex validation into the handler. This is the same rule the prior frontend report arrived at independently [27].

### 3.3 Standard Schema as a Forcing Function

Standard Schema [30] is a small interface (`~standard` symbol with `validate` and `~types`) that Zod, Valibot, ArkType, and Yup all implement. It lets a framework (the MCP TypeScript SDK, the Vercel AI SDK, the OpenAI Agents SDK) accept a schema object from any library without depending on a specific one. For Python, there is no widely adopted equivalent yet — Pydantic's dominance means most frameworks just depend on Pydantic directly. The pragmatic Python equivalent is the duck-typed expectation that a schema object provides `model_json_schema()` and a `validate` method (Pydantic, msgspec, or a small Protocol wrapper around `attrs`/`dataclasses-json`).

---

## 4. Multi-Provider Tool Format Normalization

### 4.1 The Three Native Formats

The three major function-calling formats differ in envelope, response shape, and ergonomics:

**OpenAI** wraps each tool in a `{type: "function", function: {...}}` outer record and returns calls in a `tool_calls` array [5,6]:

```json
{ "type": "function", "function": { "name": "get_weather",
                                    "description": "...", "parameters": {...} } }
```

**Anthropic** uses a flatter shape with `input_schema` rather than `parameters`, and returns calls as `tool_use` content blocks interleaved with text [5,6]:

```json
{ "name": "get_weather", "description": "...", "input_schema": {...} }
```

**Google** uses `function_declarations` with `parameters` (JSON Schema), grouped under a `Tool` wrapper [5,6,7]:

```json
{ "function_declarations": [ { "name": "get_weather",
                               "description": "...", "parameters": {...} } ] }
```

The differences are syntactic, but they bite: every codebase that hardcodes one format pays a migration cost when supporting the others, and many production teams now treat this as a known anti-pattern [6,58].

### 4.2 Normalization Strategies

Three strategies are in production:

**Strategy A — OpenAI shape as canonical, transform on send.** Promptfoo defines tools once in OpenAI format and uses a `transformToolsFormat` option (`openai | anthropic | bedrock | google`) to translate at request time [8]. This is also LiteLLM's default approach: every call goes through the OpenAI-shape API, and LiteLLM transforms request and response for the target provider [9,59,60]. LiteLLM's `modify_params=True` flag additionally sanitizes messages (orphaned tool calls, empty content) before sending to Anthropic, which has stricter validation than OpenAI [61].

**Strategy B — Vercel AI SDK abstraction.** AI SDK 5's `tool({ description, inputSchema, execute })` accepts a Zod or JSON Schema, generates the right format per provider, and exposes a uniform tool-call lifecycle (`onInputAvailable`, `onOutputAvailable`) [56,62]. The SDK renamed `parameters → inputSchema` specifically to align with MCP terminology [56]. Provider modules under `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc., handle the wire-format translation.

**Strategy C — Gateway-level routing.** A self-hosted LLM gateway (LiteLLM Proxy, OpenRouter, Ofox, Apigene) presents an OpenAI-compatible endpoint to the application and routes to the underlying provider based on the model string [9,63,64]. The application code never branches on provider.

For a Python command-dispatch SSOT, the right pattern is *emit JSON Schema once, wrap into each provider's envelope at runtime*. A simple `to_openai_tool()`, `to_anthropic_tool()`, `to_google_tool()` adapter is ~30 lines per format, mechanical, and changes rarely. LiteLLM handles this for you in production; for development, the explicit adapters are easier to debug.

### 4.3 Reliability and Token Cost

Empirical reliability and cost differences across providers (early 2026 figures, with the usual caveat that these change with every model release):

- **Tool-selection accuracy.** Reported single-turn accuracy ranges: OpenAI GPT-4o 97-99%, Anthropic Claude Sonnet 4.6 96-99%, Google Gemini 3.1 Pro 95-98%, DeepSeek V4 90-95% [58]. Multi-turn tool chain reliability favors Anthropic in third-party reporting (8.4 / 10 vs. Google 7.9, OpenAI 6.3 on an AN Score benchmark) [65]. These are not bench-replicable directly; the variance across providers and across runs is large.
- **Token overhead per request with 3-5 tools.** OpenAI 200-400, Anthropic 300-500, Google 180-350, DeepSeek 150-300 [58].
- **Maximum tools per request.** OpenAI 128, Anthropic 64, Google 64, DeepSeek 32 [58]. This is the bound that motivates Section 8 (Tool Search Tool).

The implication for the SSOT: keep the *number* of registered commands well below the per-request cap, and use tagging + tool search to filter the catalogue to the active task.

---

## 5. Annotation Taxonomy for Agent Consumption

The MCP spec defines a small annotation vocabulary. The community is extending it through SEPs. Together with conventions from FastMCP, the Anthropic engineering blog, and frameworks like the OpenAI Agents SDK and Cloudflare Agents, a working taxonomy is emerging.

### 5.1 The Spec Vocabulary

The current `ToolAnnotations` interface, shipped in spec revision 2025-03-26 [2]:

```typescript
interface ToolAnnotations {
  title?: string;               // human-readable title
  readOnlyHint?: boolean;       // default: false
  destructiveHint?: boolean;    // default: true  (only meaningful if !readOnly)
  idempotentHint?: boolean;     // default: false (only meaningful if !readOnly)
  openWorldHint?: boolean;      // default: true
}
```

All four are *hints*, not contracts — a server can lie, accidentally or maliciously [3,4]. The intended use is client-side UX: auto-approve `readOnlyHint: true` from trusted servers, escalate `destructiveHint: true` to a confirmation dialog, treat `openWorldHint: true` results as untrusted input that may contain prompt-injection payloads [4].

The first three answer a preflight question — *should I confirm before calling?* `openWorldHint` is different: it matters *after* the call as well, because what comes back can contaminate the rest of the session [4]. Anthropic's MCP blog identifies the most dangerous combination as a tainted session having all three of: reads private data, sees untrusted content, can exfiltrate. Several open SEPs are proposing exactly that three-axis vocabulary so a host can refuse the combination at runtime [4].

The FastMCP Python decorator is:

```python
from fastmcp import FastMCP
from mcp.types import ToolAnnotations

mcp = FastMCP("Data Server")

@mcp.tool(annotations=ToolAnnotations(
    readOnlyHint=True, idempotentHint=True, openWorldHint=False
))
def search_products(query: str) -> list[dict]:
    """Search the product catalog."""
    ...
```

The TypeScript SDK uses the same field names inside `registerTool({ ..., annotations: {...} })` [40,66].

### 5.2 Description Style Guide

Anthropic's engineering team has been explicit that description quality is the single highest-leverage knob for tool-use accuracy [11,67]. Their internal refinement of tool descriptions produced state-of-the-art results on SWE-bench Verified [11]. The consensus style is:

- **Name = verb + object.** `create_meeting`, `send_email`, `search_products`. Avoid generic verbs like `schedule` or `notify` [12].
- **One-sentence description that states both purpose and constraint.** "List ALL calls in date range — no user/workspace filtering. To filter by user/workspace, use search_calls_extensive instead." [68]. The cross-reference to the alternative tool is doing real work; it prevents the agent from misrouting.
- **Parameter names should match user language**, not internal IDs. `user_id` is better than `user`, because the latter is ambiguous between a name, an object, and an ID [69].
- **Closed sets are enums.** If a value must be one of N options, list them in the schema. The model will pick from the enumeration; it will guess if you only describe it in prose.
- **Formats explicit.** ISO datetimes, ID patterns, URL parsing expectations spelled out. Don't make the model infer them.
- **Avoid hidden requirements.** If a tool needs context (selection, current workspace), make it an input parameter or have the server resolve it from session state — never assume.
- **`input_examples` for tools with complex nested objects.** The Claude API accepts an `input_examples` field on a tool definition that adds 20-200 tokens of cost and produces material accuracy improvements; Anthropic's internal numbers report 72% → 90% on complex parameter handling [16,67].
- **`describe()` every field.** Both Zod and Pydantic let you attach a description to each field; that string appears in the JSON Schema's `description` and the LLM reads it [40,47,48].

SEP-1382, currently in *dormant* status, proposes to make these conventions normative in the MCP specification — explicitly separating "what the tool does" (in description) from "how to format each parameter" (in schema field descriptions) [13]. Even without normative status, the SEP's analysis is the right de-facto style guide.

### 5.3 Approval and Human-in-the-Loop Annotations

Two mechanisms cover the human-in-the-loop space, and they answer different questions.

**Client-side approval** is a decision the host makes *before* calling a tool, based on its annotations or a tool-name → policy mapping. The OpenAI Agents SDK exposes this as `require_approval` on a per-server or per-tool basis with an `on_approval_request` callback that runs in Python [28]. Cloudflare Agents' `needsApproval` predicate on a tool runs synchronously to decide whether to surface a confirmation dialog [45]. Mastra's `requireToolApproval` works the same way [46]. This is the right layer for "deletion needs confirmation", "production database writes need a code review reviewer's nod".

**Server-side elicitation** is a server *pausing mid-execution* to ask the user for missing information. The MCP spec added the `elicitation` capability in revision 2025-06-18 [70]. FastMCP exposes it via `ctx.elicit()`:

```python
@mcp.tool
async def approve_action(ctx: Context) -> str:
    result = await ctx.elicit("Approve this action?", response_type=None)
    if result.action == "accept":
        return do_action()
    raise ValueError("Action rejected")
```

Elicitation works only over Streamable HTTP (it needs bidirectional notifications) and only with clients that declared the `elicitation` capability at initialization [70,71]. Use it for missing parameter collection or runtime clarification; use client-side approval for destructive-action gates.

Annotation-wise, the proposed pattern is to layer two booleans onto the spec vocabulary:

- `requiresConfirmation: true` — the host should show a confirmation UI before calling this tool, regardless of `destructiveHint`. This is the orchestration concern.
- `canElicit: true` — the tool may pause and request input mid-execution. Hosts that don't support elicitation should hide or mark the tool.

Neither is in the official spec; both can ride in the `_meta` field of the tool record (the spec reserves `_meta` for vendor extensions [1]) or as MCP server-namespaced annotations.

### 5.4 Per-User and Per-Workspace Permission Scoping

MCP authorization is built on OAuth 2.1 + PKCE with RFC 9728 Protected Resource Metadata [20]. The flow:

1. The MCP server publishes `/.well-known/oauth-protected-resource` listing its authorization servers and supported scopes [20,21].
2. The client discovers the authorization server, performs OAuth 2.1 + PKCE, obtains an access token bound to a specific *audience* (the resource identifier) [21,72].
3. Every MCP request carries the token in `Authorization: Bearer ...`. The server validates audience and scope on every call [21,72].
4. When a client lacks a scope, the server returns HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope" scope="..."` so the client knows which scope to request next [20].

Two layers of enforcement are required in production [22]:

1. **Filter `tools/list`** by the user's scope claims. Tools the user lacks scope for don't appear at all.
2. **Re-check scopes inside each handler.** Direct calls that bypass listing (a stale tool reference, a misbehaving client) still get rejected.

The annotation that surfaces this metadata is a `scopes: string[]` field per command. The Atlassian MCP Server is the canonical example of a server inheriting permissions from the underlying product rather than minting its own [23]: users see only the Jira issues and Confluence pages they already have permission to view, with real-time validation on every call and no permission elevation.

A per-workspace tool can ride on the same mechanism by encoding workspace ID in the token claims or in a custom header (`X-Workspace`). The OpenAI Agents SDK's `MCPServerSse` accepts custom headers per-server [28]; FastMCP servers can read them from request context.

### 5.5 Tagging, Categorization, and Audience

Tags solve three orthogonal problems:

- **Discoverability.** Categories like `Data`, `Admin`, `Read-only` group tools in the command palette. The previous report's command taxonomy axis (mutations vs. queries, parameterized vs. parameter-free) is exactly this [27].
- **Audience routing.** Some commands should appear on the command palette but not as MCP tools, or as MCP tools but not in the public OpenAPI surface. A `surfaces` field (`["palette", "mcp", "openapi", "cli"]`) lets emitters filter the registry.
- **Tool search keywords.** When the catalogue gets large enough to need Anthropic's Tool Search Tool, the search runs against the tool name, description, and parameter names [15,16]. Extra keywords (synonyms, jargon) can be added to the description in a structured suffix, or attached as a separate `keywords: string[]` annotation that the search index uses but the human-facing description omits.

### 5.6 Side-Effect Classification

The previous report introduced a command taxonomy with two axes [27]: mutations vs. queries, and parameterized vs. parameter-free. This maps cleanly to the MCP annotation vocabulary:

- *Query, parameter-free* → `readOnlyHint: true`, `idempotentHint: true`, generally safe to auto-approve.
- *Query, parameterized* → same hints, but the palette/UI needs schema-driven parameter collection (the prior report's `paletteHint` lives here).
- *Mutation, additive* → `readOnlyHint: false`, `destructiveHint: false`, possibly `idempotentHint: true` if the same input is a no-op on repeat.
- *Mutation, destructive* → `readOnlyHint: false`, `destructiveHint: true`, almost always `requiresConfirmation: true`.

Open-world flag (`openWorldHint: true`) is orthogonal: it tags whether the tool talks to external systems whose output should be treated as untrusted input.

---

## 6. Transport Choices

The MCP specification supports two transports today, plus a deprecated third:

**stdio** — server runs as a local subprocess, JSON-RPC over stdin/stdout [18,19]. Latency is microseconds; no auth needed (local trust boundary); single-client; no remote access. The right choice when the human running the AI client also controls the machine the server runs on [73].

**Streamable HTTP** — server provides a single HTTP endpoint that accepts POST (request → response, or POST → SSE stream for long operations), with an optional GET stream for server-initiated notifications [18,19,74]. Stateful sessions are negotiated via the `Mcp-Session-Id` header. Supports auth (OAuth 2.1, bearer tokens, mTLS), CORS, load balancers, and horizontal scaling. This is the right default for anything multi-user, hosted, or remote [73,75].

**SSE** — deprecated in spec revision 2026-03-26 [18,76]. Backward compatibility is supported in current SDKs but new servers should not use SSE. The dual-endpoint design (separate POST for client messages, separate GET for server stream) is more awkward and harder to scale than Streamable HTTP's unified endpoint [76].

For the SSOT in a Python codebase, FastMCP picks the transport at runtime based on the `transport=` argument to `mcp.run(...)` — the same `@mcp.tool`-decorated code runs over stdio for `claude mcp add` and over Streamable HTTP for production hosting [32,77]. The OpenAI Agents Python SDK has matching `MCPServerStdio`, `MCPServerStreamableHttp`, and (legacy) `MCPServerSse` classes [28]. The transport choice is purely operational; no command-level annotation depends on it.

---

## 7. Multi-Server Composition and Namespacing

Three patterns handle composition.

**Pattern 1: Mount in the server.** FastMCP's `mount()` takes a sub-server and a namespace, exposing the sub-server's tools through the parent with prefixed names [25,36,38]. Resource URIs are prefixed in the URI scheme (`resource://test` → `resource://prefix/test`) [38]. The most-recently-mounted server wins on namespace conflicts. `create_proxy(...)` lets you mount a remote MCP server (over Streamable HTTP or stdio) and re-expose it through a local parent, optionally renaming or filtering tools [38].

**Pattern 2: Compose in the client.** mcp-use's `MCPClient.from_config_file("multi.json")` connects to multiple servers and the `MCPAgent(use_server_manager=True)` selects the right one per step based on the tool the LLM picked [26]. The OpenAI Agents SDK's `include_server_in_tool_names=True` does the equivalent at the agent level: each MCP tool is exposed with a deterministic server-prefixed name to the model, while the SDK still invokes the original tool name on the original server [28].

**Pattern 3: Gateway.** An MCP gateway (Stacklok MCP Optimizer, MCP Manager, Apigene, Higress) sits between many client agents and many MCP servers, presenting a unified registry, handling auth, applying policy, and (often) implementing tool search [78]. This is the multi-tenant production pattern.

For an SSOT in a single Python codebase, mounting is the default: each domain-specific module (`commands/data/`, `commands/files/`, `commands/admin/`) defines its own FastMCP sub-server with its own decorator namespace, and a top-level `app.py` mounts them with namespace prefixes that match the module names. The namespace prefix becomes part of the tool ID and is durable across CLI invocations, MCP calls, and OpenAPI paths.

---

## 8. Tool Search, Filtering, and the Context Overflow Problem

A modest connector setup with five MCP servers can produce ~58 tools consuming ~55K tokens of context before any conversation starts [16,17]. With a typical agent stack (filesystem, GitHub, Slack, Jira, Notion, custom internal tools), tool-definition tokens routinely exceed 100K. Two consequences:

1. **Tool selection accuracy degrades.** Independent measurement on Gemini 2.5 Flash with MCP Optimizer went from 83.2% to 92.4% when the tool catalogue was filtered to relevant tools; on gpt-oss-20B the gap was 38% → 69.4% [78].
2. **Cost and latency rise.** Every request pays the full tool-definition token cost, every time.

### 8.1 Anthropic's Tool Search Tool

Anthropic shipped a protocol-level fix in November 2025 (beta header `advanced-tool-use-2025-11-20`, GA in February 2026) [14,15,16,79]. Tools are marked with `defer_loading: true` in the API request; Claude initially sees only the search tool itself (~500 tokens) plus any non-deferred tools. When Claude needs a capability, it issues a regex (`tool_search_tool_regex_20251119`) or BM25 (`tool_search_tool_bm25_20251119`) search against the deferred catalogue; matched tools are loaded into context just-in-time [15].

Anthropic's internal benchmarks: ~85% reduction in tool-definition tokens; Opus 4 jumped from 49% to 74% on MCP evaluations; Opus 4.5 from 79.5% to 88.1% [14,15,16]. Importantly, Tool Search Tool doesn't break prompt caching because deferred tools are excluded from the initial prompt entirely [15,80].

Third-party stress testing with 4,027 tools on the beta showed ~60% retrieval accuracy on straightforward tasks [17] — a real cap. The mitigation that emerged is to keep frequently-used tools as `defer_loading: false` (always loaded) and only defer the long tail. Anthropic explicitly recommends this when all tools are used per session [80].

### 8.2 Equivalents for Other Providers

Tool Search Tool is currently Anthropic-only at the protocol level. Two equivalents:

- **mcp-use's Server Manager** does the same job at the client orchestration level, intelligently routing to the right server per step [26].
- **Custom dynamic tool-loader patterns** for Google ADK and OpenAI Agents SDK have been published and benchmarked; Sascha Heyer's Google Cloud Community write-up reports 94% context reduction on the GitHub MCP server (26 tools) using a custom search-and-load callback in ADK [81]. Pydantic AI has an open issue (#3590) to support deferred loading across all providers [82].

For the SSOT, this means *tag every command* with what helps tool-search retrieval — keywords, synonyms, the domain it belongs to — and design the registry so that emitters can mark some commands as `defer_loading: false` (always loaded for the agent) based on a per-deployment policy.

---

## 9. A Worked Python Example: One Annotation Pass → MCP, Zod, CLI, OpenAPI

The example below shows a minimal command-dispatch SSOT in Python that emits all four surfaces from one annotation pass. The design rules follow the prior report's principles [27]: declarative metadata, Pydantic schemas, side-effect classification, and a flat registry with composition at the consumer level.

### 9.1 The `@command` Decorator and Registry

```python
# command_registry/core.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional
from pydantic import BaseModel

SideEffect = Literal["query", "additive", "destructive"]
Surface = Literal["palette", "cli", "mcp", "openapi"]


@dataclass
class CommandSpec:
    """Single source of truth for a registered command."""
    id: str                          # 'app.data.applyFilter'
    summary: str                     # short, palette-friendly
    description: str                 # detailed, LLM-facing
    schema: type[BaseModel]          # Pydantic input schema
    handler: Callable[..., Any]      # the function
    side_effect: SideEffect = "query"
    idempotent: bool = True
    open_world: bool = False
    requires_confirmation: bool = False
    can_elicit: bool = False
    scopes: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    surfaces: tuple[Surface, ...] = ("palette", "cli", "mcp", "openapi")
    keywords: tuple[str, ...] = ()
    examples: tuple[dict, ...] = ()
    defer_loading: bool = False


_REGISTRY: dict[str, CommandSpec] = {}


def command(
    *,
    id: str,
    summary: str,
    schema: type[BaseModel],
    side_effect: SideEffect = "query",
    idempotent: bool = True,
    open_world: bool = False,
    requires_confirmation: bool = False,
    can_elicit: bool = False,
    scopes: tuple[str, ...] = (),
    tags: tuple[str, ...] = (),
    surfaces: tuple[Surface, ...] = ("palette", "cli", "mcp", "openapi"),
    keywords: tuple[str, ...] = (),
    examples: tuple[dict, ...] = (),
    defer_loading: bool = False,
):
    """Decorator that registers a command. The docstring becomes the description."""
    def wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        description = (fn.__doc__ or summary).strip()
        spec = CommandSpec(
            id=id, summary=summary, description=description,
            schema=schema, handler=fn,
            side_effect=side_effect, idempotent=idempotent,
            open_world=open_world,
            requires_confirmation=requires_confirmation,
            can_elicit=can_elicit, scopes=scopes,
            tags=tags, surfaces=surfaces, keywords=keywords,
            examples=examples, defer_loading=defer_loading,
        )
        if id in _REGISTRY:
            raise ValueError(f"Duplicate command id: {id}")
        _REGISTRY[id] = spec
        return fn
    return wrap


def registry() -> dict[str, CommandSpec]:
    return dict(_REGISTRY)
```

### 9.2 Authoring Commands

```python
# commands/data.py
from pydantic import BaseModel, Field
from typing import Literal
from command_registry.core import command


class ApplyFilterParams(BaseModel):
    """Filter the active dataset by a column condition."""
    column: str = Field(description="Column name to filter on")
    operator: Literal["=", "!=", ">", "<", ">=", "<="] = Field(
        description="Comparison operator"
    )
    value: str | float = Field(description="Value to compare against")


@command(
    id="app.data.applyFilter",
    summary="Apply Filter",
    schema=ApplyFilterParams,
    side_effect="additive",
    idempotent=True,        # same filter twice = same state
    open_world=False,
    requires_confirmation=False,
    scopes=("data:read", "data:write"),
    tags=("data",),
    keywords=("filter", "where", "query", "predicate"),
    examples=({"column": "country", "operator": "=", "value": "France"},),
)
def apply_filter(params: ApplyFilterParams) -> dict:
    """Filter the active dataset by a column condition.

    Use when the user wants to narrow the visible rows by a single column
    predicate. For multi-column or compound predicates, use applyFilters
    instead. The filter is additive: it stacks on top of any active filter.
    """
    # ... implementation ...
    return {"ok": True, "rowsRemaining": 12_345}


@command(
    id="app.data.clearAll",
    summary="Clear All Data",
    schema=type("Empty", (BaseModel,), {}),
    side_effect="destructive",
    idempotent=True,
    open_world=False,
    requires_confirmation=True,    # always confirm
    scopes=("data:write", "data:admin"),
    tags=("data", "admin"),
)
def clear_all(_: BaseModel) -> dict:
    """Permanently clear the active dataset. Cannot be undone."""
    # ... implementation ...
    return {"ok": True}
```

### 9.3 Emitter A: MCP Server (FastMCP)

```python
# emitters/mcp_emitter.py
from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from command_registry.core import registry


def build_mcp_server(name: str = "AppMCP") -> FastMCP:
    mcp = FastMCP(name)
    for spec in registry().values():
        if "mcp" not in spec.surfaces:
            continue

        annotations = ToolAnnotations(
            title=spec.summary,
            readOnlyHint=(spec.side_effect == "query"),
            destructiveHint=(spec.side_effect == "destructive"),
            idempotentHint=spec.idempotent,
            openWorldHint=spec.open_world,
        )

        # Use spec.id directly as the tool name. FastMCP will inspect the
        # Pydantic schema and emit the right JSON Schema. The docstring is
        # already the description.
        @mcp.tool(
            name=spec.id,
            description=spec.description,
            annotations=annotations,
            meta={
                "x-side-effect": spec.side_effect,
                "x-requires-confirmation": spec.requires_confirmation,
                "x-can-elicit": spec.can_elicit,
                "x-scopes": list(spec.scopes),
                "x-tags": list(spec.tags),
                "x-keywords": list(spec.keywords),
                "x-examples": list(spec.examples),
            },
        )
        def _tool(params: spec.schema, _spec=spec):  # bind spec
            return _spec.handler(params)

    return mcp


if __name__ == "__main__":
    # Discovery side-effect: importing commands registers them.
    import commands.data  # noqa: F401
    build_mcp_server().run(transport="streamable-http", host="0.0.0.0", port=8000)
```

For per-user permission scoping, wrap the `tools/list` filter in FastMCP middleware that checks the JWT scopes on the incoming request against `spec.scopes` and hides tools the user lacks access to. Re-check inside each handler:

```python
# emitters/scope_middleware.py
from fastmcp.server.middleware import ListToolsMiddleware


class ScopeFilteringMiddleware(ListToolsMiddleware):
    async def on_list_tools(self, context, tools):
        user_scopes = set(context.auth_info.scopes)
        return [
            t for t in tools
            if set(t.meta.get("x-scopes", ())).issubset(user_scopes)
        ]
```

### 9.4 Emitter B: Zod Schemas for the Frontend

The cleanest path is Pydantic → JSON Schema → Zod. The Python side emits a JSON Schema bundle; the TypeScript build step runs `json-schema-to-zod` over it.

```python
# emitters/json_schema_emitter.py
import json
from command_registry.core import registry


def emit_json_schemas(output_path: str) -> None:
    bundle = {}
    for spec in registry().values():
        if "palette" not in spec.surfaces and "mcp" not in spec.surfaces:
            continue
        bundle[spec.id] = {
            "title": spec.summary,
            "description": spec.description,
            "inputSchema": spec.schema.model_json_schema(),
            "x-side-effect": spec.side_effect,
            "x-idempotent": spec.idempotent,
            "x-open-world": spec.open_world,
            "x-requires-confirmation": spec.requires_confirmation,
            "x-can-elicit": spec.can_elicit,
            "x-scopes": list(spec.scopes),
            "x-tags": list(spec.tags),
            "x-keywords": list(spec.keywords),
        }
    with open(output_path, "w") as f:
        json.dump(bundle, f, indent=2)
```

The frontend build step converts each entry to a Zod schema with `json-schema-to-zod` [50] or hand-authors thin wrappers in TypeScript that import the JSON. Either way, the JSON Schema is the contract; a CI step diffs the JSON Schema bundle against the previous release to catch breaking changes.

For the command palette, the same JSON file feeds the parameter form. `@autoform/zod` or `react-jsonschema-form` will render a default form from the schema, and the `x-*` extensions can drive UX details (red border for destructive, confirmation modal for `x-requires-confirmation: true`).

### 9.5 Emitter C: CLI (`argh`)

```python
# emitters/cli_emitter.py
import argh
from command_registry.core import registry


def build_cli_functions() -> list:
    """Wrap each command's handler into an argh-compatible function.

    argh inspects the function signature for the CLI, so we synthesize a
    function whose kwargs match the Pydantic schema's fields.
    """
    fns = []
    for spec in registry().values():
        if "cli" not in spec.surfaces:
            continue

        # Build kwargs signature from Pydantic fields.
        sig_parts = []
        for fname, finfo in spec.schema.model_fields.items():
            default = finfo.default if finfo.default is not None else None
            sig_parts.append((fname, finfo.annotation, default, finfo.description or ""))

        # argh works fine with kwargs functions if we use **kwargs and
        # decorate with @argh.arg per parameter. For brevity we use an
        # explicit dynamic wrapper.
        def make(spec=spec):
            schema = spec.schema

            def cmd(**kwargs):
                params = schema(**kwargs)
                return spec.handler(params)

            cmd.__name__ = spec.id.replace(".", "_")
            cmd.__doc__ = spec.description

            # Apply @argh.arg for each field to attach help text.
            for fname, _, _, descr in sig_parts:
                cmd = argh.arg(f"--{fname.replace('_', '-')}", help=descr)(cmd)
            return cmd
        fns.append(make())
    return fns


def run_cli():
    parser = argh.ArghParser()
    parser.add_commands(build_cli_functions())
    parser.dispatch()


if __name__ == "__main__":
    import commands.data  # noqa: F401
    run_cli()
```

`argh` reads type annotations and infers CLI argument types directly from the function signature; for fields with `Literal[...]` choices, argparse generates a `choices=` constraint automatically [83,84]. The `--help` output for each subcommand comes from the docstring and the per-field descriptions, so the same prose that the LLM reads is what the human reads.

### 9.6 Emitter D: OpenAPI 3.1 Document

```python
# emitters/openapi_emitter.py
import json
from command_registry.core import registry


def emit_openapi(output_path: str, base_url: str = "/v1") -> None:
    paths = {}
    components_schemas = {}
    for spec in registry().values():
        if "openapi" not in spec.surfaces:
            continue
        schema_name = spec.schema.__name__
        components_schemas[schema_name] = spec.schema.model_json_schema()
        path = f"{base_url}/commands/{spec.id.replace('.', '/')}"
        paths[path] = {
            "post": {
                "operationId": spec.id,
                "summary": spec.summary,
                "description": spec.description,
                "tags": list(spec.tags),
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {
                        "schema": {"$ref": f"#/components/schemas/{schema_name}"}
                    }},
                },
                "responses": {"200": {"description": "Success"}},
                "x-side-effect": spec.side_effect,
                "x-idempotent": spec.idempotent,
                "x-open-world": spec.open_world,
                "x-requires-confirmation": spec.requires_confirmation,
                "x-scopes": list(spec.scopes),
                "security": [{"bearerAuth": list(spec.scopes)}] if spec.scopes else [],
            }
        }

    doc = {
        "openapi": "3.1.0",
        "info": {"title": "App Commands", "version": "1.0.0"},
        "paths": paths,
        "components": {
            "schemas": components_schemas,
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer",
                               "bearerFormat": "JWT"}
            },
        },
    }
    with open(output_path, "w") as f:
        json.dump(doc, f, indent=2)
```

The OpenAPI document is then the canonical HTTP API surface. FastMCP's `FastMCP.from_openapi(...)` can read this same document and produce a separate MCP server [34,35] — useful when a deployment wants to expose its existing HTTP API to MCP clients without rebuilding it through the command registry. The two paths converge.

### 9.7 The Full Pipeline

```bash
# build.sh
python -m emitters.json_schema_emitter   schemas/commands.json
python -m emitters.openapi_emitter       openapi/commands.json
# Frontend build step (in package.json):
#   "build:schemas": "json-schema-to-zod -i ../schemas/commands.json -o src/commands.gen.ts"
```

At runtime:

```bash
# Run the MCP server (Streamable HTTP)
python -m emitters.mcp_emitter

# Run as a CLI
python -m emitters.cli_emitter app_data_applyFilter --column country --operator = --value France

# Serve the OpenAPI doc + handlers via FastAPI
python -m emitters.fastapi_emitter
```

One command definition. Four surfaces. No drift. Changes to the schema propagate everywhere; CI diffs against the previous JSON Schema bundle to catch breaking changes.

For multi-provider tool catalogues (OpenAI / Anthropic / Google function-calling), a fifth emitter is mechanical:

```python
def to_openai_tool(spec) -> dict:
    return {"type": "function", "function": {
        "name": spec.id,
        "description": spec.description,
        "parameters": spec.schema.model_json_schema(),
    }}


def to_anthropic_tool(spec) -> dict:
    return {"name": spec.id,
            "description": spec.description,
            "input_schema": spec.schema.model_json_schema()}


def to_gemini_tool(spec) -> dict:
    return {"name": spec.id,
            "description": spec.description,
            "parameters": spec.schema.model_json_schema()}
```

Or, in practice, hand the JSON Schema to LiteLLM or the AI SDK and let them do the per-provider envelope translation [9,56].

---

## 10. Recommended Annotation Taxonomy (Compatible with the Skill SSOT)

The previous Prompt 2 report [85] recommended a filesystem-first SSOT for prompts and skills, with YAML frontmatter following the Anthropic Agent Skills spec and a Prompty-compatible model/inputs block. The annotation taxonomy below extends that pattern to commands so a single Git repository can hold prompts, skills, and commands under one frontmatter convention.

### 10.1 The Annotation Taxonomy

A command is fully described by the union of:

1. **Pydantic schema** for input (and optionally output). The schema lives in code, alongside the handler.
2. **Decorator metadata** (`@command(...)`) for everything else.

The metadata fields, in priority order:

| Field | Type | Purpose | Emits to |
|------|------|---------|----------|
| `id` | dotted string | stable global identifier | every surface |
| `summary` | short string | palette label, OpenAPI summary, annotation title | palette, OpenAPI, MCP `annotations.title` |
| `description` | docstring | the prompt the LLM reads | MCP, OpenAI/Anthropic/Google, OpenAPI |
| `schema` | Pydantic class | input contract | every surface |
| `side_effect` | `query` \| `additive` \| `destructive` | derives `readOnlyHint`, `destructiveHint` | MCP annotations, OpenAPI `x-side-effect` |
| `idempotent` | bool | `idempotentHint` | MCP annotations |
| `open_world` | bool | `openWorldHint` | MCP annotations |
| `requires_confirmation` | bool | host-side approval gate | MCP `_meta`, frontend `x-requires-confirmation` |
| `can_elicit` | bool | server may pause mid-execution | MCP `_meta`, hidden on clients that don't support elicitation |
| `scopes` | tuple[str] | OAuth scopes required | OpenAPI `security`, MCP scope filter |
| `tags` | tuple[str] | grouping / palette category | every surface |
| `surfaces` | tuple[Surface] | emitter routing | controls which emitters include the command |
| `keywords` | tuple[str] | tool-search hints | MCP `_meta`, tool-search index |
| `examples` | tuple[dict] | `input_examples` for the API | Anthropic `input_examples`, palette autofill |
| `defer_loading` | bool | mark for tool-search deferral | MCP `defer_loading` |

### 10.2 The File-Based Skill SSOT Pattern, Extended

For commands that are best authored as files (skills, prompts, long-form instructions), the same metadata maps to YAML frontmatter:

```markdown
---
name: app.data.applyFilter
summary: Apply Filter
description: |
  Filter the active dataset by a column condition. Use when the user wants
  to narrow the visible rows by a single column predicate. For multi-column
  or compound predicates, use applyFilters instead. The filter is additive:
  it stacks on top of any active filter.
type: command                       # text | chat | skill | command
schema:                             # JSON Schema, or $ref to a Pydantic class
  $ref: "python:commands.data:ApplyFilterParams"
side_effect: additive
idempotent: true
open_world: false
requires_confirmation: false
can_elicit: false
scopes: [data:read, data:write]
tags: [data]
surfaces: [palette, cli, mcp, openapi]
keywords: [filter, where, query, predicate]
defer_loading: false
metadata:
  version: "1.2.0"
  owner: data-team
  labels: [production]
---

# applyFilter

Detailed body, examples, edge cases — read by humans, optionally read by the
agent via progressive disclosure.
```

The frontmatter is a strict superset of the Agent Skills spec (`name`, `description`) and the Prompty spec (`model`, `inputs`) [85,86,87]. A skill is just a command whose handler is the LLM itself with the file body as instructions; a command is a skill with a Python handler. The same loader serves both.

### 10.3 The Build / CI Story

1. **Discovery.** A loader scans `commands/**/*.py` for `@command`-decorated functions and `prompts/**/*.md` for frontmatter files. Both populate the same in-memory registry, keyed by `id`.
2. **Validation.** A CI step ensures every required field is present, every `id` is unique, every schema is valid Pydantic, every `scopes` value is in a known scope catalogue.
3. **Emission.** The four emitters above run as build steps; outputs are checked into the repository or published as artifacts. The JSON Schema bundle, the OpenAPI document, and the generated Zod / TypeScript types are all reviewable in PRs.
4. **Drift detection.** A CI step diffs the current JSON Schema bundle against the previous release and fails the build on a breaking change without a version bump.
5. **Versioning.** Each command carries a SemVer; the SQLite index from the Prompt 2 report [85] now also indexes commands, making `name`, `tags`, `scopes`, and `version` all queryable from a single store.

### 10.4 What This Buys You

- **One source of truth.** The Pydantic schema and the decorator metadata define the command. Everything else is derived.
- **No format drift.** A change to a parameter description propagates to MCP, the OpenAPI doc, the CLI help, the frontend type, and the agent prompt — atomically.
- **Per-user scoping for free.** The OAuth scopes are declared once and enforced at both the `tools/list` filter and the handler check.
- **Tool-search-ready.** Keywords and tags feed the search index; the `defer_loading` flag lets you scale to hundreds of commands without context overflow.
- **Skills and commands share infrastructure.** The same loader, index, version system, and CI pipeline serve both.
- **Cross-provider portability.** The JSON Schema bundle is the canonical artefact; the LiteLLM, AI SDK, or hand-rolled adapter wraps it into each provider's envelope at runtime.

---

## 11. Open Questions and Things to Watch

- **Annotation enforcement.** The current `ToolAnnotations` are hints; spec work to make some annotations runtime-enforced (or at least runtime-detectable for the lethal trifecta) is active in SEPs but not yet normative [4]. Until then, host-side policies are the only defense.
- **Tool Search Tool retrieval accuracy.** Anthropic's reported 60-90% accuracy range across catalogue sizes is real but variable [17]. Custom embeddings (the third option after regex and BM25) help on domain-specific catalogues but require ongoing index maintenance.
- **Pydantic AI's universal Tool Search.** Pydantic AI issue #3590 proposes a provider-agnostic deferred-loading implementation [82]. If it lands, it will close the Anthropic-only gap.
- **Elicitation interop.** OpenAI's Apps SDK indicates ChatGPT supports elicitations as an MCP client, but framework support across other clients is uneven [70,88]. Setting `can_elicit: true` on commands is the right marker; whether the client honors it varies.
- **SEP-1382.** If the documentation-best-practices SEP graduates, the description-vs-schema convention becomes normative and tool descriptions across the ecosystem will converge faster.
- **Multi-tenant gateway runtimes.** Stacklok MCP Optimizer, Arcade, MCP Manager, Apigene are converging on a stack that pairs auth, observability, policy, and tool search at the gateway layer [78]. For multi-user production deployments, this layer will likely become standard infrastructure.

---

## REFERENCES

[1] Model Context Protocol — Tools concept. [https://modelcontextprotocol.io/specification/2025-06-18/server/tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

[2] Model Context Protocol Blog — Tool Annotations as Risk Vocabulary, March 2026. [https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)

[3] MCP Tool Annotations Explained (Instagit). [https://instagit.com/modelcontextprotocol/servers/what-are-mcp-tool-annotations/](https://instagit.com/modelcontextprotocol/servers/what-are-mcp-tool-annotations/)

[4] MCP Tool Annotations Explained — Hints, Trust, and the Risk Vocabulary (ChatForest, 2026). [https://chatforest.com/guides/mcp-tool-annotations-explained/](https://chatforest.com/guides/mcp-tool-annotations-explained/)

[5] Function Calling & Tool Use: The Complete Guide for GPT, Claude, and Gemini (Ofox.ai, 2026). [https://ofox.ai/blog/function-calling-tool-use-complete-guide-2026/](https://ofox.ai/blog/function-calling-tool-use-complete-guide-2026/)

[6] AI Function Calling Guide: OpenAI, Anthropic, Google (Digital Applied, 2026). [https://www.digitalapplied.com/blog/ai-function-calling-guide-openai-anthropic-google](https://www.digitalapplied.com/blog/ai-function-calling-guide-openai-anthropic-google)

[7] What Is Agent Skills as an Open Standard? (MindStudio, 2026). [https://www.mindstudio.ai/blog/agent-skills-open-standard-claude-openai-google](https://www.mindstudio.ai/blog/agent-skills-open-standard-claude-openai-google)

[8] Promptfoo — Tool Calling. [https://www.promptfoo.dev/docs/configuration/tools/](https://www.promptfoo.dev/docs/configuration/tools/)

[9] LiteLLM — Provider Integrations and OpenAI-format normalization. [https://docs.litellm.ai/docs/](https://docs.litellm.ai/docs/)

[10] LiteLLM — Anthropic provider docs (tools, tool_choice, structured outputs). [https://docs.litellm.ai/docs/providers/anthropic](https://docs.litellm.ai/docs/providers/anthropic)

[11] Anthropic Engineering — Writing effective tools for AI agents — using agents. [https://www.anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

[12] Arcade.dev — How to Write MCP Tool Definitions That LLMs Understand. [https://www.arcade.dev/blog/mcp-tool-definitions-guide/](https://www.arcade.dev/blog/mcp-tool-definitions-guide/)

[13] SEP-1382: Documentation Best Practices for MCP Tools. [https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382)

[14] Anthropic — Tool Search Tool API docs. [https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

[15] What Anthropic's Tool Search Means for Production AI (Arcade.dev). [https://blog.arcade.dev/anthropic-tool-search-claude-mcp-runtime](https://blog.arcade.dev/anthropic-tool-search-claude-mcp-runtime)

[16] Anthropic Just Shipped the Fix for Tool Definition Bloat (Deb Acharjee, 2026). [https://medium.com/@DebaA/anthropic-just-shipped-the-fix-for-tool-definition-bloat-77464c8dbec9](https://medium.com/@DebaA/anthropic-just-shipped-the-fix-for-tool-definition-bloat-77464c8dbec9)

[17] Arcade.dev — Tool Search Test: 4,000 Tools, 60% Success. [https://www.arcade.dev/blog/anthropic-tool-search-4000-tools-test/](https://www.arcade.dev/blog/anthropic-tool-search-4000-tools-test/)

[18] MCP Transport Protocols: stdio vs SSE vs StreamableHTTP (MCPcat). [https://mcpcat.io/guides/comparing-stdio-sse-streamablehttp/](https://mcpcat.io/guides/comparing-stdio-sse-streamablehttp/)

[19] Understanding MCP Server Transports: STDIO, SSE, and HTTP Streamable (DEV Community, 2026). [https://dev.to/zoricic/understanding-mcp-server-transports-stdio-sse-and-http-streamable-5b1p](https://dev.to/zoricic/understanding-mcp-server-transports-stdio-sse-and-http-streamable-5b1p)

[20] Model Context Protocol — Authorization (specification draft). [https://modelcontextprotocol.io/specification/draft/basic/authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)

[21] OAuth for MCP Explained (MCP Manager). [https://mcpmanager.ai/blog/oauth-for-mcp/](https://mcpmanager.ai/blog/oauth-for-mcp/)

[22] systemprompt.io — MCP Server Authentication With OAuth 2.1 and Least Privilege. [https://systemprompt.io/guides/mcp-server-authentication-security](https://systemprompt.io/guides/mcp-server-authentication-security)

[23] Managing User Access and Permissions — Atlassian MCP Server (DeepWiki). [https://deepwiki.com/atlassian/atlassian-mcp-server/6.2-managing-user-access-and-permissions](https://deepwiki.com/atlassian/atlassian-mcp-server/6.2-managing-user-access-and-permissions)

[24] OpenAI Agents Python SDK — MCP integration. [https://openai.github.io/openai-agents-python/mcp/](https://openai.github.io/openai-agents-python/mcp/)

[25] FastMCP — Composing Servers (mount, import_server, namespacing). [https://gofastmcp.com/servers/composition](https://gofastmcp.com/servers/composition)

[26] mcp-use — PyPI / GitHub (multi-server client + Server Manager). [https://pypi.org/project/mcp-use/](https://pypi.org/project/mcp-use/)

[27] T. Whalen, *The Command Dispatch Architecture: A Unifying Primitive for Multi-Surface Frontend Applications*. Prior unpublished working paper (in this Project).

[28] OpenAI Agents Python SDK — Model context protocol (transports, approvals, server-name prefixing). [https://openai.github.io/openai-agents-python/mcp/](https://openai.github.io/openai-agents-python/mcp/)

[29] modelcontextprotocol/typescript-sdk — README and Standard Schema support. [https://github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)

[30] Standard Schema specification. [https://standardschema.dev/](https://standardschema.dev/)

[31] FastMCP — PyPI. [https://pypi.org/project/fastmcp/](https://pypi.org/project/fastmcp/)

[32] Building an MCP Server and Client with FastMCP 2.0 (DataCamp). [https://www.datacamp.com/tutorial/building-mcp-server-client-fastmcp](https://www.datacamp.com/tutorial/building-mcp-server-client-fastmcp)

[33] FastMCP — Tools docs (decorators, annotations, structured content, $ref dereferencing). [https://gofastmcp.com/servers/tools](https://gofastmcp.com/servers/tools)

[34] FastMCP — OpenAPI 🤝 FastMCP. [https://gofastmcp.com/integrations/openapi](https://gofastmcp.com/integrations/openapi)

[35] Generate MCP servers from OpenAPI documents (Speakeasy). [https://www.speakeasy.com/blog/generate-mcp-from-openapi](https://www.speakeasy.com/blog/generate-mcp-from-openapi)

[36] MCP Server Composition: Build Big by Thinking Small (S. Balakrishnan). [https://medium.com/@sureshddm/mcp-server-composition-build-big-by-thinking-small-adfa826d7440](https://medium.com/@sureshddm/mcp-server-composition-build-big-by-thinking-small-adfa826d7440)

[37] FastMCP — User Elicitation. [https://gofastmcp.com/servers/elicitation](https://gofastmcp.com/servers/elicitation)

[38] What's New in FastMCP 3.0 (jlowin.dev). [https://jlowin.dev/blog/fastmcp-3-whats-new](https://jlowin.dev/blog/fastmcp-3-whats-new)

[39] Add Custom Tools to TypeScript MCP Servers (MCPcat). [https://mcpcat.io/guides/adding-custom-tools-mcp-server-typescript/](https://mcpcat.io/guides/adding-custom-tools-mcp-server-typescript/)

[40] Tool Registration and Execution — modelcontextprotocol/typescript-sdk (DeepWiki). [https://deepwiki.com/modelcontextprotocol/typescript-sdk/3.2-tool-registration-and-execution](https://deepwiki.com/modelcontextprotocol/typescript-sdk/3.2-tool-registration-and-execution)

[41] punkpeye/mcp-types — Zod schemas without passthrough. [https://github.com/punkpeye/mcp-types](https://github.com/punkpeye/mcp-types)

[42] Anthropic — Building Effective Agents. [https://anthropic.com/research/building-effective-agents](https://anthropic.com/research/building-effective-agents)

[43] lastmile-ai/mcp-agent — GitHub. [https://github.com/lastmile-ai/mcp-agent](https://github.com/lastmile-ai/mcp-agent)

[44] mcp-use/mcp-use — GitHub. [https://github.com/mcp-use/mcp-use](https://github.com/mcp-use/mcp-use)

[45] Cloudflare Agents — Human-in-the-Loop patterns. [https://developers.cloudflare.com/agents/guides/human-in-the-loop/](https://developers.cloudflare.com/agents/guides/human-in-the-loop/)

[46] Mastra — MCPClient reference (requireToolApproval, elicitation handlers). [https://mastra.ai/reference/tools/mcp-client](https://mastra.ai/reference/tools/mcp-client)

[47] Pydantic — JSON Schema. [https://docs.pydantic.dev/latest/concepts/json_schema/](https://docs.pydantic.dev/latest/concepts/json_schema/)

[48] Zod — Intro and JSON Schema generation. [https://zod.dev/](https://zod.dev/) and [https://zod.dev/json-schema](https://zod.dev/json-schema)

[49] pydantic-to-typescript — PyPI. [https://pypi.org/project/pydantic-to-typescript/](https://pypi.org/project/pydantic-to-typescript/)

[50] json-schema-to-zod — npm. [https://www.npmjs.com/package/json-schema-to-zod](https://www.npmjs.com/package/json-schema-to-zod)

[51] Online Pydantic to Zod Converter (SyntaxSnap). [https://syntaxsnap.com/tools/pydantic-to-zod](https://syntaxsnap.com/tools/pydantic-to-zod)

[52] Pydantic vs Zod: Complete Comparison for JSON Schema Generation (SuperJSON). [https://superjson.ai/blog/2025-08-14-pydantic-vs-zod-json-schema-generation-comparison/](https://superjson.ai/blog/2025-08-14-pydantic-vs-zod-json-schema-generation-comparison/)

[53] How to Generate Pydantic Models from JSON (SuperJSON). [https://superjson.ai/blog/2025-08-12-how-to-generate-pydantic-models-from-json/](https://superjson.ai/blog/2025-08-12-how-to-generate-pydantic-models-from-json/)

[54] Schema conversion and validation — firebase/genkit (DeepWiki). [https://deepwiki.com/firebase/genkit/9.2-schema-conversion-and-validation](https://deepwiki.com/firebase/genkit/9.2-schema-conversion-and-validation)

[55] End-to-End TypeScript Types in MCP Apps (sunpeak.ai). [https://sunpeak.ai/blogs/mcp-app-typescript-types/](https://sunpeak.ai/blogs/mcp-app-typescript-types/)

[56] AI SDK 5 — Vercel announcement (inputSchema rename, Zod v4 support). [https://vercel.com/blog/ai-sdk-5](https://vercel.com/blog/ai-sdk-5)

[57] Vercel AI SDK — Foundations: Tools. [https://ai-sdk.dev/docs/foundations/tools](https://ai-sdk.dev/docs/foundations/tools)

[58] Function Calling and Tool Use Guide 2026 — OpenAI, Anthropic, Google, DeepSeek (TokenMix). [https://tokenmix.ai/blog/function-calling-guide](https://tokenmix.ai/blog/function-calling-guide)

[59] BerriAI/litellm — GitHub. [https://github.com/BerriAI/litellm](https://github.com/BerriAI/litellm)

[60] Provider Integrations — BerriAI/litellm (DeepWiki). [https://deepwiki.com/BerriAI/litellm/2.4-responses-api-and-advanced-features](https://deepwiki.com/BerriAI/litellm/2.4-responses-api-and-advanced-features)

[61] LiteLLM — Message Sanitization for Tool Calling. [https://docs.litellm.ai/docs/completion/message_sanitization](https://docs.litellm.ai/docs/completion/message_sanitization)

[62] Vercel AI SDK — main docs. [https://vercel.com/docs/ai-sdk](https://vercel.com/docs/ai-sdk)

[63] LLM API Comparison — OpenAI vs Anthropic vs Google vs Mistral (MyEngineeringPath, 2026). [https://myengineeringpath.dev/tools/llm-api-comparison/](https://myengineeringpath.dev/tools/llm-api-comparison/)

[64] MCP SSE vs Stdio: Transport Options Explained (Apigene, 2026). [https://apigene.ai/blog/mcp-sse-vs-stdio](https://apigene.ai/blog/mcp-sse-vs-stdio)

[65] LLM APIs for AI Agents: Anthropic vs OpenAI vs Google AI (DEV Community / Supertrained, 2026). [https://dev.to/supertrained/llm-apis-for-ai-agents-anthropic-vs-openai-vs-google-ai-an-score-data-3e1j](https://dev.to/supertrained/llm-apis-for-ai-agents-anthropic-vs-openai-vs-google-ai-an-score-data-3e1j)

[66] Claude Agent SDK reference — TypeScript (tool annotations example). [https://code.claude.com/docs/en/agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript)

[67] Anthropic — Define tools (Claude API docs, input_examples). [https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)

[68] MCP tool descriptions: overview, examples, and best practices (Merge.dev). [https://www.merge.dev/blog/mcp-tool-description](https://www.merge.dev/blog/mcp-tool-description)

[69] How Anthropic Builds Tools for Agents — An Agent-Centric Approach. [https://medium.com/@AoO.ai/how-anthropic-builds-tools-for-agents-an-agent-centric-approach-5b068803135a](https://medium.com/@AoO.ai/how-anthropic-builds-tools-for-agents-an-agent-centric-approach-5b068803135a)

[70] How Elicitation in MCP Brings Human-in-the-Loop to AI Tools (The New Stack). [https://thenewstack.io/how-elicitation-in-mcp-brings-human-in-the-loop-to-ai-tools/](https://thenewstack.io/how-elicitation-in-mcp-brings-human-in-the-loop-to-ai-tools/)

[71] Enabling Human-in-the-Loop Workflows with MCP Elicitation (Glama). [https://glama.ai/blog/2025-09-03-elicitation-in-mcp-bridging-the-human-ai-gap](https://glama.ai/blog/2025-09-03-elicitation-in-mcp-bridging-the-human-ai-gap)

[72] MCP Authentication: OAuth, API Keys, and Security Best Practices (Runyard). [https://runyard.io/blog/mcp-authentication-security](https://runyard.io/blog/mcp-authentication-security)

[73] MCP Transports Explained: stdio vs Streamable HTTP (DEV Community). [https://dev.to/jefe_cool/mcp-transports-explained-stdio-vs-streamable-http-and-when-to-use-each-3lco](https://dev.to/jefe_cool/mcp-transports-explained-stdio-vs-streamable-http-and-when-to-use-each-3lco)

[74] SSE vs Streamable HTTP: Why MCP Switched Transport Protocols (Bright Data). [https://brightdata.com/blog/ai/sse-vs-streamable-http](https://brightdata.com/blog/ai/sse-vs-streamable-http)

[75] Stdio vs SSE vs HTTP MCP: Transport Trade-Offs in Production (PADISO). [https://www.padiso.co/blog/stdio-vs-sse-vs-http-mcp-transport-trade-offs/](https://www.padiso.co/blog/stdio-vs-sse-vs-http-mcp-transport-trade-offs/)

[76] stdio vs Streamable HTTP: Choosing the Right MCP Transport (K. Ryan). [https://kirkryan.co.uk/stdio-vs-streamable-http-choosing-the-right-mcp-transport/](https://kirkryan.co.uk/stdio-vs-streamable-http-choosing-the-right-mcp-transport/)

[77] I built an MCP server in one weekend — what FastMCP made easy (DEV Community). [https://dev.to/vdalhambra/i-built-an-mcp-server-in-one-weekend-heres-what-fastmcp-made-easy-and-what-it-didnt-2dp3](https://dev.to/vdalhambra/i-built-an-mcp-server-in-one-weekend-heres-what-fastmcp-made-easy-and-what-it-didnt-2dp3)

[78] Stacklok MCP Optimizer vs Anthropic's Tool Search Tool — head-to-head (DEV Community). [https://dev.to/stacklok/stackloks-mcp-optimizer-vs-anthropics-tool-search-tool-a-head-to-head-comparison-2f32](https://dev.to/stacklok/stackloks-mcp-optimizer-vs-anthropics-tool-search-tool-a-head-to-head-comparison-2f32)

[79] Scaling MCP Tools with Anthropic's Defer Loading (Unified.to). [https://unified.to/blog/scaling_mcp_tools_with_anthropic_defer_loading](https://unified.to/blog/scaling_mcp_tools_with_anthropic_defer_loading)

[80] What is MCP Tool Search? — Claude Code feature that fixes context pollution (atcyrus.com). [https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide)

[81] Implementing Anthropic-style Dynamic Tool Search Tool (S. Heyer / Google Cloud Community). [https://medium.com/google-cloud/implementing-anthropic-style-dynamic-tool-search-tool-f39d02a35139](https://medium.com/google-cloud/implementing-anthropic-style-dynamic-tool-search-tool-f39d02a35139)

[82] Pydantic AI — Issue #3590: Support deferred loading of tools and discovery via tool search tool. [https://github.com/pydantic/pydantic-ai/issues/3590](https://github.com/pydantic/pydantic-ai/issues/3590)

[83] argh — Tutorial. [https://argh.readthedocs.io/en/latest/tutorial.html](https://argh.readthedocs.io/en/latest/tutorial.html)

[84] argh — PyPI. [https://pypi.org/project/argh/](https://pypi.org/project/argh/)

[85] T. Whalen, *Patterns and Tools for Managing System Prompts, User-Editable Prompts, and Skills in Production AI Applications*, May 18, 2026 (in this Project).

[86] Prompty — Microsoft. [https://github.com/microsoft/prompty](https://github.com/microsoft/prompty)

[87] Anthropic — Agent Skills open standard. [https://www.anthropic.com/news/agent-skills](https://www.anthropic.com/news/agent-skills)

[88] LibreChat discussion — Support for human-in-the-loop / elicitations from MCP servers. [https://github.com/danny-avila/LibreChat/discussions/8681](https://github.com/danny-avila/LibreChat/discussions/8681)
