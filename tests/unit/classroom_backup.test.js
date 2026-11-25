import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classroomAuditDomain, createAuditLog } from '../../code/backend/classroom-audit.js';
import { backupClassrooms, restoreClassrooms, verifyClassroomBackup } from '../../code/backend/classroom-backup.js';
import { createStoreProtection } from '../../code/backend/classroom-protection.js';
import { createClassroom } from '../../code/backend/classroom.js';

async function createFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'edu-classroom-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const backup = join(directory, 'backup');
  const target = join(directory, 'target');
  const keys = { storeKey: randomBytes(32), auditKey: randomBytes(32) };
  const protection = createStoreProtection({ key: keys.storeKey, domain: 'class:calculus-a' });
  const room = createClassroom({ filePath: join(source, 'calculus-a.sealed.json'), protection });
  room.publish();
  const session = room.createSession('demo-start', 'sample-account');
  const audit = createAuditLog({
    filePath: join(source, 'access-audit.json'), key: keys.auditKey, domain: classroomAuditDomain
  });
  audit.append({ action: 'lesson.publish', outcome: 'success', requestId: 'sample-request', classId: 'calculus-a' });
  return { directory, source, backup, target, keys, session, protection };
}

test('备份验证清单后可恢复班级会话与审计，复制保留密文', async t => {
  const { source, backup, target, keys, session, protection } = await createFixture(t);
  assert.deepEqual(backupClassrooms(source, backup, keys), { classrooms: 1, files: 2 });
  assert.deepEqual(verifyClassroomBackup(backup, keys), { classrooms: 1, files: 2 });
  assert.deepEqual(restoreClassrooms(backup, target, keys), { classrooms: 1, files: 2 });
  const name = 'calculus-a.sealed.json';
  const saved = await readFile(join(source, name), 'utf8');
  assert.equal(await readFile(join(target, name), 'utf8'), saved);
  assert.doesNotMatch(saved, /sample-account|demo-start/);
  const room = createClassroom({ filePath: join(target, name), protection });
  assert.deepEqual(room.getSession(session.id, 'sample-account'), session);
  const audit = createAuditLog({
    filePath: join(target, 'access-audit.json'), key: keys.auditKey, domain: classroomAuditDomain
  });
  assert.equal(audit.tail({ classId: 'calculus-a' })[0].outcome, 'success');
  assert.deepEqual((await readdir(target)).sort(), ['access-audit.json', name]);
});

test('清单修改、文件替换和错误密钥都会在恢复前被发现', async t => {
  const { source, backup, target, keys, protection } = await createFixture(t);
  backupClassrooms(source, backup, keys);
  assert.throws(() => verifyClassroomBackup(backup, { ...keys, storeKey: randomBytes(32) }), /校验失败/);
  const name = 'calculus-a.sealed.json';
  await writeFile(join(backup, name), protection.seal({ published: false, sessions: [] }));
  assert.throws(() => restoreClassrooms(backup, target, keys), /清单校验失败/);
  await assert.rejects(readFile(join(target, name)), { code: 'ENOENT' });
  await writeFile(join(backup, name), await readFile(join(source, name)));
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
  manifest.tag = randomBytes(32).toString('base64url');
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => verifyClassroomBackup(backup, keys), /清单校验失败/);
});

test('备份和恢复只使用新目录，源目录额外文件会阻止复制', async t => {
  const { source, backup, target, directory, keys } = await createFixture(t);
  backupClassrooms(source, backup, keys);
  await mkdir(target);
  await writeFile(join(target, 'marker'), '保留');
  assert.throws(() => restoreClassrooms(backup, target, keys), { code: 'EEXIST' });
  assert.equal(await readFile(join(target, 'marker'), 'utf8'), '保留');
  await writeFile(join(source, 'test-not-a-snapshot.txt'), '额外文件');
  assert.throws(() => backupClassrooms(source, join(directory, 'other'), keys), /未识别/);
});

test('备份命令支持凭证文件，拒绝同一凭证的两种配置', async t => {
  const { source, backup, directory, keys } = await createFixture(t);
  const storeFile = join(directory, 'store.credential');
  const auditFile = join(directory, 'audit.credential');
  await writeFile(storeFile, keys.storeKey.toString('base64') + '\n');
  await writeFile(auditFile, keys.auditKey.toString('base64') + '\n');
  const env = { ...process.env };
  delete env.CLASSROOM_STORE_KEY;
  delete env.CLASSROOM_AUDIT_KEY;
  env.CLASSROOM_STORE_KEY_FILE = storeFile;
  env.CLASSROOM_AUDIT_KEY_FILE = auditFile;
  const result = spawnSync(process.execPath, ['scripts/classroom-backup.js', 'backup', source, backup], {
    env, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { classrooms: 1, files: 2 });
  env.CLASSROOM_STORE_KEY = keys.storeKey.toString('base64');
  const duplicate = spawnSync(process.execPath, ['scripts/classroom-backup.js', 'verify', backup], {
    env, encoding: 'utf8'
  });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /只能配置一个/);
  assert.doesNotMatch(duplicate.stderr, new RegExp(env.CLASSROOM_STORE_KEY.replaceAll('+', '\\+')));
});
