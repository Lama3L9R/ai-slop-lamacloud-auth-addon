import { randomBytes } from 'node:crypto';

/**
 * A login in progress: the password was accepted, a second step is pending.
 * Kept in memory only; a restart simply makes users start over.
 */
export interface Flow {
  id: string;
  /** login: pending Yubico OTP check; bind: authenticated, waiting for a new YubiKey */
  purpose: 'login' | 'bind';
  authRequestId: string | undefined;
  sessionId: string;
  sessionToken: string;
  userId: string;
  /** organization of the user, for the management API */
  orgId: string;
  loginName: string;
  /** YubiKey public IDs allowed for this user */
  yubikeyIds: string[];
  otpAttempts: number;
  expiresAt: number;
}

export const FLOW_TTL_MS = 5 * 60_000;
export const MAX_OTP_ATTEMPTS = 5;

export class FlowStore {
  private readonly flows = new Map<string, Flow>();
  private readonly timer: NodeJS.Timeout;

  /** `onExpire` is called for flows that time out, e.g. to clean up their Zitadel session. */
  constructor(onExpire: (flow: Flow) => void) {
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const flow of this.flows.values()) {
        if (flow.expiresAt <= now) {
          this.flows.delete(flow.id);
          onExpire(flow);
        }
      }
    }, 30_000);
    this.timer.unref();
  }

  create(data: Omit<Flow, 'id' | 'otpAttempts' | 'expiresAt'>): Flow {
    const flow: Flow = {
      ...data,
      id: randomBytes(32).toString('base64url'),
      otpAttempts: 0,
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    this.flows.set(flow.id, flow);
    return flow;
  }

  get(id: string | undefined): Flow | undefined {
    if (!id) return undefined;
    const flow = this.flows.get(id);
    if (!flow || flow.expiresAt <= Date.now()) return undefined;
    return flow;
  }

  delete(id: string): void {
    this.flows.delete(id);
  }

  close(): void {
    clearInterval(this.timer);
  }
}
