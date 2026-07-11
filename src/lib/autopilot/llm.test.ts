import test from 'node:test';
import assert from 'node:assert/strict';

import { complete } from './llm';

test('complete defaults to OpenClaw gateway default without an app-level provider override', async () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const originalGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const originalGatewayModel = process.env.OPENCLAW_GATEWAY_MODEL;

  process.env.OPENCLAW_GATEWAY_URL = 'ws://127.0.0.1:18789';
  process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';
  delete process.env.OPENCLAW_GATEWAY_MODEL; // fall back to the built-in openclaw/default

  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      model: 'openclaw/default',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await complete('Use the gateway default');
    assert.equal(result.model, 'openclaw/default');
    assert.equal(calls.length, 1);

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer test-token');
    // openclaw/default is an openclaw/* model, so it is NOT sent in the
    // x-openclaw-model override header.
    assert.equal(headers['x-openclaw-model'], undefined);

    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.model, 'openclaw/default');
  } finally {
    global.fetch = originalFetch;
    if (originalGatewayUrl === undefined) delete process.env.OPENCLAW_GATEWAY_URL;
    else process.env.OPENCLAW_GATEWAY_URL = originalGatewayUrl;
    if (originalGatewayToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = originalGatewayToken;
    if (originalGatewayModel === undefined) delete process.env.OPENCLAW_GATEWAY_MODEL;
    else process.env.OPENCLAW_GATEWAY_MODEL = originalGatewayModel;
  }
});

test('complete sends OpenClaw-compatible chat completion requests for explicit provider models', async () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const originalGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const originalGatewayModel = process.env.OPENCLAW_GATEWAY_MODEL;

  process.env.OPENCLAW_GATEWAY_URL = 'ws://127.0.0.1:18789';
  process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';
  delete process.env.OPENCLAW_GATEWAY_MODEL;

  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      model: 'openclaw/default',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await complete('Say hi', { model: 'openai-codex/gpt-5.4', temperature: 0.1, maxTokens: 256 });

    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.model, 'openai-codex/gpt-5.4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:18789/v1/chat/completions');

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer test-token');
    assert.equal(headers['x-openclaw-model'], 'openai-codex/gpt-5.4');

    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.model, 'openclaw/default');
    assert.equal(body.temperature, 0.1);
    assert.equal(body.max_tokens, 256);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Say hi' }]);
  } finally {
    global.fetch = originalFetch;
    if (originalGatewayUrl === undefined) delete process.env.OPENCLAW_GATEWAY_URL;
    else process.env.OPENCLAW_GATEWAY_URL = originalGatewayUrl;
    if (originalGatewayToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = originalGatewayToken;
    if (originalGatewayModel === undefined) delete process.env.OPENCLAW_GATEWAY_MODEL;
    else process.env.OPENCLAW_GATEWAY_MODEL = originalGatewayModel;
  }
});

test('complete preserves direct OpenClaw model requests without override header', async () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const originalGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

  process.env.OPENCLAW_GATEWAY_URL = 'ws://127.0.0.1:18789';
  process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';

  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      model: 'openclaw/researcher',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await complete('Say hi', { model: 'openclaw/researcher' });
    assert.equal(result.model, 'openclaw/researcher');

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['x-openclaw-model'], undefined);

    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.model, 'openclaw/researcher');
  } finally {
    global.fetch = originalFetch;
    if (originalGatewayUrl === undefined) delete process.env.OPENCLAW_GATEWAY_URL;
    else process.env.OPENCLAW_GATEWAY_URL = originalGatewayUrl;
    if (originalGatewayToken === undefined) delete process.env.OPENCLAW_GATEWAY_TOKEN;
    else process.env.OPENCLAW_GATEWAY_TOKEN = originalGatewayToken;
  }
});
