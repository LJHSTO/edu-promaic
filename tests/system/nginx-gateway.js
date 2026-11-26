import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { readAuditSnapshot } from '../../code/backend/classroom-audit.js';
import { choosePort, classId, fixture, request, testCertificate, withServer } from '../fixtures/protected-http.js';

const frontName = 'learn.example.edu';
const backendName = 'classroom-backend.example.edu';
const templatePath = new URL('../../deployment/linux/nginx-classroom.example.conf', import.meta.url);

async function writeGateway(settings, frontend, { upstreamName = backendName, trustPath = settings.tlsCertFile } = {}) {
  const prefix = await mkdtemp(join(settings.folder, 'gateway-'));
  const accessLog = join(prefix, 'access.log');
  const siteFile = join(prefix, 'classroom.conf');
  const config = await readFile(templatePath, 'utf8');
  const replacements = new Map([
    ['listen 443 ssl;', `listen 127.0.0.1:${new URL(settings.origin).port} ssl;`],
    ['/etc/nginx/tls/classroom-chain.pem', frontend.tlsCertFile],
    ['/etc/nginx/tls/classroom-key.pem', frontend.tlsKeyFile],
    ['https://127.0.0.1:3443', `https://127.0.0.1:${settings.port}`],
    [backendName, upstreamName],
    ['/etc/nginx/trust/classroom-ca.pem', trustPath],
    ['/var/log/nginx/edu-promaic-access.log', accessLog]
  ]);
  let site = config;
  for (const [original, replacement] of replacements) {
    assert.ok(site.includes(original), `网关配置缺少 ${original}`);
    site = site.replace(original, replacement);
  }
  const temporaryDirectories = ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'];
  const temporaryPaths = temporaryDirectories.map(name => `    ${name}_temp_path ${name};`).join('\n');
  await Promise.all([
    writeFile(siteFile, site),
    writeFile(join(prefix, 'nginx.conf'), `daemon off;
master_process off;
error_log stderr;
pid nginx.pid;
events {}
http {
${temporaryPaths}
    include "${siteFile}";
}
`)
  ]);
  return { prefix, accessLog };
}

async function waitForGateway(client) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await request(client, '/api/health');
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
      await delay(20);
    }
  }
  throw new Error('网关未在测试时限内启动。');
}

async function withGateway(config, client, execute) {
  const child = spawn('nginx', ['-e', 'stderr', '-p', `${config.prefix}/`, '-c', 'nginx.conf'], {
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'close');
  try {
    const health = await Promise.race([
      waitForGateway(client),
      exited.then(([code]) => { throw new Error(`网关启动失败（${code}）${stderr.trim()}`); })
    ]);
    return await execute(health);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'close', { signal: AbortSignal.timeout(5000) });
      child.kill('SIGQUIT');
      assert.deepEqual(await stopped, [0, null]);
    }
  }
}

function verifyAccessLog(log, responses) {
  assert.doesNotMatch(log, /\/api\/|trace-marker|__Host-edu-promaic|sample-teacher/);
  const rows = log.trim().split('\n').map(line => JSON.parse(line));
  for (const record of rows) {
    assert.deepEqual(Object.keys(record).sort(), ['method', 'request_id', 'status', 'time']);
    assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
  }
  for (const [response, method] of responses) {
    const requestId = response.headers['x-request-id'];
    assert.match(requestId, /^[\da-f-]{36}$/);
    const entries = rows.filter(row => row.request_id === requestId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].method, method);
    assert.equal(entries[0].status, String(response.status));
  }
}

test('HTTPS 网关保留机构同源授权、拒绝跨源写入并关联签名审计', { timeout: 25000 }, async t => {
  const origin = `https://${frontName}:${await choosePort()}`;
  const settings = await fixture(t, { publicOrigin: origin, backendName });
  const frontendDir = await mkdtemp(join(settings.folder, 'frontend-'));
  const frontend = await testCertificate(frontendDir, frontName);
  const client = { ...settings, ca: frontend.ca };
  const config = await writeGateway(settings, frontend);
  const query = `class=${classId}&trace=trace-marker`;
  const read = `/api/classroom?${query}`;
  const publish = `/api/classroom/publish?${query}`;
  const operation = { role: 'teacher', method: 'POST' };
  const token = settings.credential('teacher');

  const { result: { anonymous, bearer, denied, accepted } } = await withServer(settings, async () => {
    const responses = await withGateway(config, client, async health => {
      assert.equal(health.status, 200);
      await assert.rejects(request({ ...client, ca: settings.ca }, '/api/health'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
      const unauthenticated = await request(client, read, { requestOrigin: null });
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.headers['www-authenticate'], 'Bearer');
      const crossOrigin = await request(client, publish, { ...operation, requestOrigin: 'https://outside.example.test' });
      assert.equal(crossOrigin.status, 403);
      const bearerRead = await request(client, read, { authorization: `Bearer ${token}`, requestOrigin: null });
      assert.equal(bearerRead.status, 200);
      assert.equal(bearerRead.result.data.published, false);
      const sameOrigin = await request(client, publish, operation);
      assert.equal(sameOrigin.status, 200);
      assert.equal(sameOrigin.result.data.published, true);
      return { anonymous: unauthenticated, bearer: bearerRead, denied: crossOrigin, accepted: sameOrigin };
    });
    for (const upstream of [{ upstreamName: 'wrong-backend.example.test' }, { trustPath: frontend.tlsCertFile }]) {
      const rejected = await writeGateway(settings, frontend, upstream);
      await withGateway(rejected, client, response => assert.equal(response.status, 502));
    }
    return responses;
  });
  const accessLog = await readFile(config.accessLog, 'utf8');
  assert.equal(accessLog.includes(token), false);
  verifyAccessLog(accessLog, [[anonymous, 'GET'], [bearer, 'GET'], [denied, 'POST'], [accepted, 'POST']]);
  const { state } = readAuditSnapshot({ filePath: join(settings.dataDirectory, 'access-audit.json'), key: settings.auditKey });
  const outcome = (response, action) => state.records
    .filter(record => record.requestId === response.headers['x-request-id'] && record.action === action)
    .map(record => record.outcome);
  assert.deepEqual(outcome(anonymous, 'lesson.read'), ['denied']);
  assert.deepEqual(outcome(bearer, 'lesson.read'), ['allowed', 'success']);
  assert.deepEqual(outcome(denied, 'lesson.publish'), ['denied']);
  assert.deepEqual(outcome(accepted, 'lesson.publish'), ['allowed', 'success']);
});
