import test from 'node:test';
import assert from 'node:assert/strict';
import { editWeight, inputWeights, weightInputError, weightInputs, weightTotal } from '../src/weight-input.ts';

const initial = { a:'26.6', b:'13.97', c:'26.6', d:'7.38', e:'15.45', f:'10' };

test('Editing one weight leaves every other displayed dimension unchanged', () => {
  const reduced = editWeight(initial, 'a', '21.8').inputs;
  assert.deepEqual(reduced, {...initial, a:'21.8'});
  assert.equal(weightTotal(reduced), 95.2);
  const transferred = editWeight(reduced, 'b', '18.77').inputs;
  assert.deepEqual(transferred, {...reduced,b:'18.77'});
  assert.equal(weightTotal(transferred), 100);
  assert.equal(weightInputError(transferred), '');
});

test('All characters can be deleted and retyped without a forced leading zero', () => {
  const empty = editWeight(initial,'a','').inputs;
  assert.equal(empty.a, '');
  assert.match(weightInputError(empty), /完整填写/);
  assert.equal(editWeight(empty,'a','21.8').inputs.a, '21.8');
  assert.equal(editWeight(empty,'a','.').inputs.a, '.');
  assert.match(weightInputError({...empty,a:'.'}), /完整填写/);
});

test('Total stays at or below 100 with no redistribution, including 0 and 100 endpoints', () => {
  const capped = editWeight(initial,'a','99');
  assert(capped.limited);
  assert.equal(capped.maximum,26.6);
  assert.deepEqual(capped.inputs,initial);
  const zero = Object.fromEntries(Object.keys(initial).map(k=>[k,'0']));
  assert.equal(editWeight(zero,'a','100').inputs.a, '100');
  assert.equal(weightInputError(editWeight(zero,'a','100').inputs), '');
  assert.equal(editWeight(initial,'a','-1'),null);
  assert.equal(editWeight(initial,'a','1e2'),null);
});

test('Preview and save reject incomplete totals at exact hundredth-percent precision', () => {
  assert.match(weightInputError({...initial,a:'26.59'}), /99.99%.*0.01%/);
  assert.match(weightInputError({...initial,a:'26.61'}), /100.01%.*0.01%/);
  assert.equal(weightInputError(initial),'');
  assert(Math.abs(Object.values(inputWeights(initial)).reduce((s,v)=>s+v,0)-1)<1e-12);
});

test('Loaded high precision versions display 100% without mutating the source', () => {
  const weights={a:1/6,b:1/6,c:1/6,d:1/6,e:1/6,f:1/6};
  const before=JSON.stringify(weights);
  const inputs=weightInputs(weights);
  assert.equal(weightTotal(inputs),100);
  assert.equal(weightInputError(inputs),'');
  assert.equal(JSON.stringify(weights),before);
  assert(Object.values(inputs).every(v=>Number(v)===16.66||Number(v)===16.67));
});
