import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handoffKnownAsset} from '../apps/player/dist/asset-handoff.js';
const actor='3'.repeat(32),instanceHex='ab'.repeat(32);
function fixture(){
  let mode='purchase';const events=[],fields=new Map();
  for(const id of ['guided-actor','guided-instance','guided-page-start','guided-page-limit'])fields.set(id,{value:id==='guided-page-start'?'60':id==='guided-page-limit'?'1':'',dispatchEvent(e){events.push([id,e.type]);}});
  fields.set('guided-tab-asset',{click(){mode='asset';events.push(['tab','asset']);}});
  const nav={dataset:{view:'guided'},click(){events.push(['nav','guided']);}};
  return {fields,events,get mode(){return mode;},document:{getElementById:id=>fields.get(id),querySelectorAll:()=>[nav],defaultView:{Event}}};
}
test('new-asset handoff resets stale history pagination and opens the actual asset panel',()=>{
  const f=fixture();handoffKnownAsset(f.document,{actor,instanceHex});assert.equal(f.mode,'asset');assert.equal(f.fields.get('guided-page-start').value,'0');assert.equal(f.fields.get('guided-page-limit').value,'5');assert.equal(f.fields.get('guided-instance').value,instanceHex);assert.equal(f.fields.get('guided-actor').value,actor);assert.deepEqual(f.events.slice(-2),[['tab','asset'],['nav','guided']]);
});
test('historical handoff preserves its exact sequence and single-record page without treating it as a current asset',()=>{
  const f=fixture();handoffKnownAsset(f.document,{actor,instanceHex,positionPageStart:'60',positionPageLimit:'1'});assert.equal(f.mode,'asset');assert.equal(f.fields.get('guided-page-start').value,'60');assert.equal(f.fields.get('guided-page-limit').value,'1');assert.equal(f.events.length,6);
});
test('invalid fields or unavailable controls leave the previous form untouched',()=>{
  for(const change of [{actor:'bad'},{instanceHex:'ABC'},{positionPageStart:'01'},{positionPageStart:'18446744073709551616'},{positionPageLimit:'2'}]){const f=fixture();assert.throws(()=>handoffKnownAsset(f.document,{actor,instanceHex,...change}));assert.equal(f.events.length,0);assert.equal(f.fields.get('guided-page-start').value,'60');}
  const f=fixture();f.fields.delete('guided-tab-asset');assert.throws(()=>handoffKnownAsset(f.document,{actor,instanceHex}));assert.equal(f.fields.get('guided-instance').value,'');assert.equal(f.events.length,0);
});
test('ordinary and single-history page sizes exist in the actual guided select',async()=>{
  const html=await readFile(new URL('../apps/player/dist/index.html',import.meta.url),'utf8'),select=html.match(/<select\b[^>]*id="guided-page-limit"[^>]*>([\s\S]*?)<\/select>/)?.[1];assert.ok(select);for(const size of ['1','5'])assert.match(select,new RegExp(`<option value="${size}"`));
});
