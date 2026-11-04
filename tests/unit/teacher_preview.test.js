import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSessions, filterSessions, summarizeSessions, toPreviewCsv } from '../../docs/software/prototype/teacher-preview.js';

test('教师预览分母排除未开始验证，筛选后同步重算', () => {
  assert.deepEqual(summarizeSessions(previewSessions), { total: 4, attempted: 3, firstPass: 2, missing: 1 });
  assert.deepEqual(summarizeSessions(filterSessions('retry')), { total: 1, attempted: 1, firstPass: 0, missing: 0 });
  assert.deepEqual(summarizeSessions(filterSessions('pending')), { total: 1, attempted: 0, firstPass: 0, missing: 1 });
  assert.deepEqual(summarizeSessions([]), { total: 0, attempted: 0, firstPass: 0, missing: 0 });
});

test('导出只包含筛选会话并明确标为合成数据', () => {
  const csv = toPreviewCsv(filterSessions('first'));
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.match(csv, /"synthetic","DEMO-01"/);
  assert.match(csv, /"synthetic","DEMO-03"/);
  assert.doesNotMatch(csv, /DEMO-02|DEMO-04|events|student_name|answerKey/);
  assert.equal(toPreviewCsv([]).trim().split('\r\n').length, 1);
});
