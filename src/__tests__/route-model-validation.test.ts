import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { handleChatCompletions, handleResponses } from "../server/routes.js";

class FakeResponse {
  statusCode = 200;
  payload: unknown;
  headersSent = false;
  writableEnded = false;

  on(): this {
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown): this {
    this.payload = payload;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }

  setHeader(): this {
    return this;
  }
}

function req(body: unknown): Request {
  return { body, header: () => undefined, get: () => undefined } as unknown as Request;
}

function res(): FakeResponse & Response {
  return new FakeResponse() as FakeResponse & Response;
}

function assertInvalidModel(response: FakeResponse): void {
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: {
      message: "model is required and must be a supported model id",
      type: "invalid_request_error",
      code: "invalid_model",
    },
  });
}

test("chat completions returns 400 when model is missing", async () => {
  const response = res();

  await handleChatCompletions(req({ messages: [{ role: "user", content: "hi" }] }), response);

  assertInvalidModel(response);
});

test("chat completions returns 400 when model is unknown", async () => {
  const response = res();

  await handleChatCompletions(req({ model: "not-a-real-model", messages: [{ role: "user", content: "hi" }] }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: {
      message: "unsupported model: not-a-real-model",
      type: "invalid_request_error",
      code: "invalid_model",
    },
  });
});

test("responses returns 400 when model is missing", async () => {
  const response = res();

  await handleResponses(req({ input: "hi" }), response);

  assertInvalidModel(response);
});

test("responses returns 400 when model is unknown", async () => {
  const response = res();

  await handleResponses(req({ model: "not-a-real-model", input: "hi" }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: {
      message: "unsupported model: not-a-real-model",
      type: "invalid_request_error",
      code: "invalid_model",
    },
  });
});
