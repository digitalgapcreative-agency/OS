import test from 'node:test';
import assert from 'node:assert/strict';
import {asOfMonth,calculateCashSummary,outstanding} from '../server/finance-utils.mjs';
import {stageNames,serviceTemplates} from '../server/project-templates.mjs';
test('Cash receipts and payments exclude transfers',()=>{
  assert.deepEqual(calculateCashSummary([{kind:'income',amount:10_000_000},{kind:'expense',amount:2_500_000},{kind:'transfer',amount:4_000_000}]),{received:10_000_000,spent:2_500_000,net:7_500_000});
});
test('Partial payments reduce outstanding invoice balances',()=>{
  assert.equal(outstanding(5_000_000,[1_000_000,1_500_000]),2_500_000);
  assert.equal(outstanding(5_000_000,[5_000_000]),0);
});
test('Past reporting periods close at month end',()=>{
  assert.equal(asOfMonth('2026-10','2026-11-16'),'2026-10-31');
  assert.equal(asOfMonth('2026-11','2026-11-16'),'2026-11-16');
  assert.equal(asOfMonth('2026-12','2026-11-16'),'2026-11-16');
});
test('Full services follow official five stage method; paid diagnosis closes after planning',()=>{
  assert.equal(stageNames.length,5);
  for(const s of ['Brand & Strategy','Growth Systems','Structural Alignment']) assert.equal(serviceTemplates[s].length,5);
  assert.equal(serviceTemplates['Strategic Diagnosis'].length,3);
  for(const stages of Object.values(serviceTemplates))assert.ok(stages.every(tasks=>tasks.length>0));
});
