import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** `scrypt$N$r$p$salt$hash`, base64url parts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Same work for unknown users, so timing doesn't reveal which emails exist.
  const parts = (stored ?? DUMMY_HASH).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return stored !== null && timingSafeEqual(key, expected);
}

const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export const PASSWORD_MIN = 10;

/** A random secret token (base64url) for links, sessions and API tokens. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Tokens are stored hashed: a database leak doesn't give working sessions or links. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- encryption at rest (TOTP secrets) --------------------------------------------------------

export class SecretBox {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    if (secretKey.length < 32) throw new Error("SECRET_KEY must be at least 32 characters");
    this.key = createHash("sha256").update(`prototyper:secretbox:${secretKey}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), data.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
  }

  open(sealed: string): string {
    const [v, iv, data, tag] = sealed.split(".");
    if (v !== "v1" || !iv || !data || !tag) throw new Error("Invalid sealed value");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }

  /** HMAC signature for short-lived signed URLs. */
  sign(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("base64url").slice(0, 32);
  }
}

// --- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) ---------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 15;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, "0");
}

export const totpStep = (at = Date.now()) => Math.floor(at / 30_000);

/**
 * Check a code against the current step ±1. Returns the matching step, which must be greater than
 * the last one used (so a code can't be replayed), or undefined.
 */
export function verifyTotp(secret: string, code: string, lastStep: number, at = Date.now()): number | undefined {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return undefined;
  const current = totpStep(at);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && safeEqual(totpCode(secret, step), clean)) return step;
  }
  return undefined;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// --- PKCE ---------------------------------------------------------------------------------------

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
