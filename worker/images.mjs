import { safeURL } from '../lib/schema.mjs';

// Optional imagery uses only these two fixed Wikimedia endpoints, never model URLs.
export async function addImages(graph, send = fetch) {
  const signal = AbortSignal.timeout(12000);
  const nodes = graph.nodes.filter(n => /^Q\d+$/.test(n.wikidataId || '')).slice(0, 18);
  let index = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (index < nodes.length && !signal.aborted) {
      const node = nodes[index++];
      try {
        const response = await send(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${node.wikidataId}&props=claims&format=json`, { signal, redirect: 'error' });
        if (!response.ok) continue;
        const entity = (await response.json()).entities?.[node.wikidataId];
        const claim = entity?.claims?.P154?.find(c => c.rank !== 'deprecated') || entity?.claims?.P18?.find(c => c.rank !== 'deprecated');
        const file = claim?.mainsnak?.datavalue?.value;
        if (typeof file !== 'string') continue;
        const params = new URLSearchParams({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '160', format: 'json' });
        const result = await send(`https://commons.wikimedia.org/w/api.php?${params}`, { signal, redirect: 'error' });
        if (!result.ok) continue;
        const info = Object.values((await result.json()).query?.pages || {})[0]?.imageinfo?.[0];
        const url = safeURL(info?.thumburl || info?.url), page = safeURL(info?.descriptionurl);
        if (!url || new URL(url).hostname !== 'upload.wikimedia.org' || !page || new URL(page).hostname !== 'commons.wikimedia.org') continue;
        const plain = text => typeof text === 'string' ? text.replace(/<[^>]*>/g, '').slice(0, 300) : '';
        node.image = { url, page, artist: plain(info.extmetadata?.Artist?.value), license: plain(info.extmetadata?.LicenseShortName?.value) || 'See source' };
      } catch { /* Keep initials when image lookup fails or its shared deadline expires. */ }
    }
  }));
}
