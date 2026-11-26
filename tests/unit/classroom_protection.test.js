import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAuditLog } from '../../code/backend/classroom-audit.js';
import {
  createStoreProtection, maximumSealedBytes, readBoundedFile, replacePrivateFile
} from '../../code/backend/classroom-protection.js';

const key = Buffer.alloc(32, 7);
const domain = 'classroom.alpha';

function tempDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'edu-protection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('课堂文件加密往返使用独立随机 nonce，密文文件不包含课堂数据或密钥', () => {
  const protection = createStoreProtection({ key, domain });
  const classroom = { published: true, sessions: [{ id: 'session-test', feedback: '练习结束' }] };
  const sealed = protection.seal(classroom);
  const envelope = JSON.parse(sealed);
  const another = JSON.parse(protection.seal(classroom));
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'iv', 'tag', 'version']);
  assert.equal(envelope.version, 1);
  assert.equal(Buffer.from(envelope.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(envelope.tag, 'base64url').length, 16);
  assert.notEqual(another.iv, envelope.iv);
  assert.notEqual(another.ciphertext, envelope.ciphertext);
  assert.doesNotMatch(sealed, /session-test|练习结束/);
  assert.equal(sealed.includes(key.toString('base64url')), false);
  assert.deepEqual(protection.open(sealed), classroom);
});

test('格式或认证错误时关闭读取，包括错误密钥、其他班级与明文', () => {
  const protection = createStoreProtection({ key, domain });
  const sealed = protection.seal({ published: true, sessions: [] });
  const envelope = JSON.parse(sealed);
  const otherClass = createStoreProtection({ key, domain: 'classroom.beta' });
  const otherKey = createStoreProtection({ key: Buffer.alloc(32, 9), domain });
  assert.throws(() => otherClass.open(sealed), /课堂存储校验失败/);
  assert.throws(() => otherKey.open(sealed), /课堂存储校验失败/);
  const invalidEnvelopes = [
    '{',
    JSON.stringify({ published: true, sessions: [] }),
    JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, iv: envelope.iv + '=' }),
    JSON.stringify({ ...envelope, tag: Buffer.alloc(16).toString('base64url') }),
    JSON.stringify({ ...envelope, note: 'unexpected' })
  ];
  for (const invalid of invalidEnvelopes) assert.throws(() => protection.open(invalid), /课堂存储校验失败/);
});

test('场景保护校验密钥和容量，在读取前拒绝过大的文件', t => {
  assert.throws(() => createStoreProtection({ key: Buffer.alloc(31), domain }), /32 字节/);
  assert.throws(() => createStoreProtection({ key, domain: 'bad domain' }), /保护域/);
  const protection = createStoreProtection({ key, domain });
  assert.throws(() => protection.seal([]), /JSON 对象/);
  assert.throws(() => protection.seal({ text: '课'.repeat(700000) }), /容量上限/);
  assert.throws(() => protection.open('x'.repeat(maximumSealedBytes + 1)), /课堂存储校验失败/);
  const filePath = join(tempDirectory(t), 'secure.json');
  replacePrivateFile(filePath, protection.seal({ published: true }));
  assert.throws(() => readBoundedFile(filePath, 10), /大小/);
  assert.deepEqual(protection.open(readBoundedFile(filePath, maximumSealedBytes)), { published: true });
});

test('审计按班级返回更新记录，重启验证完整链且不向查询方暴露全局序号', t => {
  const filePath = join(tempDirectory(t), 'audit.json');
  const options = { filePath, key, domain: 'audit.alpha' };
  const log = createAuditLog(options);
  log.append({ action: 'data.read', outcome: 'allowed', requestId: 'req-a', classId: 'alpha', actor: 'subject-hash' });
  log.append({ action: 'lesson.publish', outcome: 'success', requestId: 'req-b', classId: 'beta' });
  log.append({ action: 'data.read', outcome: 'denied', requestId: 'req-c' });
  log.append({ action: 'lesson.publish', outcome: 'error', requestId: 'req-d', classId: 'alpha' });
  assert.throws(() => log.append({ action: 'data.read', outcome: 'allowed', requestId: 'req-e', body: 'unexpected' }), /元数据/);
  assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).records.length, 4);
  const tail = log.tail({ classId: 'alpha' });
  assert.deepEqual(tail.map(({ requestId }) => requestId), ['req-a', 'req-d']);
  assert.deepEqual(Object.keys(tail[0]).sort(), ['action', 'actor', 'at', 'classId', 'outcome', 'requestId']);
  assert.deepEqual(log.tail({ classId: 'alpha', limit: 1 }), [tail[1]]);
  assert.throws(() => log.tail({}), /班级标识/);
  assert.deepEqual(createAuditLog(options).tail({ classId: 'alpha' }), tail);
});

test('审计文件重启校验会拒绝修改的记录、错误密钥和复制到其他保护域的记录', t => {
  const filePath = join(tempDirectory(t), 'audit.json');
  const options = { filePath, key, domain: 'audit.alpha' };
  const log = createAuditLog(options);
  log.append({ action: 'data.read', outcome: 'success', requestId: 'req-a', classId: 'alpha' });
  assert.throws(() => createAuditLog({ ...options, key: Buffer.alloc(32, 9) }), /无法验证课堂审计/);
  assert.throws(() => createAuditLog({ ...options, domain: 'audit.beta' }), /无法验证课堂审计/);
  const content = JSON.parse(readFileSync(filePath, 'utf8'));
  content.records[0].outcome = 'denied';
  writeFileSync(filePath, JSON.stringify(content), 'utf8');
  assert.throws(() => createAuditLog(options), /无法验证课堂审计/);
});

test('审计写入失败后保留上次状态，恢复后可顺序追加', t => {
  const directory = tempDirectory(t);
  const dataPath = join(directory, 'data');
  const filePath = join(dataPath, 'audit.json');
  const savedPath = join(directory, 'saved');
  const log = createAuditLog({ filePath, key, domain: 'audit.alpha' });
  const metadata = { action: 'data.read', outcome: 'allowed', classId: 'alpha' };
  log.append({ ...metadata, requestId: 'req-a' });
  renameSync(dataPath, savedPath);
  writeFileSync(dataPath, 'blocked', 'utf8');
  assert.throws(() => log.append({ ...metadata, requestId: 'req-b' }));
  assert.deepEqual(log.tail({ classId: 'alpha' }).map(({ requestId }) => requestId), ['req-a']);
  rmSync(dataPath);
  renameSync(savedPath, dataPath);
  log.append({ ...metadata, requestId: 'req-c' });
  const reopened = createAuditLog({ filePath, key, domain: 'audit.alpha' });
  assert.deepEqual(reopened.tail({ classId: 'alpha' }).map(({ requestId }) => requestId), ['req-a', 'req-c']);
});
