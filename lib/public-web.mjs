import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { safeURL } from './schema.mjs';

export function publicAddress(address) {
  if (net.isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}

export async function publicGet(input, redirects = 0) {
  const safe = safeURL(input);
  if (!safe) throw new Error('Source URL is not a public HTTPS address.');
  const url = new URL(safe);
  const addresses = await dns.resolve4(url.hostname);
  if (!addresses.length || addresses.some(a => !publicAddress(a))) throw new Error('Source resolves to a private address.');
  // Pin the checked address to this request; revalidate every redirect.
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { request.destroy(new Error('Source request timed out.')); }, 12000);
    const request = https.get(url, { headers: { 'User-Agent': 'PressTrace/1.0 (ownership research prototype)', 'Accept': 'text/html,application/json,application/pdf;q=0.8', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address: addresses[0], family: 4 }]) : callback(null, addresses[0], 4)
    }, response => {
      if (/application\/pdf/i.test(String(response.headers['content-type'] || ''))) {
        clearTimeout(timer);
        resolve({ status: response.statusCode, headers: response.headers, body: '', url: safe });
        response.destroy();
        return;
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) { request.destroy(new Error('Source exceeds the 2 MB inspection limit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), url: safe }); });
    });
    request.on('error', error => { clearTimeout(timer); reject(error); });
  });
  if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
    if (redirects >= 3) throw new Error('Too many source redirects.');
    return publicGet(new URL(result.headers.location, url).href, redirects + 1);
  }
  return result;
}

function plain(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function checkEvidence(graph, progress, signal) {
  const cache = new Map();
  const refs = graph.edges.flatMap(e => e.evidence);
  let index = 0;
  await Promise.all([0,1,2].map(async () => {
    while (index < refs.length) {
      const ref = refs[index++];
      if (signal?.aborted) return;
      try {
        if (!cache.has(ref.url)) cache.set(ref.url, publicGet(ref.url));
        const page = await cache.get(ref.url);
        ref.httpStatus = page.status;
        if (page.status < 200 || page.status >= 300) { ref.validation = 'unavailable'; continue; }
        ref.resolvedUrl = page.url;
        const type = String(page.headers['content-type'] || '');
        if (/pdf/.test(type)) { ref.validation = 'document_available'; continue; }
        if (ref.excerpt && plain(page.body).includes(plain(ref.excerpt))) ref.validation = 'excerpt_found';
        else ref.validation = 'page_available';
      } catch { ref.validation = 'unavailable'; }
    }
  }));
  progress('Source checks complete. Claims still await your review.');
}

export async function enrichImages(graph, signal) {
  for (const node of graph.nodes) {
    if (signal?.aborted) return;
    if (node.image || node.type === 'aggregate') continue;
    try {
      if (!node.wikidataId && node.type !== 'state') {
        const normal = name => name.toLowerCase().replace(/\b(sp\.\s*z\s*o\.o\.|s\.a\.|ltd\.?|limited|inc\.?)\s*$/g, '').replace(/\(journal\)/g,'').replace(/[^\p{L}\p{N}]/gu,'');
        const term = node.name.replace(/\s+(sp\.\s*z\s*o\.o\.|s\.a\.|ltd\.?|limited|inc\.?)\s*$/i, '');
        const params = new URLSearchParams({ action:'wbsearchentities',search:term,language:'en',uselang:'en',limit:'3',format:'json' });
        const search = await publicGet(`https://www.wikidata.org/w/api.php?${params}`);
        const typeHint = ['company','publisher','fund'].includes(node.type) ? /company|publisher|publishing|corporation|business|fund|group|organisation|organization/i : node.type === 'publication' ? /journal|newspaper|magazine|news|publication|periodical/i : null;
        const candidates = (JSON.parse(search.body).search || []).filter(item => normal(item.label || '') === normal(term) && (!typeHint || typeHint.test(item.description || '')));
        // Matching names only supplies imagery, never ownership facts. Ambiguous matches keep initials.
        if (candidates.length === 1) node.wikidataId = candidates[0].id;
      }
      if (!node.wikidataId) continue;
      const item = await publicGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${node.wikidataId}&props=claims&format=json`);
      const entity = JSON.parse(item.body).entities?.[node.wikidataId];
      const claim = entity?.claims?.P154?.find(c => c.rank !== 'deprecated') || entity?.claims?.P18?.find(c => c.rank !== 'deprecated');
      const file = claim?.mainsnak?.datavalue?.value;
      if (typeof file !== 'string') continue;
      const params = new URLSearchParams({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '160', format: 'json' });
      const response = await publicGet(`https://commons.wikimedia.org/w/api.php?${params}`);
      const info = Object.values(JSON.parse(response.body).query?.pages || {})[0]?.imageinfo?.[0];
      if (info && safeURL(info.thumburl || info.url)) node.image = { url: info.thumburl || info.url,
        page: info.descriptionurl, artist: (info.extmetadata?.Artist?.value || '').replace(/<[^>]*>/g, '').slice(0, 300),
        license: (info.extmetadata?.LicenseShortName?.value || 'See source').replace(/<[^>]*>/g, '') };
    } catch { /* Initials remain visible when imagery is unavailable. */ }
  }
}
