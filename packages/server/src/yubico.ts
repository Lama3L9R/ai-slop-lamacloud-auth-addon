/**
 * Yubico OTP validation (YubiCloud / yubikey-val validation protocol 2.0).
 * https://developers.yubico.com/OTP/Specifications/OTP_validation_protocol.html
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** modhex alphabet; an OTP is <public id><32 char encrypted token> */
const OTP_PATTERN = /^[cbdefghijklnrtuv]{32,48}$/;

export function isYubicoOtp(otp: string): boolean {
  return OTP_PATTERN.test(otp);
}

/** The YubiKey's public ID: everything before the last 32 characters (12 chars by default). */
export function otpPublicId(otp: string): string {
  return otp.slice(0, -32);
}

/** Parses the public IDs stored in Zitadel metadata ("id1, id2" or one per line). */
export function parsePublicIds(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.length > 32 && isYubicoOtp(s) ? otpPublicId(s) : s)); // tolerate a pasted full OTP
}

export type VerifyResult = { ok: true } | { ok: false; status: string };

export interface YubicoOptions {
  clientId: string;
  /** base64 secret key */
  secretKey: string;
  apiUrls: string[];
}

export class YubicoVerifier {
  private readonly clientId: string;
  private readonly key: Buffer;
  private readonly apiUrls: string[];

  constructor(options: YubicoOptions) {
    this.clientId = options.clientId;
    this.key = Buffer.from(options.secretKey, 'base64');
    this.apiUrls = options.apiUrls;
  }

  private sign(params: Record<string, string>): string {
    const message = Object.keys(params)
      .filter((k) => k !== 'h')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHmac('sha1', this.key).update(message).digest('base64');
  }

  /**
   * Verifies an OTP against the validation servers (tried in order on network errors).
   * Status values: OK, BAD_OTP, REPLAYED_OTP, BAD_SIGNATURE, MISSING_PARAMETER,
   * NO_SUCH_CLIENT, OPERATION_NOT_ALLOWED, BACKEND_ERROR, NOT_ENOUGH_ANSWERS, REPLAYED_REQUEST
   */
  async verify(otp: string): Promise<VerifyResult> {
    if (!isYubicoOtp(otp)) return { ok: false, status: 'BAD_OTP' };

    const nonce = randomBytes(16).toString('hex');
    const params: Record<string, string> = { id: this.clientId, nonce, otp };
    const query = new URLSearchParams({ ...params, h: this.sign(params) });

    let lastError: unknown;
    for (const apiUrl of this.apiUrls) {
      let body: string;
      try {
        const res = await fetch(`${apiUrl}?${query}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${apiUrl}`);
        body = await res.text();
      } catch (err) {
        lastError = err;
        continue;
      }
      return this.checkResponse(body, otp, nonce);
    }
    throw new Error('all Yubico validation servers failed', { cause: lastError });
  }

  private checkResponse(body: string, otp: string, nonce: string): VerifyResult {
    const fields: Record<string, string> = {};
    for (const line of body.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
    }

    const status = fields.status ?? 'MISSING_STATUS';
    const expected = Buffer.from(this.sign(fields));
    const actual = Buffer.from(fields.h ?? '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, status: 'BAD_RESPONSE_SIGNATURE' };
    }
    if (status !== 'OK') return { ok: false, status };
    if (fields.otp !== otp || fields.nonce !== nonce) {
      return { ok: false, status: 'RESPONSE_MISMATCH' };
    }
    return { ok: true };
  }
}
