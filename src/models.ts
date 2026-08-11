/**
 * Model registry — the single source of truth for which Claude model ids
 * the proxy knows about.
 *
 * Every consumer derives from this list:
 *   - `extractModel` (src/adapter/openai-to-cli.ts) — request model → `claude --model` value
 *   - `AVAILABLE_MODELS` (src/index.ts) — openclaw plugin provider definitions
 *   - `handleModels` (src/server/routes.ts) — GET /models and /v1/models
 *   - `canonicalizeModelLabel` (below) — bounded /metrics label set
 *
 * Model ids NOT in this registry are still routable: any id matching
 * `claude-*` is passed verbatim to the Claude CLI's `--model` flag, so
 * future models work without a code change (see `isPassthroughModelId`).
 * The registry only controls what is *advertised* and how it is labeled.
 */

export interface ModelEntry {
  /** Public model id as clients send it (and as advertised). */
  id: string;
  /** Human-readable name for provider definitions. */
  name: string;
  /** Value passed to `claude --model` (usually the id; short alias for legacy rows). */
  cliTarget: string;
  /** Whether the model supports (adaptive) reasoning/thinking. */
  reasoning: boolean;
  /** Context window advertised to clients. */
  contextWindow: number;
  /** Listed in GET /models and the openclaw plugin definitions. */
  advertised: boolean;
}

export const MODEL_REGISTRY: ModelEntry[] = [
  // ── Current generation ──────────────────────────────────────────
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    cliTarget: "claude-fable-5",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    cliTarget: "claude-opus-5",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    cliTarget: "claude-sonnet-5",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  // ── Previous generation ─────────────────────────────────────────
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    cliTarget: "claude-opus-4-8",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    cliTarget: "claude-opus-4-7",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    cliTarget: "claude-opus-4-6",
    reasoning: true,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    cliTarget: "claude-sonnet-4-6",
    reasoning: false,
    contextWindow: 1_000_000,
    advertised: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    cliTarget: "claude-haiku-4-5-20251001",
    reasoning: false,
    contextWindow: 200_000,
    advertised: true,
  },
  // ── Hidden (routable but not advertised) ────────────────────────
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    cliTarget: "claude-sonnet-4-5",
    reasoning: false,
    contextWindow: 200_000,
    advertised: false,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    cliTarget: "claude-haiku-4-5",
    reasoning: false,
    contextWindow: 200_000,
    advertised: false,
  },
  // ── Legacy aliases ──────────────────────────────────────────────
  {
    id: "claude-opus-4",
    name: "Claude Opus 4 (legacy alias)",
    cliTarget: "opus",
    reasoning: true,
    contextWindow: 200_000,
    advertised: true,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4 (legacy alias)",
    cliTarget: "sonnet",
    reasoning: false,
    contextWindow: 200_000,
    advertised: true,
  },
  {
    id: "claude-haiku-4",
    name: "Claude Haiku 4 (legacy alias)",
    cliTarget: "haiku",
    reasoning: false,
    contextWindow: 200_000,
    advertised: true,
  },
];

const REGISTRY_BY_ID = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));

/** Ids advertised via GET /models and the openclaw plugin definitions. */
export function advertisedModelIds(): string[] {
  return MODEL_REGISTRY.filter((m) => m.advertised).map((m) => m.id);
}

/** All registry ids, including hidden ones. */
export function allRegistryIds(): string[] {
  return MODEL_REGISTRY.map((m) => m.id);
}

/** Registry lookup by bare (prefix-stripped) id. */
export function registryEntry(id: string): ModelEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

/** Strip a `claude-proxy/` or `claude-code-cli/` provider prefix. */
export function stripProviderPrefix(model: string): string {
  return model.replace(/^(claude-proxy|claude-code-cli)\//, "");
}

/**
 * Unknown-but-plausible Claude model id. These are passed verbatim to
 * `claude --model` so future models are supported without a proxy release.
 * The Claude CLI / API is the final validator.
 */
export function isPassthroughModelId(model: string): boolean {
  return /^claude-[a-z0-9][a-z0-9.-]*$/i.test(model);
}

const REGISTRY_LABELS = new Set(allRegistryIds());

/**
 * Reduce arbitrary client-provided model strings to a bounded label set for
 * /metrics. Registry ids label as themselves; ids in `extraLabels` (e.g.
 * dynamically discovered models — a set bounded by the Anthropic Models API)
 * also label as themselves; everything else collapses to "other".
 */
export function canonicalizeModelLabel(
  model: string | undefined,
  extraLabels?: ReadonlySet<string>,
): string {
  if (!model) return "unknown";
  const stripped = stripProviderPrefix(model);
  if (REGISTRY_LABELS.has(stripped)) return stripped;
  if (extraLabels?.has(stripped)) return stripped;
  return "other";
}
