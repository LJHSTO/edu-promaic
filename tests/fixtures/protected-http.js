import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const host = '127.0.0.1';
const issuer = 'https://identity.example.test';
const acr = 'urn:example:auth:mfa';
export const classId = 'calculus-test';
export const sessionRetentionDays = 30;

export async function choosePort() {
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

export async function testCertificate(directory, name) {
  const tlsKeyFile = join(directory, 'tls-key.pem');
  const tlsCertFile = join(directory, 'cert.pem');
  const sanType = isIP(name) ? 'IP' : 'DNS';
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${name}`,
    '-addext', `subjectAltName=${sanType}:${name}`, '-keyout', tlsKeyFile, '-out', tlsCertFile
  ], { timeout: 15000 });
  return { tlsKeyFile, tlsCertFile, ca: await readFile(tlsCertFile) };
}

export async function fixture(t, { publicOrigin, backendName = host } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'edu-protected-launch-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const port = await choosePort();
  const origin = publicOrigin ?? `https://${host}:${port}`;
  const audience = `${origin}/api`;
  const dataDirectory = join(folder, 'data');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyFile = join(folder, 'identity.pem');
  const storeKeyFile = join(folder, 'store.key');
  const auditKeyFile = join(folder, 'audit.key');
  const storeKey = randomBytes(32);
  const auditKey = randomBytes(32);
  const configuration = join(folder, 'security.json');
  await mkdir(dataDirectory);
  const { tlsKeyFile, tlsCertFile, ca } = await testCertificate(folder, backendName);
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
    origin, port, env, folder, dataDirectory, configuration, storeKey, auditKey, ca, tlsCertFile,
    credential: role => signCredential(`sample-${role}`, audience, privateKey)
  };
}

export async function withServer(settings, execute) {
  const child = spawn(process.execPath, ['code/backend/server.js'], { env: settings.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  let stderr = '';
  let result;
  child.stderr.setEncoding('utf8').on('data', piece => { stderr += piece; });
  try {
    const [line] = await Promise.race([
      once(child.stdout, 'data', { signal: AbortSignal.timeout(8000) }),
      exited.then(([status]) => { throw new Error(`服务启动失败（${status}） ${stderr.trim()}`); })
    ]);
    assert.match(String(line), /Edu ProMAIC 已启动：https:\/\//);
    result = await execute();
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
  return { result, stderr };
}

function requestHeaders(url, credential, { role, requestOrigin, authorization }) {
  const headers = { Host: url.host };
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (role) headers.Cookie = `__Host-edu-promaic=${credential(role)}`;
  if (authorization !== undefined) headers.Authorization = authorization;
  return headers;
}

export async function request({ origin, ca, credential }, path, options = {}) {
  const { method = 'GET', requestOrigin = origin } = options;
  const url = new URL(path, origin);
  const headers = requestHeaders(url, credential, { ...options, requestOrigin });
  const sent = httpsRequest(url, {
    hostname: host, servername: isIP(url.hostname) ? undefined : url.hostname,
    ca, method, headers, signal: AbortSignal.timeout(6000)
  });
  const pending = once(sent, 'response');
  sent.end();
  const [response] = await pending;
  const chunks = [];
  for await (const item of response) chunks.push(item);
  const text = Buffer.concat(chunks).toString('utf8');
  const result = response.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : text;
  return { status: response.statusCode, result, headers: response.headers };
}
