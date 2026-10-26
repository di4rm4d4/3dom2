const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const relationships = new Set(['owned_by', 'parent_company', 'published_by', 'controlled_by', 'appointment_rights', 'managed_by']);

function validGraph(value) {
  if (!object(value) || !text(value.id) || !text(value.query) || !Array.isArray(value.nodes) || !value.nodes.length || !Array.isArray(value.edges) || !Array.isArray(value.gaps)) return false;
  if (!value.nodes.every(n => object(n) && text(n.id) && text(n.name) && typeof n.description === 'string')) return false;
  const ids = new Set(value.nodes.map(n => n.id));
  return ids.size === value.nodes.length && ids.has(value.rootId) && value.edges.every(e => object(e) && text(e.id) && ids.has(e.from) && ids.has(e.to) && relationships.has(e.relationship) && ['pending', 'approved', 'rejected'].includes(e.status) && Array.isArray(e.evidence));
}

function validResponse(value, path) {
  if (path === '/api/status') return object(value) && typeof value.available === 'boolean' && text(value.token) && typeof value.note === 'string' && (value.activeJob === null || text(value.activeJob));
  if (path === '/api/maps') return Array.isArray(value) && value.every(g => object(g) && text(g.id) && text(g.query) && text(g.researchedAt));
  if (/^\/api\/maps\//.test(path)) return validGraph(value);
  if (path === '/api/research') return object(value) && (text(value.jobId) || text(value.mapId));
  if (/^\/api\/jobs\//.test(path)) return object(value) && (value.cancelled === true || (text(value.query) && ['running', 'complete', 'failed', 'cancelled'].includes(value.status) && typeof value.message === 'string' && (value.status !== 'complete' || text(value.mapId))));
  return object(value) || Array.isArray(value);
}

export async function readApiResponse(response, path = '') {
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw new Error('The research server is not connected. This website returned a page instead of API data.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The research server returned invalid data. Please try again.');
  }

  if (!response.ok) {
    const message = typeof result?.error === 'string' ? result.error : `Request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  if (!validResponse(result, path)) throw new Error('The research server returned incomplete data. Please try again.');
  return result;
}
