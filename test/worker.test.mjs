import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchStore } from '../worker/index.mjs';
import { resultGraph, researchBody, providerRequest } from '../worker/provider.mjs';

class MemoryStorage {
  data = new Map();
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { for (const [k, v] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) this.data.set(k, structuredClone(v)); }
  async delete(key) { return this.data.delete(key); }
  async setAlarm(time) { this.alarmAt = time; }
  async list({ prefix }) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
}
const raw = { rootId: 'paper', title: 'Paper', summary: '', gaps: [],
  nodes: [{ id: 'paper', name: 'Paper', description: '', type: 'publication' }, { id: 'owner', name: 'Owner', description: '', type: 'company' }],
  edges: [{ id: 'one', from: 'paper', to: 'owner', relationship: 'owned_by', evidence: [{ url: 'https://example.org/about', title: 'About', excerpt: 'Owner publishes Paper.' }] }] };
const complete = () => ({ id: 'resp_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(raw) }] }] });
const options = { query: 'Paper', kind: 'auto', depth: 3 };

function setup(vars = {}) {
  const storage = new MemoryStorage();
  const env = { OPENAI_API_KEY: 'fake-key-for-tests', ...vars };
  const store = new ResearchStore({ storage }, env);
  const calls = [];
  store.send = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/cancel')) return Response.json({ id: 'resp_test', status: 'cancelled' });
    return Response.json(init.method === 'POST' ? { id: 'resp_test', status: 'queued' } : complete());
  };
  return { store, storage, env, calls };
}
async function browser(store, ip = '1.2.3.4') {
  const status = await store.fetch(new Request('https://example.org/api/status'));
  const cookie = status.headers.get('set-cookie').split(';')[0];
  const config = await status.json();
  return { config, cookie, async request(path, method = 'GET', body, overrides = {}) {
    const response = await store.fetch(new Request(`https://example.org${path}`, {
      method, headers: { cookie, origin: 'https://example.org', 'x-press-token': config.token,
        'content-type': 'application/json', 'cf-connecting-ip': ip, ...overrides },
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    return { status: response.status, data: await response.json() };
  } };
}

test('unconfigured cloud backend returns JSON and never starts paid research', async () => {
  const { store, calls } = setup({ OPENAI_API_KEY: '' }); const a = await browser(store);
  assert.equal(a.config.available, false); assert.match(a.config.note, /API key/);
  assert.equal((await a.request('/api/research', 'POST', options)).status, 503);
  assert.equal((await a.request('/api/unknown')).status, 404);
  assert.equal(calls.length, 0);
});

test('background completion, private maps, cache hits and revision-checked reviews', async () => {
  const { store, calls } = setup(); const a = await browser(store), b = await browser(store, '5.6.7.8');
  const started = await a.request('/api/research', 'POST', options); const id = started.data.jobId;
  assert.equal(started.status, 202);
  assert.equal((await b.request(`/api/jobs/${id}`)).status, 404);
  assert.equal((await a.request('/api/research', 'POST', options)).status, 429);
  await store.alarm();
  assert.equal((await a.request(`/api/jobs/${id}`)).data.status, 'complete');
  assert.equal((await b.request(`/api/maps/${id}`)).status, 404);
  const graph = (await a.request(`/api/maps/${id}`)).data;
  assert.equal(graph.edges[0].status, 'pending');
  const cached = await a.request('/api/research', 'POST', options);
  assert.equal(cached.data.mapId, id); assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  const patch = { edgeId: 'edge-1', revision: 1, status: 'approved' };
  assert.equal((await a.request(`/api/maps/${id}/review`, 'PATCH', patch)).data.revision, 2);
  assert.equal((await a.request(`/api/maps/${id}/review`, 'PATCH', patch)).status, 409);
});

test('parallel starts reserve one slot; cancellation still consumes the persisted allowance', async () => {
  const { store, storage, env, calls } = setup({ TOTAL_RESEARCH_LIMIT: '1' });
  const a = await browser(store), b = await browser(store, '5.6.7.8');
  const attempts = await Promise.all([a.request('/api/research', 'POST', options), b.request('/api/research', 'POST', options)]);
  assert.deepEqual(attempts.map(v => v.status), [202, 429]);
  assert.equal((await a.request(`/api/jobs/${attempts[0].data.jobId}`, 'DELETE')).data.cancelled, true);
  const restarted = new ResearchStore({ storage }, env); restarted.send = store.send;
  const c = await browser(restarted, '9.9.9.9');
  const limited = await c.request('/api/research', 'POST', options);
  assert.equal(limited.status, 429); assert.match(limited.data.error, /allowance/);
  assert.equal(calls.filter(c => c.init.method === 'POST' && !c.url.endsWith('/cancel')).length, 1);
});

test('daily site and IP quotas persist across new browser sessions', async () => {
  for (const vars of [{ DAILY_RESEARCH_LIMIT: '1' }, { IP_DAILY_RESEARCH_LIMIT: '1' }]) {
    const { store } = setup(vars); const a = await browser(store);
    await a.request('/api/research', 'POST', options); await store.alarm();
    const b = await browser(store);
    const limited = await b.request('/api/research', 'POST', { ...options, fresh: true });
    assert.equal(limited.status, 429); assert.match(limited.data.error, /limit/);
  }
});

test('invalid input, CSRF, cross-origin and kill switch cannot trigger paid calls', async () => {
  const { store, calls, env } = setup(); const a = await browser(store);
  for (const input of [null, [], { query: '' }, { query: 'a'.repeat(161) }]) assert.equal((await a.request('/api/research', 'POST', input)).status, 400);
  assert.equal((await a.request('/api/research', 'POST', options, { 'x-press-token': 'wrong' })).status, 403);
  assert.equal((await a.request('/api/research', 'POST', options, { origin: 'https://evil.example' })).status, 403);
  env.RESEARCH_ENABLED = 'false';
  assert.equal((await a.request('/api/research', 'POST', options)).status, 503);
  assert.equal(calls.length, 0);
});

test('uncertain requests are not retried or unlocked by cancellation', async () => {
  const { store, storage, calls } = setup(); const a = await browser(store);
  store.send = async () => { calls.push('attempt'); throw new Error('Network failure'); };
  assert.equal((await a.request('/api/research', 'POST', options)).status, 503);
  const id = await storage.get('active');
  assert.equal((await a.request(`/api/jobs/${id}`, 'DELETE')).status, 503);
  await store.alarm();
  assert.equal((await a.request('/api/research', 'POST', options)).status, 429);
  assert.equal(calls.length, 1);
});

test('timeout cancels provider research and cannot silently restart it', async () => {
  const { store, storage, calls } = setup(); const a = await browser(store);
  const id = (await a.request('/api/research', 'POST', options)).data.jobId;
  const job = await storage.get(`job:${id}`); job.startedAt = new Date(Date.now() - 9 * 60000).toISOString();
  await storage.put(`job:${id}`, job); await store.alarm();
  assert.equal((await a.request(`/api/jobs/${id}`)).data.status, 'failed');
  assert.equal(calls.at(-1).url.endsWith('/cancel'), true);
  assert.equal(await storage.get('active'), undefined);
});

test('provider errors are clear, secret-free, and malformed graph output fails safely', async () => {
  for (const response of [new Response(''), new Response('<html>bad</html>'), Response.json(null), Response.json({})]) {
    await assert.rejects(providerRequest({ OPENAI_API_KEY: 'secret' }, '', {}, async () => response), /invalid data|incomplete response/);
  }
  await assert.rejects(providerRequest({ OPENAI_API_KEY: 'secret' }, '', {}, async () => Response.json({ error: 'secret internal detail' }, { status: 401 })), /API key/);
  for (const output of ['', 'null', '{', '{"nodes":[]}']) {
    const result = complete(); result.output[0].content[0].text = output;
    assert.throws(() => resultGraph(result, options), /no ownership data|invalid ownership map/);
  }
  const body = researchBody(options, {});
  assert.equal(body.max_tool_calls, 12); assert.equal(body.max_output_tokens, 6000); assert.equal(body.background, true);
});
