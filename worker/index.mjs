import { PublicError, providerRequest, researchBody, resultGraph } from './provider.mjs';
import { addImages } from './images.mjs';

const DAY = 86400000;
const MAX_RUNTIME = 8 * 60000;
const ID = /^[a-f0-9-]{36}$/;
const COOKIE = '__Host-press-session';
const NOT_CONFIGURED = 'Research is not configured yet. The site owner needs to add the API key.';
const json = (value, status = 200) => Response.json(value, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
} });
const positiveLimit = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
const summary = g => ({ id: g.id, title: g.title, query: g.query, kind: g.kind, depth: g.depth,
  researchedAt: g.researchedAt, nodes: g.nodes.length, edges: g.edges.length, approved: g.edges.filter(e => e.status === 'approved').length });
const snapshot = j => ({ id: j.id, query: j.query, status: j.status, message: j.message, startedAt: j.startedAt, mapId: j.mapId || null });

async function inputJSON(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new PublicError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError('The request is empty.', 400);
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8000) { await reader.cancel(); throw new PublicError('Request too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PublicError('Invalid JSON.', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError('Expected a JSON object.', 400);
  return input;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // All domains and instances share one persistent coordinator and one spending cap.
      return await env.RESEARCH.get(env.RESEARCH.idFromName('research-v1')).fetch(request);
    } catch { return json({ error: 'The research server is temporarily unavailable. Please try again later.' }, 503); }
  }
};

export class ResearchStore {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.storage = ctx.storage;
    this.queue = Promise.resolve();
    this.send = fetch;
  }

  serialize(action) {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }

  fetch(request) {
    return this.serialize(async () => {
      try { return await this.route(request); }
      catch (error) { return json({ error: error instanceof PublicError ? error.message : 'The request could not be completed. Please try again.' }, error instanceof PublicError ? error.status : 500); }
    });
  }

  async sign(value) {
    let secret = await this.storage.get('secret');
    if (!secret) { secret = crypto.randomUUID() + crypto.randomUUID(); await this.storage.put('secret', secret); }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async route(request) {
    const url = new URL(request.url), method = request.method;
    if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new PublicError('Cross-origin requests are not allowed.', 403);
    }
    const supplied = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const owner = ID.test(supplied || '') ? supplied : crypto.randomUUID();
    const token = await this.sign(`session:${owner}`);
    if (method === 'GET' && url.pathname === '/api/status') {
      const active = await this.storage.get('active');
      const job = active && await this.storage.get(`job:${active}`);
      const available = Boolean(this.env.OPENAI_API_KEY) && this.env.RESEARCH_ENABLED !== 'false';
      const note = !this.env.OPENAI_API_KEY ? NOT_CONFIGURED : this.env.RESEARCH_ENABLED === 'false' ? 'New research is paused by the site owner.' : '';
      const response = json({ available, provider: available ? 'OpenAI API' : null, note,
        token, activeJob: job?.owner === owner && job.status === 'running' ? job.id : null });
      response.headers.set('Set-Cookie', `${COOKIE}=${owner}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
      return response;
    }
    if (!supplied || !ID.test(supplied)) throw new PublicError('Reload this page to renew your session.', 403);
    if (!['GET', 'HEAD'].includes(method) && request.headers.get('x-press-token') !== token) throw new PublicError('Reload this page to renew your session.', 403);
    if (method === 'GET' && url.pathname === '/api/maps') return json((await this.maps(owner)).map(summary));
    const mapMatch = url.pathname.match(/^\/api\/maps\/([a-f0-9-]{36})(\/review)?$/);
    if (mapMatch) {
      const graph = await this.storage.get(`map:${owner}:${mapMatch[1]}`);
      if (!graph) throw new PublicError('Map not found in this browser. Search for the publication again.', 404);
      if (method === 'GET' && !mapMatch[2]) return json(graph);
      if (method === 'PATCH' && mapMatch[2]) {
        const input = await inputJSON(request);
        if (!['pending', 'approved', 'rejected'].includes(input.status)) throw new PublicError('Invalid review status.', 400);
        if (input.revision !== graph.revision) throw new PublicError('This map changed in another tab. Reopen it before reviewing.', 409);
        const edge = graph.edges.find(e => e.id === input.edgeId);
        if (!edge) throw new PublicError('Connection not found.', 404);
        edge.status = input.status; edge.reviewedAt = input.status === 'pending' ? null : new Date().toISOString();
        graph.revision++;
        await this.storage.put(`map:${owner}:${graph.id}`, graph);
        return json(graph);
      }
    }
    if (method === 'POST' && url.pathname === '/api/research') return this.start(request, owner);
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
    if (jobMatch) {
      let job = await this.storage.get(`job:${jobMatch[1]}`);
      if (!job || job.owner !== owner) throw new PublicError('Research session not found. Search for the publication again.', 404);
      if (method === 'GET') return json(snapshot(job));
      if (method === 'DELETE') {
        if (job.status === 'running') {
          if (!job.responseId) throw new PublicError('The request is unconfirmed. Please wait for the cooldown before starting another search.', 503);
          // Only mark cancelled after the provider acknowledges the cancellation.
          if (job.responseId) await providerRequest(this.env, `/${job.responseId}/cancel`, {}, this.send);
          job.status = 'cancelled'; job.message = 'Research cancelled.';
          await this.finish(job);
        }
        return json({ cancelled: true });
      }
    }
    throw new PublicError('API endpoint not found.', 404);
  }

  async maps(owner) {
    return [...(await this.storage.list({ prefix: `map:${owner}:` })).values()].sort((a, b) => b.researchedAt.localeCompare(a.researchedAt));
  }

  async start(request, owner) {
    const input = await inputJSON(request);
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (query.length < 2 || query.length > 160 || /[\x00-\x1f]/.test(query)) throw new PublicError('Enter a publication name between 2 and 160 characters.', 400);
    const options = { query, kind: ['auto', 'news', 'academic'].includes(input.kind) ? input.kind : 'auto', depth: [1, 2, 3, 4].includes(input.depth) ? input.depth : 3 };
    if (!input.fresh) {
      const cached = (await this.maps(owner)).find(g => g.query.toLowerCase() === query.toLowerCase() && g.kind === options.kind && g.depth === options.depth && Date.now() - Date.parse(g.researchedAt) < DAY);
      if (cached) return json({ mapId: cached.id, cached: true });
    }
    if (!this.env.OPENAI_API_KEY) throw new PublicError(NOT_CONFIGURED, 503);
    if (this.env.RESEARCH_ENABLED === 'false') throw new PublicError('New research is paused by the site owner.', 503);
    if (await this.storage.get('active')) throw new PublicError('A search is already running. Please try again in a few minutes.', 429);

    const day = new Date().toISOString().slice(0, 10);
    const ip = await this.sign(`ip:${day}:${request.headers.get('cf-connecting-ip') || 'local'}`);
    let usage = await this.storage.get('usage') || { total: 0 };
    if (usage.day !== day) usage = { total: usage.total, day, daily: 0, ips: {} };
    if (usage.total >= positiveLimit(this.env.TOTAL_RESEARCH_LIMIT, 20)) throw new PublicError('The site’s research allowance has been used. New searches are paused until the owner raises the limit.', 429);
    if (usage.daily >= positiveLimit(this.env.DAILY_RESEARCH_LIMIT, 5)) throw new PublicError('The site’s daily search limit has been reached. Please try again tomorrow.', 429);
    if ((usage.ips[ip] || 0) >= positiveLimit(this.env.IP_DAILY_RESEARCH_LIMIT, 2)) throw new PublicError('You’ve reached today’s search limit. Please try again tomorrow.', 429);

    // Charge the allowance BEFORE starting a paid request. Failures/cancellations still count;
    // no automatic POST retry, so a lost response cannot create duplicate paid searches.
    usage.total++; usage.daily++; usage.ips[ip] = (usage.ips[ip] || 0) + 1;
    const job = { id: crypto.randomUUID(), owner, ...options, startedAt: new Date().toISOString(), status: 'running', message: 'Searching public ownership sources…' };
    await this.storage.put({ usage, active: job.id, [`job:${job.id}`]: job });
    await this.storage.setAlarm(Date.now() + 15000);
    try {
      const result = await providerRequest(this.env, '', researchBody(options, this.env), this.send);
      job.responseId = result.id;
      await this.storage.put(`job:${job.id}`, job);
      if (!['queued', 'in_progress'].includes(result.status)) await this.complete(job, result);
    } catch (error) {
      if (error.uncertain) {
        // The provider may have accepted the request. Never automatically retry it or
        // free the slot immediately: retain the cooldown even without a response ID.
        job.uncertain = true;
        job.message = 'The research service did not confirm the request. New searches are paused briefly to avoid duplicate charges.';
        await this.storage.put(`job:${job.id}`, job);
        throw new PublicError(job.message, 503);
      }
      job.status = 'failed'; job.message = error instanceof PublicError ? error.message : 'Research could not start. Please try again later.';
      await this.finish(job);
      throw new PublicError(job.message, error.status || 502);
    }
    return json({ jobId: job.id }, 202);
  }

  async complete(job, result) {
    if (result.status === 'cancelled') { job.status = 'cancelled'; job.message = 'Research cancelled.'; }
    else {
      try {
        const graph = resultGraph(result, job); graph.id = job.id;
        await addImages(graph, this.send);
        await this.storage.put(`map:${job.owner}:${graph.id}`, graph);
        job.status = 'complete'; job.mapId = graph.id; job.message = 'Research saved. Review the proposed connections.';
      } catch (error) { job.status = 'failed'; job.message = error instanceof PublicError ? error.message : 'Research returned an invalid ownership map.'; }
    }
    await this.finish(job);
  }

  async finish(job) {
    job.finishedAt = new Date().toISOString();
    await this.storage.put(`job:${job.id}`, job);
    if (await this.storage.get('active') === job.id) await this.storage.delete('active');
    await this.storage.setAlarm(Date.now() + DAY);
  }

  alarm() {
    return this.serialize(async () => {
      const id = await this.storage.get('active');
      const job = id && await this.storage.get(`job:${id}`);
      if (job?.status === 'running') {
        // Reschedule before network work, including failures and object restarts.
        await this.storage.setAlarm(Date.now() + 15000);
        const expired = Date.now() - Date.parse(job.startedAt) > MAX_RUNTIME;
        if (!job.responseId) {
          if (expired) {
            job.status = 'failed'; job.message = 'The research request was interrupted. Please try again later.';
            await this.finish(job);
          }
        } else {
          try {
            const result = await providerRequest(this.env, `/${job.responseId}${expired ? '/cancel' : ''}`, expired ? {} : undefined, this.send);
            if (expired) { job.status = 'failed'; job.message = 'Research reached the eight-minute limit. Please try a more specific name.'; await this.finish(job); }
            else if (!['queued', 'in_progress'].includes(result.status)) await this.complete(job, result);
          } catch (error) {
            job.message = 'The research service is slow to respond. Still checking…';
            await this.storage.put(`job:${id}`, job);
            // Keep the global lock until cancellation succeeds, to avoid overlapping spend.
            if (expired) await this.storage.setAlarm(Date.now() + 60000);
          }
        }
      }
      await this.cleanup();
    });
  }

  async cleanup() {
    const now = Date.now();
    for (const [key, value] of await this.storage.list({ prefix: 'map:' })) {
      if (now - Date.parse(value.researchedAt) > 30 * DAY) await this.storage.delete(key);
    }
    for (const [key, value] of await this.storage.list({ prefix: 'job:' })) {
      if (value.status !== 'running' && now - Date.parse(value.startedAt) > DAY) await this.storage.delete(key);
    }
    if (!await this.storage.get('active')) await this.storage.setAlarm(now + DAY);
  }
}
