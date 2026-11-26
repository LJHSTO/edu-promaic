import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { classroomAuditDomain, maximumAuditBytes, readAuditSnapshot } from '../../code/backend/classroom-audit.js';
import { createStoreProtection } from '../../code/backend/classroom-protection.js';
import { createClassroom } from '../../code/backend/classroom.js';
import { historicalAuditSnapshot } from '../fixtures/audit-snapshot.js';
import { classId, fixture, request, sessionRetentionDays, withServer } from '../fixtures/protected-http.js';

const run = promisify(execFile);
async function rollover(settings) {
  const filePath = join(settings.dataDirectory, 'access-audit.json');
  const archive = join(settings.folder, 'archived.json');
  const checkpointPath = join(settings.folder, 'checkpoint.json');
  const candidate = join(settings.dataDirectory, 'access-audit.next.json');
  const command = async args => (await run(process.execPath, ['scripts/classroom-audit.js', ...args], { env: settings.env })).stdout;
  const checkpoint = await command(['export', '--file', filePath, '--out', archive]);
  await writeFile(checkpointPath, checkpoint, { mode: 0o600 });
  await command(['rollover', '--file', filePath, '--archive', archive, '--checkpoint', checkpointPath, '--out', candidate]);
  assert.deepEqual(JSON.parse(await command(['verify', '--file', candidate, '--checkpoint', checkpointPath])), JSON.parse(checkpoint));
  const configuration = JSON.parse(await readFile(settings.configuration, 'utf8'));
  await writeFile(settings.configuration, JSON.stringify({ ...configuration, auditCheckpointFile: checkpointPath }));
  await rename(candidate, filePath);
  return readAuditSnapshot({ filePath: archive, key: settings.auditKey, checkpoint: JSON.parse(checkpoint) });
}

test('受保护入口使用 TLS 和文件凭据，启动清理到期会话，停机轮转后续记审计', async t => {
  const settings = await fixture(t);
  const classroom = '/api/classroom';
  const filePath = join(settings.dataDirectory, `${classId}.sealed.json`);
  const protection = createStoreProtection({ key: settings.storeKey, domain: `class:${classId}` });
  const now = () => Date.now() - 31 * 24 * 60 * 60 * 1000;
  const former = createClassroom({ filePath, protection, sessionRetentionDays, now });
  former.publish();
  former.createSession('old-session', 'sample-student');
  let sessionId;
  await withServer(settings, async () => {
    assert.equal(protection.open(await readFile(filePath, 'utf8')).sessions.length, 0);
    assert.equal((await request(settings, '/api/health')).status, 200);
    assert.equal((await request(settings, classroom)).status, 401);
    assert.equal((await request(settings, `${classroom}/publish`, { role: 'student', method: 'POST' })).status, 403);
    assert.equal((await request(settings, `${classroom}/publish`, { role: 'teacher', method: 'POST' })).status, 200);
    const session = await request(settings, `${classroom}/sessions`, { role: 'student', method: 'POST' });
    assert.equal(session.status, 201);
    sessionId = session.result.data.id;
  });
  const sealed = await readFile(filePath, 'utf8');
  assert.equal(typeof JSON.parse(sealed).ciphertext, 'string');
  assert.ok(!sealed.includes(sessionId));
  const archived = await rollover(settings);
  assert.ok(archived.state.records.some(entry => entry.action === 'session.create' && entry.outcome === 'success'));
  assert.ok(archived.state.records.some(entry => entry.action === 'retention.prune' && entry.outcome === 'success'));
  await withServer(settings, async () => {
    const session = await request(settings, `${classroom}/sessions/${sessionId}`, { role: 'student' });
    assert.equal(session.status, 200);
    assert.equal(session.result.data.id, sessionId);
    const audit = await request(settings, `${classroom}/audit`, { role: 'auditor' });
    assert.equal(audit.status, 200);
    assert.ok(audit.result.data.some(entry => entry.action === 'session.read' && entry.outcome === 'success'));
  });
  const auditFile = join(settings.dataDirectory, 'access-audit.json');
  const active = readAuditSnapshot({ filePath: auditFile, key: settings.auditKey, checkpoint: archived.checkpoint });
  assert.ok(active.checkpoint.sequence > archived.checkpoint.sequence);
  await rename(auditFile, join(settings.folder, 'held-active.json'));
  await assert.rejects(run(process.execPath, ['code/backend/server.js'], { env: settings.env, timeout: 8000 }), {
    code: 1, stderr: /审计快照早于已保存的检查点/
  });
});

test('受保护入口在审计余量不足时拒绝发布并输出一次容量告警', async t => {
  const settings = await fixture(t);
  const auditFile = join(settings.dataDirectory, 'access-audit.json');
  const classFile = join(settings.dataDirectory, `${classId}.sealed.json`);
  const protection = createStoreProtection({ key: settings.storeKey, domain: `class:${classId}` });
  const sealed = protection.seal({ published: false, sessions: [] });
  const audit = historicalAuditSnapshot({
    key: settings.auditKey, domain: classroomAuditDomain, limit: maximumAuditBytes - 350
  });
  await Promise.all([
    writeFile(auditFile, audit, { mode: 0o600 }),
    writeFile(classFile, sealed, { mode: 0o600 })
  ]);

  const { stderr } = await withServer(settings, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { status, result } = await request(settings, '/api/classroom/publish', { role: 'teacher', method: 'POST' });
      assert.equal(status, 503);
      assert.equal(result.success, false);
    }
  });
  assert.equal(await readFile(auditFile, 'utf8'), audit);
  assert.equal(await readFile(classFile, 'utf8'), sealed);
  assert.deepEqual(stderr.trim().split('\n').map(line => JSON.parse(line)), [{
    code: 'CLASSROOM_AUDIT_CAPACITY', level: 'critical', usedBytes: Buffer.byteLength(audit), limitBytes: maximumAuditBytes
  }]);
});
