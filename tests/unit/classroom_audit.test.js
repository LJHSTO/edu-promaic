import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classroomAuditDomain, createAuditLog, readAuditSnapshot, verifyAuditSnapshot
} from '../../code/backend/classroom-audit.js';

const key = Buffer.alloc(32, 19);
const domain = classroomAuditDomain;
const cliPath = fileURLToPath(new URL('../../scripts/classroom-audit.js', import.meta.url));

function auditFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'edu-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'audit.json');
  const log = createAuditLog({ filePath, key, domain });
  return { directory, filePath, log };
}

function entry(requestId, overrides = {}) {
  return { action: 'data.read', requestId, outcome: 'success', classId: 'alpha', ...overrides };
}

function runCli(environment, ...arguments_) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], { encoding: 'utf8', env: environment });
}

function keyEnvironment({ file } = {}) {
  const environment = { ...process.env };
  delete environment.CLASSROOM_AUDIT_KEY;
  delete environment.CLASSROOM_AUDIT_KEY_FILE;
  if (file) environment.CLASSROOM_AUDIT_KEY_FILE = file;
  else environment.CLASSROOM_AUDIT_KEY = key.toString('base64');
  return environment;
}

test('独立检查点接受同一链的后续记录，拒绝回退到旧快照', t => {
  const { filePath, log } = auditFixture(t);
  log.append(entry('request-1'));
  const oldSnapshot = readFileSync(filePath, 'utf8');
  const first = verifyAuditSnapshot({ text: oldSnapshot, key });
  log.append(entry('request-2'));
  const latest = readAuditSnapshot({ filePath, key, checkpoint: first.checkpoint });
  assert.equal(first.checkpoint.sequence, 1);
  assert.equal(latest.checkpoint.sequence, 2);
  assert.throws(() => verifyAuditSnapshot({ text: oldSnapshot, key, checkpoint: latest.checkpoint }), /早于/);
});

test('检查点拒绝有效的历史分支，签名保护检查点且绑定保护域', t => {
  const { directory, filePath, log } = auditFixture(t);
  log.append(entry('original-branch'));
  const { checkpoint } = readAuditSnapshot({ filePath, key });
  const fork = join(directory, 'fork.json');
  createAuditLog({ filePath: fork, key, domain }).append(entry('different-branch'));
  assert.throws(() => readAuditSnapshot({ filePath: fork, key, checkpoint }), /检查点不一致/);
  assert.throws(() => readAuditSnapshot({ filePath, key, checkpoint: { ...checkpoint, sequence: 0 } }), /签名/);
  const other = join(directory, 'other.json');
  const otherDomain = 'other-audit';
  createAuditLog({ filePath: other, key, domain: otherDomain }).append(entry('original-branch'));
  assert.throws(() => readAuditSnapshot({ filePath: other, key, domain: otherDomain, checkpoint }), /保护域/);
});

test('审计读取失败保留源文件，拒绝缺失、密钥不符或含重复字段的快照', t => {
  const { filePath, log } = auditFixture(t);
  assert.throws(() => readAuditSnapshot({ filePath, key }), { code: 'ENOENT' });
  log.append(entry('request-1'));
  const text = readFileSync(filePath, 'utf8');
  assert.throws(() => verifyAuditSnapshot({ text, key: Buffer.alloc(32, 2) }), /审计链/);
  const duplicate = text.replace('{"version":1,', '{"version":2,"version":1,');
  assert.throws(() => verifyAuditSnapshot({ text: duplicate, key }), /编码/);
  assert.equal(readFileSync(filePath, 'utf8'), text);
});

test('命令行经凭据文件验证并导出完整链，拒绝覆盖已有文件', t => {
  const { directory, filePath, log } = auditFixture(t);
  for (let number = 1; number <= 50; number++) log.append(entry(`request-${number}`));
  log.append(entry('unscoped-denial', { classId: null, outcome: 'denied' }));
  const latest = readFileSync(filePath, 'utf8');
  const keyFile = join(directory, 'credential');
  writeFileSync(keyFile, `${key.toString('base64')}\n`, { mode: 0o600 });
  const environment = keyEnvironment({ file: keyFile });
  const out = join(directory, 'archive.json');
  const result = runCli(environment, 'export', '--file', filePath, '--out', out);
  assert.equal(result.status, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.sequence, 51);
  assert.equal(readFileSync(out, 'utf8'), latest);
  assert.equal(readAuditSnapshot({ filePath: out, key, checkpoint }).state.records[50].classId, null);
  const conflict = runCli(environment, 'export', '--file', filePath, '--out', filePath);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /已存在/);
  assert.equal(readFileSync(filePath, 'utf8'), latest);
});

test('命令行用外部检查点验证归档，并在源历史回退时停止导出', t => {
  const { directory, filePath, log } = auditFixture(t);
  const environment = keyEnvironment();
  const out = join(directory, 'archive.json');
  const checkpointPath = join(directory, 'checkpoint.json');
  log.append(entry('request-1'));
  writeFileSync(out, readFileSync(filePath));
  log.append(entry('request-2'));
  const result = runCli(environment, 'verify', '--file', filePath);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(checkpointPath, result.stdout);
  const verified = runCli(environment, 'verify', '--file', filePath, '--checkpoint', checkpointPath);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.stdout, result.stdout);
  const rejected = join(directory, 'unverified.json');
  const rolledBack = runCli(environment, 'export', '--file', out, '--out', rejected, '--checkpoint', checkpointPath);
  assert.equal(rolledBack.status, 1);
  assert.match(rolledBack.stderr, /早于/);
  assert.equal(existsSync(rejected), false);
});
