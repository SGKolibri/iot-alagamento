import { issueCredential, parseToken, verifySecret } from './credentials';

describe('credencial do dispositivo (RF-DIS-02, ADR-014)', () => {
  it('o token tem id de 16 bytes e segredo de 32 bytes, em base64url', async () => {
    const credential = await issueCredential();
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(credential.token.startsWith(`${credential.id}.`)).toBe(true);
    expect(Buffer.from(credential.token.split('.')[1]!, 'base64url')).toHaveLength(32);
  });

  it('guarda só o hash scrypt com sal, diferente do token e do segredo', async () => {
    const credential = await issueCredential();
    const secret = credential.token.split('.')[1]!;
    expect(credential.hash).not.toContain(secret);
    expect(credential.hash).not.toBe(credential.token);
    expect(Buffer.from(credential.salt, 'base64url')).toHaveLength(16);
  });

  it('dois cadastros geram tokens, sais e hashes diferentes', async () => {
    const [a, b] = await Promise.all([issueCredential(), issueCredential()]);
    expect(a.token).not.toBe(b.token);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('confere o segredo certo e recusa o errado', async () => {
    const credential = await issueCredential();
    const { secret } = parseToken(credential.token)!;
    expect(await verifySecret(secret, credential.salt, credential.hash)).toBe(true);
    expect(await verifySecret(`${secret.slice(0, -1)}A`, credential.salt, credential.hash)).toBe(
      secret.endsWith('A') ? true : false,
    );
    expect(await verifySecret('outro', credential.salt, credential.hash)).toBe(false);
  });

  it.each(['', 'sem-ponto', 'a.b.c', '.segredo', 'id.'])(
    'token malformado %j não é lido',
    (token) => {
      expect(parseToken(token)).toBeNull();
    },
  );
});
