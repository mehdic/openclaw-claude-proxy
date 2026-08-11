/**
 * MODEL_DRIFT hygiene test.
 *
 * All model lists (extractModel routing, AVAILABLE_MODELS, handleModels,
 * /metrics labels) now derive from the single registry in src/models.ts,
 * so drift between them is impossible by construction. This test validates
 * the derivations and the passthrough behavior for unknown claude-* ids.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { extractModel } from "../adapter/openai-to-cli.js";
import {
  MODEL_REGISTRY,
  advertisedModelIds,
  allRegistryIds,
  canonicalizeModelLabel,
  isPassthroughModelId,
} from "../models.js";

test("current-generation models are registered and advertised", () => {
  const advertised = new Set(advertisedModelIds());
  for (const id of ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8"]) {
    assert.ok(advertised.has(id), `expected "${id}" to be advertised`);
  }
});

test("every registry id is routable via extractModel to its cliTarget", () => {
  for (const entry of MODEL_REGISTRY) {
    assert.equal(extractModel(entry.id), entry.cliTarget, `"${entry.id}" should route to "${entry.cliTarget}"`);
  }
});

test("provider-prefixed models resolve the same as bare ids", () => {
  const prefixes = ["claude-proxy/", "claude-code-cli/"];
  for (const prefix of prefixes) {
    for (const id of allRegistryIds()) {
      const bare = extractModel(id);
      const prefixed = extractModel(`${prefix}${id}`);
      assert.equal(prefixed, bare, `"${prefix}${id}" resolves to "${prefixed}" but bare "${id}" resolves to "${bare}"`);
    }
  }
});

test("short aliases resolve to expected models", () => {
  assert.equal(extractModel("opus"), "opus");
  assert.equal(extractModel("sonnet"), "sonnet");
  assert.equal(extractModel("haiku"), "haiku");
});

test("unknown claude-* ids pass through verbatim (future-model support)", () => {
  assert.equal(extractModel("claude-opus-6"), "claude-opus-6");
  assert.equal(extractModel("claude-fable-6-20270101"), "claude-fable-6-20270101");
  assert.equal(extractModel("claude-proxy/claude-sonnet-6"), "claude-sonnet-6");
  assert.equal(extractModel("claude-code-cli/claude-mythos-5"), "claude-mythos-5");
});

test("non-claude ids still default to opus", () => {
  assert.equal(extractModel("gpt-5"), "opus");
  assert.equal(extractModel("not-a-real-model"), "opus");
  assert.ok(!isPassthroughModelId("openai/gpt-5"));
});

test("metrics labels cover every registry id (no cardinality leak to 'other')", () => {
  for (const id of allRegistryIds()) {
    assert.equal(canonicalizeModelLabel(id), id, `registry id "${id}" should label as itself`);
    assert.equal(canonicalizeModelLabel(`claude-proxy/${id}`), id);
  }
});

test("cliTargets are valid claude CLI --model values", () => {
  for (const entry of MODEL_REGISTRY) {
    const ok = ["opus", "sonnet", "haiku"].includes(entry.cliTarget) || isPassthroughModelId(entry.cliTarget);
    assert.ok(ok, `"${entry.id}" has suspicious cliTarget "${entry.cliTarget}"`);
  }
});
