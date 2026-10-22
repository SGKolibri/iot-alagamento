import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Credencial do dispositivo (RF-DIS-02, ADR-014): token "<id>.<segredo>". O id localiza a
// credencial; o segredo (32 bytes) só existe na resposta do cadastro e é guardado como scrypt.
const ID_BYTES = 16;
const SECRET_BYTES = 32;
const SALT_BYTES = 16;
const KEY_LENGTH = 32;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };
const PART = /^[A-Za-z0-9_-]+$/;

export interface IssuedCredential {
  id: string;
  token: string;
  salt: string;
  hash: string;
}

function derive(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, Buffer.from(salt, 'base64url'), KEY_LENGTH, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function issueCredential(): Promise<IssuedCredential> {
  const id = randomBytes(ID_BYTES).toString('base64url');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const salt = randomBytes(SALT_BYTES).toString('base64url');
  const hash = (await derive(secret, salt)).toString('base64url');
  return { id, token: `${id}.${secret}`, salt, hash };
}

export function parseToken(token: string): { id: string; secret: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [id, secret] = parts as [string, string];
  return PART.test(id) && PART.test(secret) ? { id, secret } : null;
}

export async function verifySecret(secret: string, salt: string, hash: string): Promise<boolean> {
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(secret, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
