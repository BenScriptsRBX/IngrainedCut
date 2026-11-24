// IngrainedCut for Chrome: lets the IngrainedCut website's AI chat run on the user's own ChatGPT plan, with nothing
// else to install. It does what the desktop app and helper do for Sign in with ChatGPT (electron/chatgptAuth.mjs):
// OAuth with PKCE against OpenAI, the sign-in tokens kept in this browser's extension storage (never given to the
// page), and the ChatGPT requests sent from here. The chat itself (tools, conversation) runs in the editor page.
//
// The sign-in uses the loopback address OpenAI allows for apps that run on the user's computer
// (http://127.0.0.1:1455/auth/callback). Nothing listens there: when OpenAI sends the sign-in tab to it, the
// extension reads the code from the tab's address and closes the tab.
import { CONFIG } from './config.js';

const AUTHORIZE = `${CONFIG.auth}/api/accounts/authorize`;
const TOKEN = `${CONFIG.auth}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const APP_NAME = 'IngrainedCut';
const REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const SITE = 'https://www.ingrainedcut.com/editor';
// refresh errors that mean the sign-in is over (sign in again)
const TERMINAL = /invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused/;

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(fromB64url(s)));

// ---------- saved state ----------
// local: { hostId, account: { client_id, subject, email, issuer, id_token, access_token, refresh_token, expires_in, scopes, saved_at }, welcomeSeen }
// session: { pending: { state, nonce, verifier, clientId, prevClientId, tabId, openerTabId, started }, lastResult }
const getLocal = () => chrome.storage.local.get(null);
const setLocal = (patch) => chrome.storage.local.set(patch);

async function hostId() {
  const { hostId } = await getLocal();
  if (hostId) return hostId;
  const id = `urn:uuid:${crypto.randomUUID()}`;
  await setLocal({ hostId: id });
  return id;
}

const planReady = (a) => !!(a?.refresh_token && a.scopes?.includes(PLAN_SCOPE));

async function status() {
  const { account: a, welcomeSeen } = await getLocal();
  const { pending, lastResult } = await chrome.storage.session.get(['pending', 'lastResult']);
  return { signedIn: !!a?.refresh_token, email: a?.email ?? null, plan: planReady(a), welcomeSeen: !!welcomeSeen, signingIn: !!pending, lastResult: lastResult ?? null };
}

// ---------- OpenAI sign-in ----------
let oidc = null;
async function discovery() {
  if (!oidc) {
    const r = await fetch(`${CONFIG.auth}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OpenAI sign-in is unavailable right now (${r.status})`);
    oidc = await r.json();
  }
  return oidc;
}

/** Verify the ID token: signature against OpenAI's published keys, issuer, audience, expiry and nonce. */
async function verifyIdToken(idToken, { clientId, nonce }) {
  const [h, p, sig] = idToken.split('.');
  const header = jsonPart(h);
  const claims = jsonPart(p);
  const cfg = await discovery();
  const jwks = await (await fetch(cfg.jwks_uri)).json();
  const jwk = jwks.keys.find((k) => k.kid === header.kid) ?? (jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) throw new Error('ID token: unknown signing key');
  const hash = { RS256: 'SHA-256', RS384: 'SHA-384', RS512: 'SHA-512' }[header.alg];
  if (!hash) throw new Error(`ID token: unsupported algorithm ${header.alg}`);
  const { kty, n, e } = jwk;
  const key = await crypto.subtle.importKey('jwk', { kty, n, e }, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sig), new TextEncoder().encode(`${h}.${p}`));
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
    const err = new Error(`${code}${j.error_description ? ': ' + j.error_description : ''}`);
    err.code = String(code);
    throw err;
  }
  return j;
}

/** Start signing in: opens OpenAI's sign-in in a new tab. The result arrives when that tab reaches the callback address. */
async function startSignIn(openerTabId) {
  const old = (await chrome.storage.session.get('pending')).pending;
  if (old?.tabId) chrome.tabs.remove(old.tabId).catch(() => {});
  const { account: prev } = await getLocal();
  const host = await hostId();
  const known = prev?.client_id ? prev : null;
  const state = random();
  const nonce = random();
  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    client_id: known?.client_id ?? 'dynamic_agent_client',
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: host,
  });
  if (!known) q.set('agent_name_hint', APP_NAME);
  else {
    if (known.id_token) q.set('id_token_hint', known.id_token);
    if (known.email) q.set('login_hint', known.email);
  }
  const tab = await chrome.tabs.create({ url: `${AUTHORIZE}?${q}`, ...(openerTabId != null ? { openerTabId } : {}) });
  await chrome.storage.session.set({ pending: { state, nonce, verifier, prevClientId: known?.client_id ?? null, tabId: tab.id, openerTabId, started: Date.now() }, lastResult: null });
  return { started: true };
}

async function endSignIn(result, pending) {
  await chrome.storage.session.set({ pending: null, lastResult: { ...result, at: Date.now() } });
  if (pending?.tabId != null) chrome.tabs.remove(pending.tabId).catch(() => {});
  if (pending?.openerTabId != null) chrome.tabs.update(pending.openerTabId, { active: true }).catch(() => {});
}

/** The sign-in tab reached the callback address: check it, exchange the code for tokens and save them. */
async function finishSignIn(url) {
  const { pending } = await chrome.storage.session.get('pending');
  if (!pending) return;
  const cb = Object.fromEntries(new URL(url).searchParams);
  try {
    if (cb.state !== pending.state) throw new Error('Sign-in failed: the response did not match this request');
    if (cb.error) {
      if (cb.error === 'access_denied') return endSignIn({ ok: false, denied: true, out: 'You declined the sign-in.' }, pending);
      throw new Error(`Sign-in failed: ${cb.error_description || cb.error}`);
    }
    const { account: prev } = await getLocal();
    // a new registration hands back the issued client id; a returning sign-in keeps the saved one
    const issued = pending.prevClientId ?? cb.client_id;
    if (!issued || issued === 'dynamic_agent_client') throw new Error('Sign-in did not finish registering IngrainedCut. Try again.');
    if (pending.prevClientId && cb.client_id && cb.client_id !== pending.prevClientId) throw new Error('Sign-in returned a different app registration. Try again.');
    let tok;
    try {
      tok = await tokenRequest({ grant_type: 'authorization_code', client_id: issued, code: cb.code, code_verifier: pending.verifier, redirect_uri: REDIRECT, resource: RESOURCE });
    } catch (e) {
      if (/invalid_grant/.test(e.code)) throw new Error('The sign-in code expired. Please try again.');
      throw e;
    }
    const claims = await verifyIdToken(tok.id_token, { clientId: issued, nonce: pending.nonce });
    if (prev?.subject && prev.client_id === issued && prev.subject !== claims.sub) throw new Error('You signed in with a different ChatGPT account. Sign out first to switch accounts.');
    const scopes = String(tok.scope ?? cb.scope ?? '').split(/[\s+]+/).filter(Boolean);
    const account = {
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
    await setLocal({ account });
    const plan = planReady(account);
    await endSignIn({ ok: true, email: account.email, plan, out: plan ? 'Signed in' : 'Signed in, but ChatGPT plan use was not allowed' }, pending);
  } catch (e) {
    await endSignIn({ ok: false, out: e?.message || String(e) }, pending);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && info.url.startsWith(REDIRECT)) {
    chrome.storage.session.get('pending').then(({ pending }) => {
      if (pending?.tabId === tabId) finishSignIn(info.url);
    });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.get('pending').then(({ pending }) => {
    if (pending?.tabId === tabId) endSignIn({ ok: false, cancelled: true, out: 'Sign-in cancelled' }, { ...pending, tabId: null });
  });
});

async function cancelSignIn() {
  const { pending } = await chrome.storage.session.get('pending');
  if (pending) await endSignIn({ ok: false, cancelled: true, out: 'Sign-in cancelled' }, pending);
}

// ---------- tokens ----------
let refreshing = null;
/** A valid access token for the ChatGPT plan (refreshed when it has under 10 minutes left), or null when not signed in. */
async function accessToken() {
  const { account: a } = await getLocal();
  if (!planReady(a)) return null;
  const expires = Date.parse(a.saved_at) + (a.expires_in ?? 3600) * 1000;
  if (expires - Date.now() > 10 * 60_000) return a.access_token;
  refreshing ??= (async () => {
    try {
      const tok = await tokenRequest({ grant_type: 'refresh_token', client_id: a.client_id, refresh_token: a.refresh_token, resource: RESOURCE });
      const account = {
        ...a,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? a.refresh_token,
        expires_in: tok.expires_in ?? 3600,
        scopes: tok.scope ? String(tok.scope).split(/\s+/) : a.scopes,
        saved_at: new Date().toISOString(),
        ...(tok.id_token ? { id_token: tok.id_token } : {}),
      };
      await setLocal({ account });
      return account.access_token;
    } catch (e) {
      if (TERMINAL.test(e.code ?? e.message)) {
        await dropTokens();
        throw new Error('CHATGPT_SIGNED_OUT');
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function dropTokens() {
  const { account } = await getLocal();
  if (!account) return;
  // keep the registration (client id, account) so signing in again reuses it
  const { client_id, subject, email, issuer } = account;
  await setLocal({ account: { client_id, subject, email, issuer } });
}

/** Sign out: revoke the refresh token at OpenAI, then forget the tokens in this browser. */
async function signOut() {
  const { account: a } = await getLocal();
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
      console.error('revoke', e.message);
    }
  }
  await dropTokens();
  return status();
}

/** The models this ChatGPT plan can use here (OpenAI's list for this sign-in). */
async function listModels() {
  const token = await accessToken();
  if (!token) return [];
  const r = await fetch(`${CONFIG.apiBase}/models`, { headers: { Authorization: `Bearer ${token}` } });
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

// ---------- requests from the website (content.js) and the toolbar popup ----------
const METHODS = {
  status: () => status(),
  signIn: (_p, sender) => startSignIn(sender.tab?.id),
  cancelSignIn: () => cancelSignIn().then(status),
  signOut: () => signOut(),
  models: () => listModels(),
  welcomeSeen: () => setLocal({ welcomeSeen: true }).then(() => true),
  openSite: () => chrome.tabs.create({ url: SITE }).then(() => true),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = METHODS[msg?.method];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg.params ?? {}, sender))
    .then(
      (value) => sendResponse({ value }),
      (e) => sendResponse({ error: e?.message || String(e) }),
    );
  return true;
});

// a ChatGPT request, streamed back to the page as it arrives
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'responses') return;
  const ctrl = new AbortController();
  let gone = false;
  const post = (m) => {
    if (!gone) port.postMessage(m);
  };
  port.onDisconnect.addListener(() => {
    gone = true;
    ctrl.abort();
  });
  port.onMessage.addListener(async (msg) => {
    if (msg?.t !== 'start') return;
    if (msg.path !== '/responses') return post({ t: 'error', message: 'Unknown request' });
    try {
      const token = await accessToken();
      if (!token) return post({ t: 'error', message: 'CHATGPT_NEEDS_SIGNIN' });
      const r = await fetch(`${CONFIG.apiBase}${msg.path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(msg.body),
        signal: ctrl.signal,
      });
      if (!r.ok) return post({ t: 'error', status: r.status, text: (await r.text().catch(() => '')).slice(0, 4000) });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        post({ t: 'data', text: dec.decode(value, { stream: true }) });
      }
      post({ t: 'end' });
    } catch (e) {
      if (!ctrl.signal.aborted) post({ t: 'error', message: e?.message === 'CHATGPT_SIGNED_OUT' ? 'CHATGPT_SIGNED_OUT' : `fetch failed: ${e?.message || e}` });
    }
  });
});
