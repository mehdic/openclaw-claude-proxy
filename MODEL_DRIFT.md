# Model registry — single source of truth (supersedes the 2026-04-29 drift audit)

The drift documented in the original version of this file is resolved. All
model lists now derive from **one registry**: `MODEL_REGISTRY` in
`src/models.ts`.

| Consumer | File | Derivation |
|---|---|---|
| `extractModel` | `src/adapter/openai-to-cli.ts` | registry lookup (both provider prefixes) + passthrough |
| `AVAILABLE_MODELS` | `src/index.ts` | `MODEL_REGISTRY.filter(m => m.advertised)` |
| `handleModels` (`GET /models`, `/v1/models`) | `src/server/routes.ts` | `advertisedModelIds()` + live discovery |
| `/metrics` model labels | `src/models.ts` `canonicalizeModelLabel` | all registry ids + discovered ids |

## Adding a new model

Add **one entry** to `MODEL_REGISTRY` in `src/models.ts` (id, name,
cliTarget, reasoning, contextWindow, advertised) and, if the price differs
from its family, a row in `FALLBACK_PRICING` + a `normalizeModel` prefix
rule in `src/server/pricing.ts`. Nothing else to keep in sync;
`src/__tests__/model-drift.test.ts` validates the derivations.

## Future models work without a release

Two mechanisms make unreleased models usable the day Anthropic ships them:

1. **Verbatim passthrough (routing).** Any request model matching
   `claude-*` that isn't in the registry is passed straight to
   `claude --model <id>`. The Claude CLI/API is the final validator. So
   `claude-opus-6` works as soon as the installed Claude CLI supports it.
   Non-`claude-*` ids still default to `opus`.
2. **Live discovery (listing, optional).** When `ANTHROPIC_API_KEY` is set,
   `GET /models` merges ids from the Anthropic Models API
   (`https://api.anthropic.com/v1/models`) into the static list
   (`src/server/model-discovery.ts`; cached 1 h, 5 min backoff on failure,
   silent fallback to the static list). Discovered ids also become valid
   `/metrics` labels (bounded — the API list is finite). Disable with
   `CLAUDE_PROXY_MODEL_DISCOVERY=off`. Without an API key (plain Claude
   Max subscription auth) discovery is skipped and the static registry
   list is served.

## Metrics cardinality

`canonicalizeModelLabel` labels registry ids and discovered ids as
themselves; everything else collapses to `"other"`. Passthrough-routing a
model does **not** create a new metrics label — only registry membership or
API discovery does, so cardinality stays bounded.

## Hidden models

`claude-sonnet-4-5` and `claude-haiku-4-5` remain routable but
unadvertised (`advertised: false`) — same behavior as before the refactor.
The legacy aliases (`claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`)
are now advertised everywhere (previously `claude-haiku-4` was missing from
the openclaw plugin definitions — that drift is gone).
