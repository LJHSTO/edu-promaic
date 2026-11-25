import { createPublicKey, KeyObject, verify } from 'node:crypto';

const SESSION_COOKIE = '__Host-edu-promaic';
const MAX_TOKEN_LENGTH = 8_192;
const MAX_TOKEN_LIFETIME = 15 * 60;
const MAX_CLOCK_DRIFT = 30;
const ROLE_NAMES = new Set(['student', 'teacher', 'auditor']);
const CLASS_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function invalidToken() {
  return new AccessError(401, '需要有效的机构登录凭证。');
}

function denied() {
  return new AccessError(403, '当前账号无权访问此课堂操作。');
}

function isShortText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[^\x21-\x7e]/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPublicKey(value) {
  if (typeof value === 'string' && /^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(value.trim())) {
    value = createPublicKey(value);
  }
  if (!(value instanceof KeyObject) || value.type !== 'public' || value.asymmetricKeyType !== 'rsa') {
    throw new TypeError('机构签名须配置 RSA 公钥。');
  }
  if (value.asymmetricKeyDetails.modulusLength < 2_048) throw new TypeError('RSA 公钥至少需要 2048 位。');
  return value;
}

function httpsUrl(value, name) {
  const parsed = typeof value === 'string' ? URL.canParse(value) && new URL(value) : false;
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${name} 须使用 HTTPS 地址。`);
  }
  return parsed;
}

function validMembership(entry) {
  return isRecord(entry) && isShortText(entry.subject) && typeof entry.classId === 'string'
    && CLASS_ID.test(entry.classId) && entry.classId === entry.classId.trim() && ROLE_NAMES.has(entry.role);
}

function indexMemberships(memberships) {
  if (!Array.isArray(memberships) || !memberships.every(validMembership)) {
    throw new TypeError('班级成员配置须包含账号、班级和有效角色。');
  }
  const accounts = new Map();
  for (const { subject, classId, role } of memberships) {
    const classes = accounts.get(subject) ?? new Map();
    if (classes.has(classId)) throw new TypeError('每个账号在同一班级须对应一个角色。');
    classes.set(classId, role);
    accounts.set(subject, classes);
  }
  return accounts;
}

function readCookie(cookieHeader) {
  if (cookieHeader === undefined) return undefined;
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 16_384) throw invalidToken();
  const values = cookieHeader.split(';').flatMap(item => {
    const [name, ...value] = item.trim().split('=');
    return name === SESSION_COOKIE ? [value.join('=')] : [];
  });
  if (values.length > 1) throw invalidToken();
  return values[0];
}

function readBearer(value) {
  if (typeof value !== 'string' || value.length > MAX_TOKEN_LENGTH + 7) throw invalidToken();
  const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(value);
  if (!match) throw invalidToken();
  return match[1];
}

function checkOrigin(req, origin, cookie) {
  const originHeader = req.headers.origin;
  const reads = req.method === 'GET' || req.method === 'HEAD';
  if (originHeader === origin || (originHeader === undefined && (!cookie || reads))) return;
  throw new AccessError(403, '请在同一机构课堂页面操作。');
}

function requestToken(req, origin) {
  const { authorization } = req.headers;
  const tokenCookie = readCookie(req.headers.cookie);
  const hasCookie = tokenCookie !== undefined;
  if (hasCookie && authorization !== undefined) throw invalidToken();
  checkOrigin(req, origin, hasCookie);
  return hasCookie ? tokenCookie : readBearer(authorization);
}

function decodeSegment(segment) {
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw invalidToken();
  return bytes;
}

function parseSegment(segment) {
  let record;
  try {
    record = JSON.parse(textDecoder.decode(decodeSegment(segment)));
  } catch {
    throw invalidToken();
  }
  if (!isRecord(record)) throw invalidToken();
  return record;
}

function accessTokenHeader(header) {
  const type = typeof header.typ === 'string' ? header.typ.toLowerCase() : '';
  return header.alg === 'RS256' && (type === 'at+jwt' || type === 'application/at+jwt')
    && !Object.hasOwn(header, 'crit');
}

function signedClaims(token, key) {
  if (token.length > MAX_TOKEN_LENGTH || !COMPACT_JWT.test(token)) throw invalidToken();
  const [header, payload, encodedSignature] = token.split('.');
  if (!accessTokenHeader(parseSegment(header))) throw invalidToken();
  if (!verify('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'ascii'), key, decodeSegment(encodedSignature))) {
    throw invalidToken();
  }
  return parseSegment(payload);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validActivation(nbf, expiration, now) {
  return nbf === undefined || (isTimestamp(nbf) && nbf < expiration && nbf <= now + MAX_CLOCK_DRIFT);
}

function validWindow(claims, now) {
  const { exp, iat, nbf } = claims;
  if (!isTimestamp(now) || !isTimestamp(iat) || !isTimestamp(exp)) return false;
  if (exp <= now || exp <= iat || exp - iat > MAX_TOKEN_LIFETIME || iat > now + MAX_CLOCK_DRIFT) return false;
  return validActivation(nbf, exp, now);
}

function audienceMatches(aud, audience) {
  if (typeof aud === 'string') return aud === audience;
  return Array.isArray(aud) && aud.every(isShortText) && aud.includes(audience);
}

function verifiedSubject(claims, { issuer, audience, acceptedAcr, now }) {
  if (claims.iss !== issuer || !audienceMatches(claims.aud, audience) || !acceptedAcr.has(claims.acr)) {
    throw invalidToken();
  }
  if (!isShortText(claims.sub) || !isShortText(claims.client_id) || !isShortText(claims.jti) || !validWindow(claims, now)) {
    throw invalidToken();
  }
  return claims.sub;
}

export function createProtectedAccess({ publicKey, issuer, audience, origin, acceptedAcr, memberships, now = Date.now }) {
  httpsUrl(issuer, '机构签发方');
  if (httpsUrl(origin, '课堂站点').origin !== origin) throw new TypeError('课堂站点须配置为 HTTPS 源。');
  if (!isShortText(audience)) throw new TypeError('须配置有效的课堂令牌受众。');
  if (!Array.isArray(acceptedAcr) || acceptedAcr.length === 0 || !acceptedAcr.every(isShortText)) {
    throw new TypeError('须配置机构认可的多因素鉴别等级。');
  }

  const accounts = indexMemberships(memberships);
  const key = readPublicKey(publicKey);
  const policy = { issuer, audience, acceptedAcr: new Set(acceptedAcr) };
  return {
    authenticate(req) {
      const claims = signedClaims(requestToken(req, origin), key);
      const subject = verifiedSubject(claims, { ...policy, now: Math.floor(now() / 1_000) });
      return Object.freeze({ subject });
    },
    authorize({ subject }, classId, roles) {
      const role = accounts.get(subject)?.get(classId);
      if (!role || !roles.includes(role)) throw denied();
      return Object.freeze({ subject, classId, role });
    }
  };
}
