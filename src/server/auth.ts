import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { config } from "./config.js";
import { cleanupExpiredAuthState, db } from "./db.js";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "bike_session";
const CHALLENGE_COOKIE = "bike_webauthn";

interface CredentialRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  device_type: string;
  backed_up: number;
}

interface SessionRow {
  recovery_session: number;
  expires_at: string;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeTokenMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function credentialCount() {
  return Number(
    (db.prepare("SELECT COUNT(*) AS count FROM webauthn_credentials").get() as { count: number })
      .count,
  );
}

function createSession(reply: FastifyReply, recoverySession = false) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionDays * 86_400_000);
  db.prepare(
    "INSERT INTO sessions(token_hash, recovery_session, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(sha256(token), recoverySession ? 1 : 0, now.toISOString(), expires.toISOString());
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function getSession(request: FastifyRequest): SessionRow | null {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare("SELECT recovery_session, expires_at FROM sessions WHERE token_hash = ?")
    .get(sha256(token)) as SessionRow | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return row;
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  if (!getSession(request)) {
    await reply.code(401).send({ error: "authentication_required" });
  }
}

function saveChallenge(reply: FastifyReply, flow: "registration" | "authentication", challenge: string) {
  const id = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  db.prepare(
    "INSERT INTO auth_challenges(id, flow, challenge, expires_at) VALUES (?, ?, ?, ?)",
  ).run(id, flow, challenge, expiresAt);
  reply.setCookie(CHALLENGE_COOKIE, id, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 300,
  });
}

function consumeChallenge(request: FastifyRequest, flow: "registration" | "authentication") {
  const id = request.cookies[CHALLENGE_COOKIE];
  if (!id) return null;
  const row = db
    .prepare("SELECT challenge, expires_at FROM auth_challenges WHERE id = ? AND flow = ?")
    .get(id, flow) as { challenge: string; expires_at: string } | undefined;
  db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(id);
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return row.challenge;
}

function randomRecoveryCode() {
  const value = randomBytes(9).toString("base64url").toUpperCase();
  return `${value.slice(0, 6)}-${value.slice(6)}`;
}

async function hashRecoveryCode(code: string, salt: string) {
  const derived = (await scrypt(code.trim().toUpperCase(), salt, 32)) as Buffer;
  return derived.toString("hex");
}

async function replaceRecoveryCodes() {
  const codes = Array.from({ length: 8 }, randomRecoveryCode);
  const rows = await Promise.all(
    codes.map(async (code) => {
      const salt = randomBytes(16).toString("hex");
      return { salt, codeHash: await hashRecoveryCode(code, salt) };
    }),
  );
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM recovery_codes").run();
    const insert = db.prepare("INSERT INTO recovery_codes(salt, code_hash) VALUES (?, ?)");
    rows.forEach((row) => insert.run(row.salt, row.codeHash));
  });
  transaction();
  return codes;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async (request) => ({
    authenticated: Boolean(getSession(request)),
    setupRequired: credentialCount() === 0,
    recoverySession: Boolean(getSession(request)?.recovery_session),
  }));

  app.post<{ Body: { bootstrapToken?: string } }>(
    "/api/auth/register/options",
    async (request, reply) => {
      cleanupExpiredAuthState();
      const setupRequired = credentialCount() === 0;
      const session = getSession(request);
      if (
        setupRequired &&
        (!config.bootstrapToken ||
          !safeTokenMatch(request.body.bootstrapToken ?? "", config.bootstrapToken))
      ) {
        return reply.code(403).send({ error: "invalid_bootstrap_token" });
      }
      if (!setupRequired && !session) {
        return reply.code(401).send({ error: "authentication_required" });
      }

      const credentials = db
        .prepare("SELECT id, transports FROM webauthn_credentials")
        .all() as Array<{ id: string; transports: string }>;
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userName: "owner",
        userDisplayName: "Propietario",
        userID: new TextEncoder().encode("bike-dashboard-owner"),
        attestationType: "none",
        excludeCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: JSON.parse(credential.transports) as AuthenticatorTransportFuture[],
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        preferredAuthenticatorType: "localDevice",
      });
      saveChallenge(reply, "registration", options.challenge);
      return options;
    },
  );

  app.post<{ Body: { response: RegistrationResponseJSON } }>(
    "/api/auth/register/verify",
    async (request, reply) => {
      const challenge = consumeChallenge(request, "registration");
      if (!challenge) return reply.code(400).send({ error: "challenge_expired" });
      const result = await verifyRegistrationResponse({
        response: request.body.response,
        expectedChallenge: challenge,
        expectedOrigin: config.rpOrigin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
      if (!result.verified) return reply.code(400).send({ error: "registration_failed" });
      const credential = result.registrationInfo.credential;
      const wasFirst = credentialCount() === 0;
      db.prepare(
        `INSERT OR REPLACE INTO webauthn_credentials
          (id, public_key, counter, transports, device_type, backed_up, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        result.registrationInfo.credentialDeviceType,
        result.registrationInfo.credentialBackedUp ? 1 : 0,
        new Date().toISOString(),
      );
      createSession(reply);
      const recoveryCodes = wasFirst ? await replaceRecoveryCodes() : undefined;
      return { verified: true, recoveryCodes };
    },
  );

  app.post("/api/auth/login/options", async (_request, reply) => {
    cleanupExpiredAuthState();
    const credentials = db
      .prepare("SELECT id, transports FROM webauthn_credentials")
      .all() as Array<{ id: string; transports: string }>;
    if (!credentials.length) return reply.code(409).send({ error: "setup_required" });
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: JSON.parse(credential.transports) as AuthenticatorTransportFuture[],
      })),
      userVerification: "required",
    });
    saveChallenge(reply, "authentication", options.challenge);
    return options;
  });

  app.post<{ Body: { response: AuthenticationResponseJSON } }>(
    "/api/auth/login/verify",
    async (request, reply) => {
      const challenge = consumeChallenge(request, "authentication");
      if (!challenge) return reply.code(400).send({ error: "challenge_expired" });
      const row = db
        .prepare("SELECT * FROM webauthn_credentials WHERE id = ?")
        .get(request.body.response.id) as CredentialRow | undefined;
      if (!row) return reply.code(400).send({ error: "unknown_credential" });
      const result = await verifyAuthenticationResponse({
        response: request.body.response,
        expectedChallenge: challenge,
        expectedOrigin: config.rpOrigin,
        expectedRPID: config.rpId,
        credential: {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: row.counter,
          transports: JSON.parse(row.transports),
        },
        requireUserVerification: true,
      });
      if (!result.verified) return reply.code(401).send({ error: "authentication_failed" });
      db.prepare(
        "UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?",
      ).run(result.authenticationInfo.newCounter, new Date().toISOString(), row.id);
      createSession(reply);
      return { verified: true };
    },
  );

  app.post<{ Body: { code: string } }>("/api/auth/recover", async (request, reply) => {
    const rows = db
      .prepare("SELECT salt, code_hash FROM recovery_codes WHERE used_at IS NULL")
      .all() as Array<{ salt: string; code_hash: string }>;
    for (const row of rows) {
      const candidate = await hashRecoveryCode(request.body.code ?? "", row.salt);
      if (safeTokenMatch(candidate, row.code_hash)) {
        db.prepare("UPDATE recovery_codes SET used_at = ? WHERE code_hash = ?").run(
          new Date().toISOString(),
          row.code_hash,
        );
        createSession(reply, true);
        return { recovered: true };
      }
    }
    return reply.code(401).send({ error: "invalid_recovery_code" });
  });

  app.post("/api/auth/logout", { preHandler: requireSession }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  });
}
