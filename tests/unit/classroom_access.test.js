import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { AccessError, createProtectedAccess } from '../../code/backend/access.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2_048 });
const nowSeconds = 1_795_593_600;
const policy = {
  publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  issuer: 'https://identity.example.test',
  audience: 'https://classroom.example.test/api',
  origin: 'https://classroom.example.test',
  acceptedAcr: ['institution:verified-mfa'],
  memberships: [
    { subject: 'student-example', classId: 'math-a', role: 'student' },
    { subject: 'teacher-example', classId: 'math-a', role: 'teacher' },
    { subject: 'auditor-example', classId: 'math-b', role: 'auditor' }
  ],
  now: () => nowSeconds * 1_000
};

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(claims = {}, header = {}, signingKey = keys.privateKey) {
  const payload = {
    iss: policy.issuer,
    aud: [policy.audience],
    sub: 'student-example',
    iat: nowSeconds - 5,
    nbf: nowSeconds - 5,
    exp: nowSeconds + 300,
    acr: policy.acceptedAcr[0],
    client_id: 'campus-learning',
    jti: 'example-token-1',
    ...claims
  };
  const segments = `${encode({ typ: 'at+jwt', alg: 'RS256', ...header })}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(segments), signingKey).toString('base64url');
  return `${segments}.${signature}`;
}

const bearer = authorization => ({ method: 'GET', headers: { authorization: `Bearer ${authorization}` } });
const cookie = authorization => `site-locale=zh; __Host-edu-promaic=${authorization}`;
const hasStatus = status => error => error instanceof AccessError && error.status === status;

test('机构访问令牌确认身份，服务端名单限定本班级角色', () => {
  const access = createProtectedAccess(policy);
  const student = access.authenticate(bearer(token({ role: 'teacher', classId: 'math-b' })));
  assert.deepEqual(student, { subject: 'student-example' });
  assert.deepEqual(access.authorize(student, 'math-a', ['student']), {
    subject: 'student-example', classId: 'math-a', role: 'student'
  });
  assert.throws(() => access.authorize(student, 'math-a', ['teacher']), hasStatus(403));
  assert.throws(() => access.authorize(student, 'math-b', ['student']), hasStatus(403));

  const teacher = access.authenticate(bearer(token({ sub: 'teacher-example' })));
  assert.equal(access.authorize(teacher, 'math-a', ['teacher']).role, 'teacher');
  const auditor = access.authenticate(bearer(token({ sub: 'auditor-example' })));
  assert.equal(access.authorize(auditor, 'math-b', ['auditor']).role, 'auditor');
  assert.throws(() => access.authorize(auditor, 'math-b', ['teacher']), hasStatus(403));
  const visitor = access.authenticate(bearer(token({ sub: 'visitor-example' })));
  assert.throws(() => access.authorize(visitor, 'math-a', ['student']), hasStatus(403));
});

test('只接受该课堂受众的机构访问令牌与约定鉴别等级', () => {
  const access = createProtectedAccess(policy);
  const claimCases = [
    { iss: 'https://different-issuer.example.test' },
    { aud: 'https://other-service.example.test' },
    { acr: 'institution:password' },
    { acr: undefined },
    { client_id: undefined },
    { jti: undefined },
    { sub: 'student-example\n' }
  ];
  for (const claims of claimCases) assert.throws(() => access.authenticate(bearer(token(claims))), hasStatus(401));
  assert.throws(() => access.authenticate(bearer(token({}, { typ: 'JWT' }))), hasStatus(401));
  const differentKey = generateKeyPairSync('rsa', { modulusLength: 2_048 }).privateKey;
  assert.throws(() => access.authenticate(bearer(token({}, {}, differentKey))), hasStatus(401));
});

test('时间窗限制令牌存续期并验证签发和生效时间', () => {
  const access = createProtectedAccess(policy);
  const claimCases = [
    { exp: nowSeconds },
    { exp: nowSeconds + 1_000 },
    { iat: nowSeconds + 31 },
    { nbf: nowSeconds + 31 },
    { iat: String(nowSeconds) },
    { exp: nowSeconds + 30, iat: nowSeconds + 30 }
  ];
  for (const claims of claimCases) assert.throws(() => access.authenticate(bearer(token(claims))), hasStatus(401));
  assert.equal(access.authenticate(bearer(token({ nbf: undefined }))).subject, 'student-example');
});

test('浏览器凭证随同源写入传送，来源或凭证不明确时拒绝', () => {
  const access = createProtectedAccess(policy);
  const authorization = token();
  const headers = { cookie: cookie(authorization) };
  const post = origin => ({ method: 'POST', headers: { ...headers, origin } });
  assert.equal(access.authenticate({ method: 'GET', headers }).subject, 'student-example');
  assert.equal(access.authenticate(post(policy.origin)).subject, 'student-example');
  assert.throws(() => access.authenticate(post(undefined)), hasStatus(403));
  assert.throws(() => access.authenticate(post('https://other.example.test')), hasStatus(403));
  assert.throws(() => access.authenticate({ method: 'GET', headers: {
    ...headers, authorization: `Bearer ${authorization}`
  } }), hasStatus(401));
  assert.throws(() => access.authenticate({ method: 'GET', headers: {} }), hasStatus(401));
});

test('启动时核验机构配置和班级角色互斥', () => {
  assert.throws(() => createProtectedAccess({ ...policy, acceptedAcr: [] }), /多因素鉴别/);
  assert.throws(() => createProtectedAccess({ ...policy, origin: 'http://classroom.example.test' }), /HTTPS/);
  assert.throws(() => createProtectedAccess({ ...policy, publicKey: keys.privateKey }), /RSA 公钥/);
  assert.throws(() => createProtectedAccess({
    ...policy, memberships: [{ subject: 'student-example', classId: '-bad-class', role: 'student' }]
  }), /班级/);
  assert.throws(() => createProtectedAccess({
    ...policy,
    memberships: [...policy.memberships, { subject: 'teacher-example', classId: 'math-a', role: 'auditor' }]
  }), /对应一个角色/);
});
