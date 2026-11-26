import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { classroomAuditDomain, maximumAuditBytes, readAuditSnapshot } from '../../code/backend/classroom-audit.js';
import { createStoreProtection } from '../../code/backend/classroom-protection.js';
import { createClassroom } from '../../code/backend/classroom.js';
import { historicalAuditSnapshot } from '../fixtures/audit-snapshot.js';

const run = promisify(execFile);
const host = '127.0.0.1';
const issuer = 'https://identity.example.test';
const acr = 'urn:example:auth:mfa';
const classId = 'calculus-test';
const sessionRetentionDays = 30;

async function choosePort() {
  const socket = createServer().listen(0, host);
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function signCredential(subject, audience, key) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: audience, sub: subject, iat, exp: iat + 300, acr, jti: randomUUID(), client_id: 'test-portal' };
  const message = `${encode({ alg: 'RS256', typ: 'at+jwt' })}.${encode(claims)}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), key).toString('base64url')}`;
}

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'edu-protected-launch-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const port = await choosePort();
  const origin = `https://${host}:${port}`;
  const audience = `${origin}/api`;
  const dataDirectory = join(folder, 'data');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyFile = join(folder, 'identity.pem');
  const tlsKeyFile = join(folder, 'tls-key.pem');
  const tlsCertFile = join(folder, 'cert.pem');
  const storeKeyFile = join(folder, 'store.key');
  const auditKeyFile = join(folder, 'audit.key');
  const storeKey = randomBytes(32);
  const auditKey = randomBytes(32);
  const configuration = join(folder, 'security.json');
  await mkdir(dataDirectory);
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', tlsKeyFile, '-out', tlsCertFile
  ], { timeout: 15000 });
  const memberships = ['teacher', 'student', 'auditor'].map(role => ({ classId, role, subject: `sample-${role}` }));
  await Promise.all([
    writeFile(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' })),
    writeFile(storeKeyFile, storeKey.toString('base64') + '\n', { mode: 0o600 }),
    writeFile(auditKeyFile, auditKey.toString('base64') + '\n', { mode: 0o600 }),
    writeFile(configuration, JSON.stringify({
      issuer, audience, origin, publicKeyFile, tlsKeyFile, tlsCertFile, memberships, dataDirectory,
      acceptedAcr: [acr], defaultClass: classId, sessionRetentionDays
    }))
  ]);
  const env = {
    ...process.env, NODE_ENV: 'production', CLASSROOM_PROFILE: 'protected', HOST: host, PORT: String(port),
    CLASSROOM_SECURITY_CONFIG: configuration, CLASSROOM_STORE_KEY_FILE: storeKeyFile, CLASSROOM_AUDIT_KEY_FILE: auditKeyFile
  };
  for (const variable of ['CLASSROOM_STORE_KEY', 'CLASSROOM_AUDIT_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL']) delete env[variable];
  return {
    origin, env, folder, dataDirectory, configuration, storeKey, auditKey, ca: await readFile(tlsCertFile),
    credential: role => signCredential(`sample-${role}`, audience, privateKey)
  };
}

async function withServer(settings, execute) {
  const child = spawn(process.execPath, ['code/backend/server.js'], { env: settings.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', piece => { errors += piece; });
  try {
    const [line] = await Promise.race([
      once(child.stdout, 'data', { signal: AbortSignal.timeout(8000) }),
      exited.then(([status]) => { throw new Error(`服务启动失败（${status}） ${errors.trim()}`); })
    ]);
    assert.match(String(line), /Edu ProMAIC 已启动：https:\/\//);
    await execute();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close', { signal: AbortSignal.timeout(8000) });
      child.kill();
      const [status, signal] = await closed;
      assert.deepEqual([status, signal], [0, null]);
    } else {
      await exited;
    }
  }
  return errors;
}

async function request({ origin, ca, credential }, path, { role, method = 'GET', body } = {}) {
  const headers = { Origin: origin };
  if (role) headers.Cookie = `__Host-edu-promaic=${credential(role)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sent = httpsRequest(new URL(path, origin), {
    ca, method, headers, signal: AbortSignal.timeout(6000)
  });
  const pending = once(sent, 'response');
  sent.end(body === undefined ? undefined : JSON.stringify(body));
  const [response] = await pending;
  const chunks = [];
  for await (const item of response) chunks.push(item);
  return { status: response.statusCode, result: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

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

  const stderr = await withServer(settings, async () => {
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
