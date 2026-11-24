// Sign in with ChatGPT: OpenAI's program that lets open-source apps run on the user's own ChatGPT plan
// (https://developers.openai.com/siwc/token-sharing-open-source). The Codex chat uses the token this gives instead of
// an API key. The whole flow runs on this computer: OAuth with PKCE in the system browser, a loopback callback on
// 127.0.0.1, tokens kept in the app's data folder (owner-only) and never sent anywhere but OpenAI.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { userDataDir } from './paths.mjs';

const AUTH = 'https://auth.openai.com';
const AUTHORIZE = `${AUTH}/api/accounts/authorize`;
const TOKEN = `${AUTH}/api/accounts/oauth/token`;
export const RESOURCE = 'https://api.openai.com/v1';
/** where requests go (the OAuth resource stays the real API); ICUT_CHATGPT_API_BASE points it at a local test server */
export const API_BASE = process.env.ICUT_CHATGPT_API_BASE || RESOURCE;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const APP_NAME = 'IngrainedCut';
const CALLBACK_PATH = '/auth/callback';
const PREFERRED_PORT = 1455;
// refresh errors that mean the sign-in is over (sign in again)
const TERMINAL = /invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused/;

const file = () => path.join(userDataDir(), 'chatgpt-auth.json');
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.randomBytes(n));

/** { hostId, account: { client_id, subject, email, issuer, id_token, access_token, refresh_token, expires_in, scopes, saved_at }, welcomeSeen } */
let rec = null;
let recTime = 0;
// The desktop app and the helper can both be running and share this file: re-read it whenever the other one changed it
// (a renewed sign-in replaces the refresh token, and the old one stops working).
function load() {
  let t = 0;
  try {
    t = fs.statSync(file()).mtimeMs;
  } catch {}
  if (rec && t === recTime) return rec;
  try {
    rec = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    rec = {};
  }
  recTime = t;
  return rec;
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file());
  recTime = fs.statSync(file()).mtimeMs;
}
/** one stable id per install ("agent host"), chosen before the first sign-in */
function hostId() {
  load();
  if (!rec.hostId) {
    rec.hostId = `urn:uuid:${crypto.randomUUID()}`;
    save();
  }
  return rec.hostId;
}

/** Signed in, with permission to use the ChatGPT plan (the plan scope was granted). */
export function planReady() {
  const a = load().account;
  return !!(a?.refresh_token && a.scopes?.includes(PLAN_SCOPE));
}

export function status() {
  const a = load().account;
  return { signedIn: !!a?.refresh_token, email: a?.email ?? null, plan: planReady(), welcomeSeen: !!rec.welcomeSeen };
}

export function markWelcomeSeen() {
  load().welcomeSeen = true;
  save();
}

let oidc = null;
async function discovery() {
  if (!oidc) {
    const r = await fetch(`${AUTH}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OpenAI sign-in is unavailable right now (${r.status})`);
    oidc = await r.json();
  }
  return oidc;
}

/** Verify the ID token: signature against OpenAI's published keys, issuer, audience, expiry and nonce. */
async function verifyIdToken(idToken, { clientId, nonce }) {
  const [h, p, sig] = idToken.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const cfg = await discovery();
  const jwks = await (await fetch(cfg.jwks_uri)).json();
  const jwk = jwks.keys.find((k) => k.kid === header.kid) ?? (jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) throw new Error('ID token: unknown signing key');
  const alg = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' }[header.alg];
  if (!alg) throw new Error(`ID token: unsupported algorithm ${header.alg}`);
  const ok = crypto.verify(alg, Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('ID token: bad signature');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== cfg.issuer) throw new Error('ID token: wrong issuer');
  if (!aud.includes(clientId)) throw new Error('ID token: wrong audience');
  if (claims.exp * 1000 < Date.now() - 60_000) throw new Error('ID token: expired');
  if (claims.nonce !== nonce) throw new Error('ID token: nonce mismatch');
  return claims;
}

async function tokenRequest(form) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const text = await r.text();
  let j = {};
  try {
    j = JSON.parse(text);
  } catch {}
  if (!r.ok) {
    const code = j.error?.code ?? j.error ?? `http_${r.status}`;
    const e = new Error(`${code}${j.error_description ? ': ' + j.error_description : ''}`);
    e.code = String(code);
    throw e;
  }
  return j;
}

/** A loopback listener on 127.0.0.1 (the preferred port, else any free one), resolving with the callback's query. */
function listen() {
  return new Promise((resolve, reject) => {
    let done;
    const result = new Promise((r) => (done = r));
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const ok = !u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>IngrainedCut</title><body style="font-family:system-ui;background:#161616;color:#ddd;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2>${ok ? 'Signed in to IngrainedCut' : 'Sign-in was cancelled'}</h2><p>You can close this tab and go back to IngrainedCut.</p></div>`,
      );
      done(Object.fromEntries(u.searchParams));
    });
    const tryPort = (port) => {
      server.once('error', (e) => (port ? tryPort(0) : reject(e)));
      server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, result }));
    };
    tryPort(PREFERRED_PORT);
  });
}

let pending = null;
export function cancelSignIn() {
  pending?.cancel();
}

/**
 * Sign in (first time: registers IngrainedCut for this ChatGPT account; later: signs the same registration in again).
 * Opens the system browser with `openExternal`, waits for the loopback callback, exchanges the code and saves the tokens.
 */
export async function signIn(openExternal) {
  cancelSignIn();
  load();
  const host = hostId();
  const prev = rec.account?.client_id ? rec.account : null;
  const clientId = prev?.client_id ?? 'dynamic_agent_client';
  const { server, port, result } = await listen();
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const state = random();
  const nonce = random();
  const verifier = random(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: host,
  });
  if (!prev) q.set('agent_name_hint', APP_NAME);
  else {
    if (prev.id_token) q.set('id_token_hint', prev.id_token);
    if (prev.email) q.set('login_hint', prev.email);
  }
  let timer;
  const cancelled = new Promise((_, reject) => {
    pending = { cancel: () => reject(new Error('Sign-in cancelled')) };
    timer = setTimeout(() => reject(new Error('Sign-in timed out — try again')), 10 * 60_000);
  });
  try {
    openExternal(`${AUTHORIZE}?${q}`);
    const cb = await Promise.race([result, cancelled]);
    if (cb.state !== state) throw new Error('Sign-in failed: the response did not match this request');
    if (cb.error) {
      if (cb.error === 'access_denied') return { ok: false, denied: true, out: 'You declined the sign-in.' };
      throw new Error(`Sign-in failed: ${cb.error_description || cb.error}`);
    }
    // a new registration hands back the issued client id; a returning sign-in keeps the saved one
    const issued = prev ? prev.client_id : cb.client_id;
    if (!issued || issued === 'dynamic_agent_client') throw new Error('Sign-in did not finish registering IngrainedCut — try again');
    if (prev && cb.client_id && cb.client_id !== prev.client_id) throw new Error('Sign-in returned a different app registration — try again');
    let tok;
    try {
      tok = await tokenRequest({ grant_type: 'authorization_code', client_id: issued, code: cb.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE });
    } catch (e) {
      if (/invalid_grant/.test(e.code)) throw new Error('The sign-in code expired — please try again');
      throw e;
    }
    const claims = await verifyIdToken(tok.id_token, { clientId: issued, nonce });
    if (prev?.subject && prev.subject !== claims.sub) throw new Error('You signed in with a different ChatGPT account. Sign out first to switch accounts.');
    const scopes = String(tok.scope ?? cb.scope ?? '').split(/[\s+]+/).filter(Boolean);
    rec.account = {
      client_id: issued,
      subject: claims.sub,
      email: claims.email ?? prev?.email ?? null,
      issuer: claims.iss,
      id_token: tok.id_token,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      token_type: tok.token_type ?? 'Bearer',
      expires_in: tok.expires_in ?? 3600,
      scopes,
      saved_at: new Date().toISOString(),
    };
    save();
    return { ok: true, email: rec.account.email, plan: planReady(), out: planReady() ? 'Signed in' : 'Signed in, but ChatGPT plan use was not allowed' };
  } finally {
    clearTimeout(timer);
    pending = null;
    server.close();
  }
}

let refreshing = null;
/** A valid access token for the ChatGPT plan (refreshed when it has under 10 minutes left), or null when not signed in. */
export async function accessToken() {
  if (!planReady()) return null;
  const a = load().account;
  const expires = Date.parse(a.saved_at) + (a.expires_in ?? 3600) * 1000;
  if (expires - Date.now() > 10 * 60_000) return a.access_token;
  refreshing ??= (async () => {
    try {
      const tok = await tokenRequest({ grant_type: 'refresh_token', client_id: a.client_id, refresh_token: a.refresh_token, resource: RESOURCE });
      Object.assign(rec.account, {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? a.refresh_token,
        expires_in: tok.expires_in ?? 3600,
        scopes: tok.scope ? String(tok.scope).split(/\s+/) : a.scopes,
        saved_at: new Date().toISOString(),
        ...(tok.id_token ? { id_token: tok.id_token } : {}),
      });
      save();
      return rec.account.access_token;
    } catch (e) {
      // the other app (desktop app / helper) renewed it a moment earlier: use its new sign-in instead of signing out
      const now = load().account;
      if (now?.refresh_token && now.refresh_token !== a.refresh_token) return now.access_token;
      if (TERMINAL.test(e.code ?? e.message)) {
        dropTokens();
        throw new Error('CHATGPT_SIGNED_OUT');
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function dropTokens() {
  if (!rec.account) return;
  // keep the registration (client id, account) so signing in again reuses it
  const { client_id, subject, email, issuer } = rec.account;
  rec.account = { client_id, subject, email, issuer };
  save();
}

/** Sign out: revoke the refresh token at OpenAI, then forget the tokens on this computer. */
export async function signOut() {
  const a = load().account;
  if (a?.refresh_token) {
    try {
      const cfg = await discovery();
      if (cfg.revocation_endpoint)
        await fetch(cfg.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: a.refresh_token, token_type_hint: 'refresh_token', client_id: a.client_id }),
        });
    } catch (e) {
      console.error('chatgpt revoke', e.message);
    }
  }
  dropTokens();
  if (rec.account) delete rec.account.id_token;
  save();
  return status();
}

/** The models this ChatGPT plan can use here (OpenAI's list for this sign-in). */
export async function listModels() {
  const token = await accessToken();
  if (!token) return [];
  const r = await fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.models ?? j.data ?? [])
    .filter((m) => !m.visibility || m.visibility === 'list')
    .map((m) => ({
      id: m.slug ?? m.id,
      label: m.display_name || m.slug || m.id,
      desc: m.description,
      efforts: (m.supported_reasoning_levels ?? []).map((x) => x.effort ?? x),
      defaultEffort: m.default_reasoning_level,
    }));
}

/** Codex settings for running on the ChatGPT plan (OpenAI's documented Codex setup for Sign in with ChatGPT). */
export const PLAN_PROVIDER_CONFIG = {
  model_provider: 'openai_chatgpt_plan',
  model_providers: {
    openai_chatgpt_plan: {
      name: 'ChatGPT plan',
      base_url: RESOURCE,
      env_key: 'ACCESS_TOKEN',
      wire_api: 'responses',
      requires_openai_auth: false,
      supports_websockets: false,
    },
  },
};
