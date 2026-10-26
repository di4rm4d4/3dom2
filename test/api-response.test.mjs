import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../public/api-response.js';

test('a static host HTML fallback reports the missing research backend', async () => {
  for (const status of [200, 404]) {
    const response = new Response('<!doctype html><h1>who owns your news??</h1>', {
      status, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
    await assert.rejects(readApiResponse(response), /research server is not connected/);
  }
});

test('valid API objects and lists still parse', async () => {
  for (const value of [{ available: true, token: 'test-token' }, []]) {
    assert.deepEqual(await readApiResponse(Response.json(value)), value);
  }
});

test('malformed JSON produces a clear error instead of a browser-specific syntax exception', async () => {
  const response = new Response('{unfinished', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(readApiResponse(response), /research server returned invalid data/);
});

test('API error messages and status codes remain available', async () => {
  await assert.rejects(readApiResponse(Response.json({ error: 'A research run is already active.' }, { status: 409 })), /already active/);
  await assert.rejects(readApiResponse(Response.json(null, { status: 502 })), /Request failed \(502\)/);
});

test('valid JSON with missing endpoint data produces a readable error', async () => {
  for (const [path, value] of [['/api/status', {}], ['/api/maps', {}], ['/api/research', null], ['/api/jobs/id', { status: 'complete' }], ['/api/maps/id', { nodes: [], edges: [] }]]) {
    await assert.rejects(readApiResponse(Response.json(value), path), /incomplete data/);
  }
});
