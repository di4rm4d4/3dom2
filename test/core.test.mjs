import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraph, safeURL } from '../lib/schema.mjs';
import { publicAddress } from '../lib/public-web.mjs';

const node = id => ({id,name:id,type:'company',endpoint:'continue'});
const edge = (from,to,extra={}) => ({id:`${from}-${to}`,from,to,relationship:'owned_by',percentage:null,asOf:null,
  evidence:[{url:'https://example.org/source',title:'A source',excerpt:'An ownership statement.'}],...extra});
const raw = () => ({rootId:'paper',title:'Paper',summary:'Test graph',nodes:['paper','owner','parent','unrelated'].map(node),edges:[edge('paper','owner'),edge('owner','parent')],gaps:[]});
const options = {query:'Paper',kind:'news',depth:3};

test('AI output cannot self-approve; invalid evidence and endpoints are dropped',()=>{
  const input=raw(); input.edges[0].status='approved';input.edges.push(edge('paper','unrelated',{evidence:[{url:'javascript:alert(1)'}]}),edge('parent','absent'));
  const g=normalizeGraph(input,options);
  assert.equal(g.edges.length,2);assert.ok(g.edges.every(e=>e.status==='pending'));assert.equal(g.nodes.length,3);
});
test('depth limit prevents a chain exceeding the selected bound',()=>{
  const g=normalizeGraph(raw(),{...options,depth:1});assert.deepEqual(g.nodes.map(n=>n.id),['paper','owner']);assert.equal(g.edges.length,1);
  assert.equal(g.nodes[1].endpoint,'unresolved');
});
test('multiple kinds of connection are preserved but exact duplicates are not',()=>{
  const input=raw();input.edges.push(edge('paper','owner'),edge('paper','owner',{relationship:'published_by'}));
  const g=normalizeGraph(input,options);assert.equal(g.edges.length,3);assert.ok(g.edges.some(e=>e.relationship==='published_by'));
});
test('cycles do not cause infinite traversal and unrelated entities are removed',()=>{
  const input=raw();input.edges.push(edge('parent','paper'));const g=normalizeGraph(input,options);assert.equal(g.nodes.length,3);assert.equal(g.edges.length,3);
});
test('invented percentages and impossible links cannot pass normalization',()=>{
  const input=raw();input.edges[0].percentage=110;const g=normalizeGraph(input,options);assert.equal(g.edges[0].percentage,null);
  input.nodes[1].id='paper';assert.throws(()=>normalizeGraph(input,options),/ambiguous/);
});
test('public URL checks reject private destinations, credentials and non-HTTPS',()=>{
  for(const url of ['file:///etc/passwd','http://example.org','https://127.0.0.1/x','https://[::1]/','https://user:pass@example.org/','https://service.local/','https://example.org:8000/'])assert.equal(safeURL(url),null,url);
  assert.equal(safeURL('https://www.orlen.pl/'),'https://www.orlen.pl/');
  for(const address of ['127.0.0.1','10.0.0.2','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);
});
