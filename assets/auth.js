// ─────────────────────────────────────────────────────────────────────────────
// GitHub authentication + API helpers for the AutoMorpheBuilder UI.
//
// OAuth flow: GitHub App, authorization-code-with-PKCE, popup window.
// Token is stored in sessionStorage only (cleared when the tab closes).
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'amb-ui-token';
const USER_KEY    = 'amb-ui-user';

// Configure the OAuth handler URL — set to your Cloudflare Worker deployment.
// Local dev override: set localStorage('amb-ui-auth-base') before loading.
const DEFAULT_AUTH_BASE = 'https://amb-ui-auth.nxn94.workers.dev';
const AUTH_BASE = (() => {
  try { return localStorage.getItem('amb-ui-auth-base') || DEFAULT_AUTH_BASE; } catch { return DEFAULT_AUTH_BASE; }
})();

// The GitHub App's OAuth callback URL must be on the same origin as the UI
// (this page) — otherwise the popup's window.opener is dropped by Chromium
// when GitHub redirects the OAuth flow across origins, and postMessage
// back to this page silently fails. This URL must be registered as the
// App's "Callback URL" in the GitHub App settings.
//
// Override via localStorage('amb-ui-auth-redirect') for forks of this repo.
const AUTH_BASE_REDIRECT = (() => {
  try { return localStorage.getItem('amb-ui-auth-redirect') || (location.origin + '/auth-callback.html'); } catch { return location.origin + '/auth-callback.html'; }
})();

// ─── PKCE helpers ───────────────────────────────────────────────────────────

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return a;
}

async function pkcePair() {
  const verifier = base64url(randomBytes(32));        // 43-char URL-safe
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

// ─── Token storage ──────────────────────────────────────────────────────────

export function getToken() {
  try { return sessionStorage.getItem(SESSION_KEY) || null; } catch { return null; }
}

export function setToken(token, user) {
  try {
    sessionStorage.setItem(SESSION_KEY, token);
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}

export function clearToken() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {}
}

export function getUser() {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

export function isAuthenticated() { return !!getToken(); }

// ─── Sign-in flow ────────────────────────────────────────────────────────────
//
// Opens a popup to GitHub's authorize URL. On success, the popup posts the
// access token back via window.postMessage; we resolve with the token.

const pendingAuth = new Map(); // state → {resolve, reject}

window.addEventListener('message', async (ev) => {
  // Only trust messages from our auth worker (don't accept tokens from random origins).
  if (!ev.origin || !ev.origin.startsWith(AUTH_BASE.replace(/^https?:\/\//, ''))) return;
  const data = ev.data;
  if (!data || data.type !== 'amb-ui-oauth') return;
  const pending = pendingAuth.get(data.nonce);
  if (!pending) return;
  pendingAuth.delete(data.nonce);
  if (data.token) {
    // Look up the user to cache username/avatar for display.
    try {
      const user = await ghFetch('/user', data.token);
      setToken(data.token, { login: user.login, avatar_url: user.avatar_url, html_url: user.html_url });
      pending.resolve({ token: data.token, user });
    } catch (err) {
      pending.resolve({ token: data.token, user: null });
    }
  } else {
    pending.reject(new Error('OAuth callback returned no token'));
  }
});

export function signIn() {
  return new Promise(async (resolve, reject) => {
    const nonce = base64url(randomBytes(16));
    const { verifier, challenge } = await pkcePair();
    // Encode the PKCE verifier in the `state` parameter. GitHub echoes state
    // back unchanged through the redirect, and OAuth state is the standard
    // way to round-trip PKCE in the authorization-code-with-PKCE flow.
    // We separate the verifier from the nonce so the UI can verify the
    // callback matches the flow it initiated.
    const state = `${verifier}.${nonce}`;
    pendingAuth.set(nonce, { resolve, reject });

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id',     await ghClientId());
    // Callback URL must be on the UI's own origin so the popup's window.opener
    // survives the OAuth redirect chain. The callback page calls our worker's
    // /token endpoint server-side to exchange the code with the App's
    // client_secret (which is never exposed to the browser).
    authUrl.searchParams.set('redirect_uri',  AUTH_BASE_REDIRECT);
    authUrl.searchParams.set('state',         state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // No `scope` — App permissions are configured in the App's settings.

    const popup = window.open(authUrl.toString(), 'amb-ui-oauth', 'width=600,height=700');
    if (!popup) {
      pendingAuth.delete(nonce);
      reject(new Error('Popup blocked. Allow popups for this site and try again.'));
      return;
    }

    // Timeout after 2 minutes.
    setTimeout(() => {
      if (pendingAuth.has(nonce)) {
        pendingAuth.delete(nonce);
        reject(new Error('Sign-in timed out after 2 minutes.'));
        try { popup.close(); } catch {}
      }
    }, 120_000);
  });
}

// The Worker needs to know the App's client_id to build the authorize URL.
// We bundle it into the Worker via wrangler.jsonc vars; the UI fetches it
// from /client-id at boot so we don't have to redeploy the UI when the App
// changes.
let cachedClientId = null;
async function ghClientId() {
  if (cachedClientId) return cachedClientId;
  const r = await fetch(`${AUTH_BASE}/client-id`);
  if (!r.ok) throw new Error(`Could not fetch OAuth client id from ${AUTH_BASE} (HTTP ${r.status})`);
  const j = await r.json();
  cachedClientId = j.client_id;
  return cachedClientId;
}

// ─── Authenticated GitHub API requests ──────────────────────────────────────

export async function ghFetch(path, token, init = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { 'authorization': `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).message || ''; } catch {}
    throw new Error(`GitHub API ${r.status}: ${detail || r.statusText}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─── PR-back helper ─────────────────────────────────────────────────────────
//
// Pushes patches.json + config.json (whichever have changed) to a new branch
// on the given repo, then opens a PR back to the default branch.
//
// `files`: { 'patches.json': '...content...', 'config.json': '...content...' }
// Only files actually passed (and actually changed vs originalJson map) get committed.

export async function pushAsPR({ repo, branch, baseBranch, token, files, originalJson, title, body }) {
  const headers = (extra = {}) => ({
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'authorization': `Bearer ${token}`,
    ...extra,
  });

  // 1. Resolve the default branch if not specified.
  let base = baseBranch;
  if (!base) {
    const meta = await ghFetch(`/repos/${repo}`, token);
    base = meta.default_branch;
  }

  // 2. Create the new branch from base (idempotent — if it exists from a previous attempt, that's fine).
  let refSha;
  try {
    const baseRef = await ghFetch(`/repos/${repo}/git/ref/heads/${base}`, token);
    refSha = baseRef.object.sha;
  } catch (e) {
    throw new Error(`Could not resolve base branch "${base}" on ${repo}: ${e.message}`);
  }
  try {
    await ghFetch(`/repos/${repo}/git/refs/heads/${branch}`, token);
    // Branch already exists — assume it's ours from a previous attempt.
  } catch {
    await ghFetch(`/repos/${repo}/git/refs`, token, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: refSha }),
    });
  }

  // 3. For each file: get its current blob SHA on base, then create a new commit
  //    with both blobs, then update the branch ref to the new commit.
  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    // Get the file's current SHA on the BASE branch (not the new branch — if
    // the user is updating after a previous attempt, the new branch might
    // already have these files).
    let baseFileSha = null;
    try {
      const f = await ghFetch(`/repos/${repo}/contents/${path}?ref=${base}`, token);
      baseFileSha = f.sha;
    } catch {
      // File doesn't exist on base — fine, we'll create it.
    }
    // Create a new blob with the new content.
    const blob = await ghFetch(`/repos/${repo}/git/blobs`, token, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha, ...(baseFileSha ? { previous_sha: baseFileSha } : {}) });
  }

  // 4. Get the base branch's tree, then create a new tree with our changes.
  const baseCommit = await ghFetch(`/repos/${repo}/git/commits/${refSha}`, token);
  const newTree = await ghFetch(`/repos/${repo}/git/trees`, token, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });

  // 5. Create the commit.
  const commit = await ghFetch(`/repos/${repo}/git/commits`, token, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      message: title || 'Update AutoMorpheBuilder config via UI',
      tree: newTree.sha,
      parents: [refSha],
    }),
  });

  // 6. Update the branch ref to point at the new commit (force=true in case
  //    the branch already existed and we'd otherwise be stuck).
  await ghFetch(`/repos/${repo}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ sha: commit.sha, force: true }),
  });

  // 7. Open a PR back to base.
  const pr = await ghFetch(`/repos/${repo}/pulls`, token, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      title: title || 'Update AutoMorpheBuilder config via UI',
      head: branch,
      base,
      body: body || 'Generated by the AutoMorpheBuilder UI.',
      maintainer_can_modify: true,
    }),
  });

  return pr;
}

// ─── Sign-out ────────────────────────────────────────────────────────────────

export function signOut() {
  clearToken();
}