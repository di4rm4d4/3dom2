import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findPublication, validateCatalog } from '../public/catalog.js';
import { readApiResponse } from '../public/api-response.js';
import { safeURL } from '../lib/schema.mjs';

test('all 20 published maps are complete, source-linked, and remain unreviewed', async () => {
  const catalog = validateCatalog(JSON.parse(await readFile(new URL('../public/data/catalog.json', import.meta.url))));
  assert.equal(catalog.liveResearch, false);
  assert.equal(catalog.maps.length, 20);
  assert.equal(new Set(catalog.maps.map(m => m.id)).size, 20);
  assert.equal(new Set(catalog.maps.map(m => m.slug)).size, 20);
  for (const entry of catalog.maps) {
    const graph = JSON.parse(await readFile(new URL(`../public/data/${entry.slug}.json`, import.meta.url)));
    await readApiResponse(Response.json(graph), `/api/maps/${graph.id}`);
    assert.equal(graph.id, entry.id);
    assert.equal(graph.query, entry.name);
    assert.equal(graph.publishedSnapshot, true);
    assert.ok(graph.edges.length > 0, entry.name);
    assert.ok(Number.isFinite(Date.parse(graph.researchedAt)), entry.name);
    for (const edge of graph.edges) {
      assert.equal(edge.status, 'pending');
      assert.equal(edge.reviewedAt, null);
      assert.ok(edge.evidence.length > 0);
      for (const source of edge.evidence) assert.ok(safeURL(source.url), source.url);
    }
    for (const query of [entry.name, ...entry.aliases]) assert.equal(findPublication(catalog.maps, query)?.id, entry.id);
  }
  assert.equal(findPublication(catalog.maps, '  el pais  ')?.slug, 'el-pais');
  assert.equal(findPublication(catalog.maps, 'nyt')?.slug, 'new-york-times');
  assert.equal(findPublication(catalog.maps, 'Times'), null);
  assert.equal(findPublication(catalog.maps, 'unknown publication'), null);
  assert.equal(findPublication(catalog.maps, ''), null);
});

test('catalog validation rejects malformed lists and paths outside the public data folder', () => {
  for (const value of [null, {}, { liveResearch: false, maps: [] }, { liveResearch: false, maps: [{ id: 'a'.repeat(36), slug: '../secret', name: 'x', aliases: [] }] }]) {
    assert.throws(() => validateCatalog(value), /saved map list/);
  }
});
