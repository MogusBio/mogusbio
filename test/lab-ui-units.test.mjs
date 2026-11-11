import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProductionWeight,formatSolMovement} from '../apps/player/dist/lab-ui.js';
import {normalWeight} from '../packages/settlement/src/weights.mjs';
test('specimen weight display removes the exact frozen fixed-point factors without changing protocol accounting',()=>{
  for(const [scope,B,q,expected]of [['COMPONENT',120000n,1000000n,'120'],['CELL',480000n,1500000n,'756'],['BIO',7200000n,1500000n,'22680'],['BIO',7200000n,2000000n,'23760']])assert.equal(formatProductionWeight(normalWeight({scope,B_int:B,q_ppm:q}).toString()),expected);
  for(const raw of ['1','9999999999999999999999999999999999','480000000000']){const shown=formatProductionWeight(raw),[a,b='']=shown.split('.');assert.equal((BigInt(a)*10n**BigInt(b.length)+BigInt(b||'0'))*4000000000n,BigInt(raw)*10n**BigInt(b.length));}
  for(const raw of ['-1','01','1e9','NaN',undefined])assert.equal(formatProductionWeight(raw),'—');
});

test('seller income is shown as credit rather than an invalid unsigned debit',()=>{
  assert.equal(formatSolMovement('-10000000'),'SOL credit 0.01');assert.equal(formatSolMovement('1200000'),'SOL debit 0.0012');assert.equal(formatSolMovement('0'),'SOL debit 0');assert.equal(formatSolMovement('-9007199254740993'),'SOL credit 9007199.254740993');for(const bad of ['-0','-01','+1','1e3',undefined])assert.equal(formatSolMovement(bad),'SOL movement not recorded');
});
