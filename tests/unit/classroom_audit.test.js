import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classroomAuditDomain, createAuditLog, maximumAuditBytes, prepareAuditRollover, readAuditSnapshot, verifyAuditSnapshot
} from '../../code/backend/classroom-audit.js';
import { historicalAuditSnapshot } from '../fixtures/audit-snapshot.js';

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

function rollover(directory, filePath, number, previous) {
  const archive = join(directory, `archive-${number}.json`);
  const checkpoint = join(directory, `checkpoint-${number}.json`);
  const next = join(directory, `next-${number}.json`);
  const environment = keyEnvironment();
  const options = previous ? ['--checkpoint', previous] : [];
  const exported = runCli(environment, 'export', '--file', filePath, '--out', archive, ...options);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(checkpoint, exported.stdout);
  const arguments_ = ['rollover', '--file', filePath, '--archive', archive, '--checkpoint', checkpoint, '--out', next];
  const result = runCli(environment, ...arguments_);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, exported.stdout);
  return { next, archive, checkpoint, arguments_ };
}

test('连续两次分段续写保持序号和链头，旧检查点通过上一份归档衔接', t => {
  const { directory, filePath, log } = auditFixture(t);
  log.append(entry('old-1'));
  const firstRecordCheckpoint = readAuditSnapshot({ filePath, key }).checkpoint;
  log.append(entry('old-2'));
  const first = rollover(directory, filePath, 1);
  const empty = readAuditSnapshot({ filePath: first.next, key });
  const firstHead = JSON.parse(readFileSync(first.checkpoint, 'utf8'));
  assert.deepEqual(empty.checkpoint, firstHead);
  assert.deepEqual(empty.state.records, []);
  assert.equal(empty.state.version, 2);
  assert.equal(readAuditSnapshot({ filePath: filePath, key }).state.version, 1);
  assert.deepEqual(readAuditSnapshot({ filePath: first.archive, key, checkpoint: firstRecordCheckpoint }).checkpoint, firstHead);
  assert.throws(() => readAuditSnapshot({ filePath: first.next, key, checkpoint: firstRecordCheckpoint }), /上一份归档/);

  createAuditLog({ filePath: first.next, key, domain }).append(entry('new-3'));
  const middle = readAuditSnapshot({ filePath: first.next, key, checkpoint: firstHead });
  assert.equal(middle.state.records[0].previous, firstHead.head);
  assert.equal(middle.state.records[0].sequence, 3);
  const second = rollover(directory, first.next, 2, first.checkpoint);
  assert.deepEqual(readAuditSnapshot({ filePath: second.archive, key, checkpoint: firstHead }).checkpoint, middle.checkpoint);
  const reopened = createAuditLog({ filePath: second.next, key, domain });
  reopened.append(entry('new-4'));
  const latest = readAuditSnapshot({ filePath: second.next, key, checkpoint: middle.checkpoint });
  assert.equal(latest.state.records[0].previous, middle.checkpoint.head);
  assert.equal(latest.checkpoint.sequence, 4);
  assert.deepEqual(reopened.tail({ classId: 'alpha' }).map(item => item.requestId), ['new-4']);
  assert.throws(() => readAuditSnapshot({ filePath: second.archive, key, checkpoint: latest.checkpoint }), /早于/);
  const collision = runCli(keyEnvironment(), ...second.arguments_);
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /已存在/);
  assert.deepEqual(readAuditSnapshot({ filePath: second.next, key }).checkpoint, latest.checkpoint);
});

test('分段序号相同的历史分支无法通过检查点，普通检查点不能充当分段签名', t => {
  const { directory, filePath, log } = auditFixture(t);
  log.append(entry('old-1'));
  const first = rollover(directory, filePath, 1);
  const empty = readAuditSnapshot({ filePath: first.next, key });
  const fork = join(directory, 'fork.json');
  writeFileSync(fork, JSON.stringify(empty.state));
  createAuditLog({ filePath: first.next, key, domain }).append(entry('selected-2'));
  createAuditLog({ filePath: fork, key, domain }).append(entry('other-2'));
  const active = readAuditSnapshot({ filePath: first.next, key });
  assert.throws(() => readAuditSnapshot({ filePath: fork, key, checkpoint: active.checkpoint }), /检查点不一致/);

  const { state } = empty;
  const unsignedStart = { ...state, start: { ...state.start, tag: empty.checkpoint.tag } };
  assert.throws(() => verifyAuditSnapshot({ text: JSON.stringify(unsignedStart), key }), /分段起点签名/);
});

test('轮换要求当前末尾、独立归档和完整原段', t => {
  const { directory, filePath, log } = auditFixture(t);
  log.append(entry('old-1'));
  const prior = readAuditSnapshot({ filePath, key }).checkpoint;
  log.append(entry('old-2'));
  const text = readFileSync(filePath, 'utf8');
  const { checkpoint } = readAuditSnapshot({ filePath, key });
  assert.throws(() => prepareAuditRollover({ text, archiveText: text, key, checkpoint: prior }), /分段末尾/);
  const unrelated = join(directory, 'unrelated.json');
  createAuditLog({ filePath: unrelated, key, domain }).append(entry('other-1'));
  assert.throws(() => prepareAuditRollover({ text, archiveText: readFileSync(unrelated, 'utf8'), key, checkpoint }), /完全一致/);
  const empty = prepareAuditRollover({ text, archiveText: text, key, checkpoint });
  const emptyText = JSON.stringify(empty.state);
  assert.throws(() => prepareAuditRollover({ text: emptyText, archiveText: emptyText, key, checkpoint }), /尚无记录/);
  const checkpointFile = join(directory, 'checkpoint.json');
  writeFileSync(checkpointFile, JSON.stringify(checkpoint));
  const output = join(directory, 'candidate.json');
  const failed = runCli(keyEnvironment(), 'rollover', '--file', filePath, '--archive', filePath,
    '--checkpoint', checkpointFile, '--out', output);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /各自保管/);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(filePath, 'utf8'), text);
});

test('接近上限时为已授权请求预留结果，后续写入无法占用余量', t => {
  const { filePath } = auditFixture(t);
  const text = historicalAuditSnapshot({ key, domain, limit: maximumAuditBytes - 535 });
  writeFileSync(filePath, text);
  const start = readAuditSnapshot({ filePath, key }).checkpoint;
  const log = createAuditLog({ filePath, key, domain });
  const ongoing = log.begin({ action: 'data.read', requestId: 'ongoing', classId: 'alpha' });
  const second = { action: 'data.read', requestId: 'second', classId: 'alpha' };
  assert.throws(() => log.begin(second), /容量上限/);
  assert.throws(() => log.append(entry('larger-denial', { outcome: 'denied', actor: 'a'.repeat(120) })), /容量上限/);
  ongoing('error');
  assert.throws(() => ongoing('success'), /已记录/);
  const { state } = readAuditSnapshot({ filePath, key, checkpoint: start });
  assert.deepEqual(state.records.slice(start.sequence).map(({ requestId, outcome }) => [requestId, outcome]), [
    ['ongoing', 'allowed'], ['ongoing', 'error']
  ]);
});

test('启动和跨过容量阈值时只通知当前级别，回执仅含容量数据', t => {
  const { filePath } = auditFixture(t);
  const text = historicalAuditSnapshot({ key, domain, limit: Math.ceil(maximumAuditBytes * 0.95) - 1 });
  writeFileSync(filePath, text);
  const warnings = [];
  const log = createAuditLog({ filePath, key, domain, onCapacityWarning: metadata => warnings.push(metadata) });
  log.append(entry('trigger-critical', { actor: 'a'.repeat(120) }));
  const bytesAtCritical = Buffer.byteLength(readFileSync(filePath));
  log.append(entry('still-critical'));
  assert.deepEqual(warnings, [
    { level: 'warning', usedBytes: Buffer.byteLength(text), limitBytes: maximumAuditBytes },
    { level: 'critical', usedBytes: bytesAtCritical, limitBytes: maximumAuditBytes }
  ]);
});

test('接近容量上限的历史日志可独立归档并在新段继续写入', t => {
  const { directory, filePath } = auditFixture(t);
  const text = historicalAuditSnapshot({ key, domain });
  assert.ok(Buffer.byteLength(text) <= maximumAuditBytes);
  writeFileSync(filePath, text);
  const before = readAuditSnapshot({ filePath, key });
  const update = entry('x'.repeat(120), { actor: 'y'.repeat(120) });
  const open = path => createAuditLog({ filePath: path, key, domain });
  assert.throws(() => open(filePath).append(update), /容量上限/);
  assert.equal(readFileSync(filePath, 'utf8'), text);
  const { next, archive } = rollover(directory, filePath, 1);
  assert.equal(readFileSync(archive, 'utf8'), text);
  open(next).append(update);
  const result = readAuditSnapshot({ filePath: next, key, checkpoint: before.checkpoint });
  assert.equal(result.checkpoint.sequence, before.checkpoint.sequence + 1);
  assert.ok(Buffer.byteLength(readFileSync(next)) < 2048);
});
