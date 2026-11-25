import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClassroom } from '../../code/backend/classroom.js';
import { createStoreProtection } from '../../code/backend/classroom-protection.js';
import { loadProtectedProfile } from '../../code/backend/protected-profile.js';

const day = 86_400_000;
const initialTime = Date.UTC(2026, 10, 1);
const owner = 'fixture-student';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'edu-classroom-retention-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'calculus-a.sealed.json');
  const storeKey = randomBytes(32);
  const protection = createStoreProtection({ key: storeKey, domain: 'class:calculus-a' });
  let time = initialTime;
  return {
    dir, filePath, storeKey,
    open: options => createClassroom({ filePath, protection, now: () => time, ...options }),
    read: () => protection.open(readFileSync(filePath, 'utf8')),
    write: state => writeFileSync(filePath, protection.seal(state)),
    setTime: value => { time = value; }
  };
}

function start(room, key = 'session') {
  room.publish();
  return room.createSession(key, owner);
}

function answer(room, session, eventId) {
  return room.submit(session.id, { eventId, revision: session.revision, action: 'answer', choice: 'b' }, owner);
}

test('省略留存期限不会清理既有会话，也不会迁移旧记录', t => {
  const storage = fixture(t);
  const session = start(storage.open());
  const state = storage.read();
  delete state.sessions[0].lastActivityAt;
  storage.write(state);
  storage.setTime(initialTime + 1_000 * day);
  const restored = storage.open();
  assert.equal(restored.sweepExpiredSessions(), 0);
  assert.equal(restored.getSession(session.id, owner).id, session.id);
  assert.deepEqual(storage.read(), state);
});

test('期限从最后提交开始，读取及同一操作重试不会续期', async t => {
  const storage = fixture(t);
  let clears = 0;
  const room = storage.open({ sessionRetentionDays: 1, commitPruning(persist) { clears++; persist(); } });
  const session = start(room);
  storage.setTime(initialTime + day / 2);
  assert.equal((await answer(room, session, 'answer')).phase, 'verification');
  storage.setTime(initialTime + 1.5 * day - 1);
  assert.equal((await answer(room, session, 'answer')).phase, 'verification');
  assert.equal(room.createSession('session', owner).id, session.id);
  assert.equal(room.teacherOverview().summary.sessions, 1);
  assert.equal(clears, 0);

  storage.setTime(initialTime + 1.5 * day);
  assert.equal(room.teacherExport().includes(session.id), false);
  assert.throws(() => room.getSession(session.id, owner), { status: 404 });
  assert.equal(room.teacherOverview().summary.sessions, 0);
  assert.equal(storage.read().sessions.length, 0);
  assert.equal(clears, 1);
  assert.notEqual(room.createSession('session', owner).id, session.id);
});

test('旧会话使用最后可信事件，任一时间缺失时获得跨重启的完整保留期', async t => {
  const storage = fixture(t);
  const room = storage.open();
  const old = start(room, 'old');
  const uncertain = start(room, 'uncertain');
  const empty = start(room, 'empty');
  await answer(room, old, 'old-answer');
  const verified = await answer(room, uncertain, 'uncertain-practice');
  await answer(room, verified, 'uncertain-verify');

  const legacy = storage.read();
  for (const session of legacy.sessions) delete session.lastActivityAt;
  delete legacy.sessions.find(session => session.id === uncertain.id).events[1].at;
  storage.write(legacy);

  storage.setTime(initialTime + 3 * day);
  const migrated = storage.open({ sessionRetentionDays: 1 });
  assert.equal(migrated.sweepExpiredSessions(), 1);
  assert.deepEqual(storage.read().sessions.map(item => [item.id, item.lastActivityAt]), [
    [uncertain.id, initialTime + 3 * day], [empty.id, initialTime + 3 * day]
  ]);

  storage.setTime(initialTime + 4 * day - 1);
  const restarted = storage.open({ sessionRetentionDays: 1 });
  assert.equal(restarted.teacherOverview().summary.sessions, 2);
  storage.setTime(initialTime + 4 * day);
  assert.equal(restarted.sweepExpiredSessions(), 2);
  assert.deepEqual(storage.read().sessions, []);
});

test('会话到期后在途的学伴回复不会复活已清理记录', async t => {
  const storage = fixture(t);
  const entered = Promise.withResolvers();
  const agent = Promise.withResolvers();
  const room = storage.open({ sessionRetentionDays: 1, agent: () => { entered.resolve(); return agent.promise; } });
  const session = start(room);
  const pending = room.submit(session.id, { eventId: 'help', revision: 0, action: 'help' }, owner);
  await entered.promise;
  storage.setTime(initialTime + day);
  const next = room.createSession('next', owner);
  agent.resolve({ hint: null, trace: {} });
  await assert.rejects(pending, { status: 404 });
  assert.deepEqual(storage.read().sessions.map(item => item.id), [next.id]);
});

test('清理失败时不返回过期记录，恢复后可安全重试', t => {
  const storage = fixture(t);
  const room = storage.open({ sessionRetentionDays: 1 });
  const session = start(room);
  const original = storage.read();
  const savedPath = `${storage.filePath}.saved`;
  renameSync(storage.filePath, savedPath);
  mkdirSync(storage.filePath);
  storage.setTime(initialTime + day);
  assert.throws(() => room.getSession(session.id, owner));
  rmSync(storage.filePath, { recursive: true });
  renameSync(savedPath, storage.filePath);
  assert.deepEqual(storage.read(), original);
  assert.equal(room.sweepExpiredSessions(), 1);
  assert.deepEqual(storage.read().sessions, []);
});

test('保护配置执行清理并记录班级级审计，非法期限拒绝启动', t => {
  const storage = fixture(t);
  storage.setTime(Date.now() - 2 * day);
  start(storage.open());
  const classId = 'calculus-a';
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 });
  writeFileSync(join(storage.dir, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(storage.dir, 'tls.fixture'), 'protected profile fixture');
  const configPath = join(storage.dir, 'config.json');
  const config = {
    issuer: 'https://identity.example.test', origin: 'https://learning.example.test', audience: 'fixture',
    acceptedAcr: ['urn:example:auth:mfa'], memberships: [{ subject: owner, classId, role: 'student' }],
    defaultClass: classId, dataDirectory: storage.dir, publicKeyFile: 'public.pem', tlsKeyFile: 'tls.fixture',
    tlsCertFile: 'tls.fixture'
  };
  const keys = { storeKeyText: storage.storeKey.toString('base64'), auditKeyText: randomBytes(32).toString('base64') };
  const load = options => {
    writeFileSync(configPath, JSON.stringify({ ...config, ...options }));
    return loadProtectedProfile(configPath, keys);
  };
  assert.equal(load().sweepExpiredSessions, undefined);
  assert.throws(() => load({ sessionRetentionDays: 0 }), /sessionRetentionDays/);
  const protectedProfile = load({ sessionRetentionDays: 1 });
  assert.equal(protectedProfile.sweepExpiredSessions(), 1);
  assert.equal(protectedProfile.sweepExpiredSessions(), 0);
  assert.deepEqual(storage.read().sessions, []);
  const records = protectedProfile.auditTrail(classId);
  assert.deepEqual(records.map(({ action, outcome, actor }) => [action, outcome, actor]), [
    ['retention.prune', 'allowed', null], ['retention.prune', 'success', null]
  ]);
  assert.equal(records[0].requestId, records[1].requestId);
});
