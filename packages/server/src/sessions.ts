/**
 * Zitadel sessions this browser logged in with, kept in a signed httpOnly cookie so that
 * /logout knows which sessions to terminate. Only IDs and login names are stored: the
 * service user may delete any session, and the signature stops a browser from naming others.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BASE_PATH } from './paths.ts';

export interface BrowserSession {
  id: string;
  loginName: string;
}

const COOKIE = 'lca_sessions';
const MAX_SESSIONS = 5;

export function readSessions(req: FastifyRequest): BrowserSession[] {
  const raw = req.cookies[COOKIE];
  if (!raw) return [];
  const { valid, value } = req.unsignCookie(raw);
  if (!valid || !value) return [];
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as unknown;
    return Array.isArray(parsed) ? (parsed as BrowserSession[]) : [];
  } catch {
    return [];
  }
}

export function writeSessions(
  req: FastifyRequest,
  reply: FastifyReply,
  sessions: BrowserSession[],
) {
  if (sessions.length === 0) {
    reply.clearCookie(COOKIE, { path: BASE_PATH });
    return;
  }
  const value = Buffer.from(JSON.stringify(sessions.slice(-MAX_SESSIONS))).toString('base64url');
  reply.setCookie(COOKIE, value, {
    path: BASE_PATH,
    signed: true,
    httpOnly: true,
    // lax: the logout request is a top-level navigation coming from another site (the app)
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: 400 * 24 * 3600,
  });
}

export function rememberSession(req: FastifyRequest, reply: FastifyReply, session: BrowserSession) {
  const others = readSessions(req).filter((s) => s.id !== session.id);
  writeSessions(req, reply, [...others, session]);
}
