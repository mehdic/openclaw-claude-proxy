/**
 * Tests for canonicalizeModelLabel (src/models.ts) — the function that
 * bounds /metrics cardinality by reducing arbitrary client model strings
 * to a bounded label set (registry ids + optionally discovered ids).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeModelLabel } from "../models.js";

test("strips claude-proxy/ provider prefix", () => {
  assert.equal(canonicalizeModelLabel("claude-proxy/claude-opus-4-8"), "claude-opus-4-8");
});

test("strips claude-code-cli/ legacy provider prefix", () => {
  assert.equal(canonicalizeModelLabel("claude-code-cli/claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001");
});

test("known bare model id passes through unchanged", () => {
  assert.equal(canonicalizeModelLabel("claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(canonicalizeModelLabel("claude-opus-5"), "claude-opus-5");
  assert.equal(canonicalizeModelLabel("claude-fable-5"), "claude-fable-5");
});

test("unknown ids collapse to 'other' (cardinality guard)", () => {
  assert.equal(canonicalizeModelLabel("openai/gpt-5"), "other");
  assert.equal(canonicalizeModelLabel("totally-fake-model"), "other");
  assert.equal(canonicalizeModelLabel("claude-opus-99-99"), "other");
});

test("discovered ids label as themselves via extraLabels", () => {
  const discovered = new Set(["claude-opus-6"]);
  assert.equal(canonicalizeModelLabel("claude-opus-6", discovered), "claude-opus-6");
  assert.equal(canonicalizeModelLabel("claude-proxy/claude-opus-6", discovered), "claude-opus-6");
  assert.equal(canonicalizeModelLabel("claude-opus-6"), "other");
});

test("empty/undefined → 'unknown'", () => {
  assert.equal(canonicalizeModelLabel(undefined), "unknown");
  assert.equal(canonicalizeModelLabel(""), "unknown");
});

test("provider prefix on unknown id still collapses to 'other'", () => {
  assert.equal(canonicalizeModelLabel("claude-proxy/something-weird"), "other");
});
