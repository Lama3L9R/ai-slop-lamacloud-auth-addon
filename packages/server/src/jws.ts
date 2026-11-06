/**
 * Verifies compact JWS strings signed by Zitadel's active web key (e.g. the `logout_token`
 * Zitadel appends to the Login V2 logout URL), using the public keys from its JWKS endpoint.
 */
import { constants, createPublicKey, verify, type KeyObject, type webcrypto } from 'node:crypto';

type Jwk = webcrypto.JsonWebKey & { kid?: string };

const HASHES: Record<string, string> = { '256': 'sha256', '384': 'sha384', '512': 'sha512' };

export class JwksVerifier {
  private readonly jwksUrl: string;
  private keys = new Map<string, KeyObject>();
  private lastFetch = 0;

  constructor(jwksUrl: string) {
    this.jwksUrl = jwksUrl;
  }

  private async refresh(): Promise<void> {
    // unknown kids trigger a refetch; don't let garbage tokens hammer Zitadel
    if (Date.now() - this.lastFetch < 30_000) return;
    this.lastFetch = Date.now();
    const res = await fetch(this.jwksUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const { keys } = (await res.json()) as { keys: Jwk[] };
    this.keys = new Map(
      keys.filter((k) => k.kid).map((k) => [k.kid!, createPublicKey({ key: k, format: 'jwk' })]),
    );
  }

  /** Returns the decoded payload, or throws if the signature does not check out. */
  async verify<T>(token: string): Promise<T> {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) throw new Error('malformed JWS');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as {
      alg?: string;
      kid?: string;
    };
    if (!header.kid || !header.alg) throw new Error('JWS without kid/alg');

    let key = this.keys.get(header.kid);
    if (!key) {
      await this.refresh();
      key = this.keys.get(header.kid);
    }
    if (!key) throw new Error(`unknown signing key ${header.kid}`);

    const data = Buffer.from(`${headerB64}.${payloadB64}`);
    const sig = Buffer.from(sigB64, 'base64url');
    const { alg } = header;
    const hash = HASHES[alg.slice(2)];
    let ok: boolean;
    if (alg === 'EdDSA') ok = verify(null, data, key, sig);
    else if (alg.startsWith('RS') && hash) ok = verify(hash, data, key, sig);
    else if (alg.startsWith('PS') && hash) {
      ok = verify(
        hash,
        data,
        {
          key,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        sig,
      );
    } else if (alg.startsWith('ES') && hash) {
      ok = verify(hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig);
    } else throw new Error(`unsupported JWS alg ${alg}`);
    if (!ok) throw new Error('bad JWS signature');

    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as T;
  }
}
