// ─────────────────────────────────────────────────────────────────────────────
// AutoMorpheBuilder UI — main controller
// ─────────────────────────────────────────────────────────────────────────────

import { PatchesEditor } from './patches-editor.js';
import { validateConfig } from './validate.js';

// ─── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    const target = tabBtn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => {
      const active = b.dataset.tab === target;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${target}`);
    });
  });
});

// ─── Theme toggle ──────────────────────────────────────────────────────────
// Cycle: auto → light → dark → auto. 'auto' tracks prefers-color-scheme.
const THEME_KEY = 'amb-ui-theme';
const THEME_CYCLE = ['auto', 'light', 'dark'];

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'auto';
}

function applyTheme(theme) {
  if (!THEME_CYCLE.includes(theme)) theme = 'auto';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  const btn = document.querySelector('#theme-toggle');
  if (btn) btn.title = `Theme: ${theme} (click to switch)`;
}

document.querySelector('#theme-toggle')?.addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme()) + 1) % THEME_CYCLE.length];
  applyTheme(next);
});

// If the OS preference changes while we're in 'auto', the @media query
// already handles repaint — nothing JS-side is needed. Keep the button
// title in sync on load.
applyTheme(currentTheme());

// ─── Helpers ────────────────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);

function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Toast notifications ────────────────────────────────────────────────────
// Lightweight non-blocking notifications that auto-dismiss. Use for
// success messages (PR opened, sign-in succeeded) and recoverable errors.
// For destructive confirmations, use confirm().

let toastSeq = 0;
function toast(kind, message, { duration = 5000, href = null } = {}) {
  const host = $('#toast-host') || (() => {
    const h = document.createElement('div');
    h.id = 'toast-host';
    document.body.appendChild(h);
    return h;
  })();
  const id = ++toastSeq;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.dataset.id = id;
  const icon = { success: '✓', error: '✕', info: 'ℹ' }[kind] || 'ℹ';
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg"></span>
    ${href ? '<a class="toast-link" target="_blank" rel="noopener">View</a>' : ''}
    <button class="toast-close" type="button" aria-label="Dismiss">×</button>`;
  el.querySelector('.toast-msg').textContent = message;
  if (href) el.querySelector('.toast-link').href = href;
  el.querySelector('.toast-close').addEventListener('click', () => dismiss());
  host.appendChild(el);
  let timer = null;
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 180);
    clearTimeout(timer);
  };
  timer = setTimeout(dismiss, duration);
  return { dismiss, el };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (file://)
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; }
    finally { document.body.removeChild(ta); }
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function fetchRaw(repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.text();
}

function showAlert(container, kind, msg, items = null) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = `alert ${kind}`;
  box.innerHTML = `<strong>${msg}</strong>` + (items ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '');
  container.appendChild(box);
}
function clearAlert(container) { container.innerHTML = ''; }

// ─── Patches tab ────────────────────────────────────────────────────────────
const patchesEditor = new PatchesEditor($('#patches-editor'), $('#patches-warnings'), {
  onChange: () => updatePatchesSummary(),
});

function updatePatchesSummary() {
  const data = patchesEditor.getData();
  let apps = 0, patches = 0, off = 0;
  for (const repo of Object.keys(data)) {
    for (const pkg of Object.keys(data[repo] || {})) {
      apps++;
      for (const v of Object.values(data[repo][pkg] || {})) {
        patches++;
        if (v === false) off++;
      }
    }
  }
  const summary = apps === 0
    ? 'No data loaded'
    : `${apps} app${apps === 1 ? '' : 's'}, ${patches} patch${patches === 1 ? '' : 'es'} (${off} disabled)`;
  $('#patches-summary').textContent = summary;
  $('#patches-actions').hidden = apps === 0;
  const d = patchesEditor.diffSummary();
  $('#patches-diff-info').textContent = d
    ? `Δ ${d.added} added · ${d.removed} removed · ${d.changed} changed`
    : '';
}

$('#patches-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);
    patchesEditor.setData(data, text);
    showAlert($('#patches-warnings'), 'success', `Loaded ${file.name} (${text.length.toLocaleString()} bytes).`);
    setTimeout(() => clearAlert($('#patches-warnings')), 2500);
  } catch (err) {
    showAlert($('#patches-warnings'), 'error', 'Failed to parse file:', [`${err.message}`]);
  }
  updatePatchesSummary();
});

$('#patches-load-sample').addEventListener('click', async () => {
  // Pull the live sample from upstream — keeps the sample in sync with reality.
  try {
    const text = await fetchRaw('nxn94/AutoMorpheBuilder', 'dev', 'patches.json');
    patchesEditor.setData(JSON.parse(text), text);
    showAlert($('#patches-warnings'), 'success', 'Loaded sample patches.json from nxn94/AutoMorpheBuilder@dev.');
    setTimeout(() => clearAlert($('#patches-warnings')), 2500);
  } catch (err) {
    showAlert($('#patches-warnings'), 'error', 'Could not fetch sample:', [`${err.message}`]);
  }
  updatePatchesSummary();
});

$('#patches-fetch').addEventListener('click', async () => {
  const repo = $('#patches-repo').value.trim();
  const branch = $('#patches-branch').value.trim() || 'dev';
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    showAlert($('#patches-warnings'), 'error', 'Invalid repo:', ['must be "owner/repo"']);
    return;
  }
  try {
    const text = await fetchRaw(repo, branch, 'patches.json');
    patchesEditor.setData(JSON.parse(text), text);
    showAlert($('#patches-warnings'), 'success', `Fetched ${repo}@${branch}/patches.json`);
    setTimeout(() => clearAlert($('#patches-warnings')), 2500);
  } catch (err) {
    showAlert($('#patches-warnings'), 'error', 'Fetch failed:', [`${err.message}`]);
  }
  updatePatchesSummary();
});

$('#patches-clear').addEventListener('click', () => {
  patchesEditor.setData({}, null);
  clearAlert($('#patches-warnings'));
  updatePatchesSummary();
});

$('#patches-download').addEventListener('click', () => {
  downloadFile('patches.json', patchesEditor.getJson(2) + '\n');
});
$('#patches-copy').addEventListener('click', async () => {
  await copyToClipboard(patchesEditor.getJson(2) + '\n');
  const orig = $('#patches-copy').textContent;
  $('#patches-copy').textContent = 'Copied ✓';
  setTimeout(() => { $('#patches-copy').textContent = orig; }, 1200);
});

// ─── Config tab (json-editor) ────────────────────────────────────────────────
let configEditor = null; // JSONEditor instance
let configOriginalJson = null;

const configSchema = {
  title: 'AutoMorpheBuilder config.json',
  type: 'object',
  additionalProperties: false,
  required: ['patch_repos', 'cli'],
  properties: {
    preferred_arch: {
      type: 'string',
      enum: ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'],
      default: 'arm64-v8a',
      description: 'Android ABI the downloader prefers when multiple APKs are available.',
    },
    auto_update_urls: {
      type: 'boolean',
      default: true,
      description: 'When true, pre_download_apks.sh writes resolved URLs back into download_urls.',
    },
    patch_repos: {
      type: 'object',
      format: 'table', // JSONEditor's table format renders dynamic keys as a table
      title: 'Apps to build (keyed by Android package id)',
      description: 'One entry per app. Each key must be a valid Android package id like com.google.android.youtube.',
      additionalProperties: {
        type: 'object',
        title: 'App',
        additionalProperties: false,
        required: ['name', 'repo', 'branch', 'apkmirror_path'],
        properties: {
          name:               { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Release-name slug (lowercase, hyphens). Used in release tags.' },
          repo:               { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$',       description: 'owner/repo of the patch repo on GitHub.' },
          branch:             { type: 'string', pattern: '^[A-Za-z0-9._/-]+$',        description: 'Branch of the patch repo.' },
          apkmirror_path:     { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$',       description: 'APKMirror publisher/package slug.' },
          pin_version:        { type: 'string', pattern: '^\\d+(\\.\\d+)+$',          description: 'Optional. Pin a specific APK version (e.g. "20.44.38").' },
          pin_patch_tag:      { type: 'string', pattern: '^v?\\d+(\\.\\d+)+([-.+][\\w.-]+)?$', description: 'Optional. Pin a patch tag (e.g. "v1.18.3").' },
          display_name:       { type: 'string', minLength: 1,                       description: 'Optional human-readable name for README/Obtainium.' },
        },
      },
    },
    cli: {
      type: 'object',
      title: 'morphe-desktop CLI',
      additionalProperties: false,
      required: ['repo', 'branch'],
      properties: {
        repo:   { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$', description: 'owner/repo of the morphe-desktop CLI.' },
        branch: { type: 'string', enum: ['main', 'dev'],           description: 'Branch to pin the CLI jar to.' },
      },
    },
    download_urls: {
      type: 'object',
      title: 'Resolved APK URL cache (advanced)',
      description: 'Auto-populated by pre_download_apks.sh when auto_update_urls=true. Hand-editing is rarely needed.',
      additionalProperties: {
        type: 'object',
        additionalProperties: { type: 'string', format: 'uri' },
      },
    },
  },
};

function buildConfigEditor(value) {
  const container = $('#config-editor');
  container.innerHTML = '';
  // JSONEditor 2.x global from the vendored bundle.
  // Construction is synchronous; the editor's internal async load() runs
  // on the next tick and fires the `ready` event when done. Until that
  // fires, getValue()/setValue() throw "JSON Editor not ready yet".
  configEditor = new JSONEditor(container, {
    schema: configSchema,
    theme: 'barebones',
    iconlib: 'null',
    object_layout: 'normal',
    show_errors: 'always',
    required_by_default: true,
    // no_additional_properties: true breaks JSONEditor's rendering of
    // patch_repos, which has dynamic keys (Android package ids) via the
    // schema's `additionalProperties: { ... }` clause. JSONEditor treats
    // ANY property not literally listed in `properties` as "additional" and
    // falls back to an Edit-JSON textarea, silently dropping the data.
    // The schema's own `additionalProperties: false` already enforces the
    // structural constraint at validation time.
    disable_collapse: false,
    disable_edit_json: false,
    disable_properties: false,
    remove_empty_properties: false,
  });
  // Drive the first render from the just-loaded value so the user sees
  // accurate state immediately, instead of an empty-editor placeholder.
  updateConfigSummaryWith(value);
  runConfigValidationWith(value);
  // Wait for JSONEditor's async load to finish, then populate and re-render.
  // JSONEditor 2.x only exposes `on()` — no `once()` — so use a flag.
  configEditor._ambReady = false;
  configEditor.on('ready', () => {
    if (configEditor._ambReady) return;
    configEditor._ambReady = true;
    if (value !== undefined) {
      try { configEditor.setValue(value); }
      catch (e) { console.error('setValue failed:', e); }
    }
    runConfigValidation();
    updateConfigSummary();
  });
  configEditor.on('change', () => {
    runConfigValidation();
    updateConfigSummary();
  });
}

function getConfigJson() {
  if (!configEditor) return '{}';
  try {
    return JSON.stringify(configEditor.getValue(), null, 2) + '\n';
  } catch (err) {
    return '// Error reading editor: ' + err.message;
  }
}

function runConfigValidation() {
  // Same caveat as updateConfigSummary: read the editor's current value,
  // which may be stale on the first call after construction. The
  // microtask in buildConfigEditor re-runs this after JSONEditor
  // initializes, so users see the correct state on first render.
  const val = configEditor ? configEditor.getValue() : null;
  return runConfigValidationWith(val);
}

function runConfigValidationWith(val) {
  const result = validateConfig(val);
  if (!result.valid) {
    showAlert($('#config-warnings'), 'error', 'Config has validation errors:',
      result.errors.map(e => `<code>${e.path}</code>: ${e.message}`));
  } else {
    clearAlert($('#config-warnings'));
  }
  return result;
}

function updateConfigSummary() {
  // JSONEditor v2.x initializes its value asynchronously, so a synchronous
  // call immediately after buildConfigEditor() may read a stale/empty value.
  // The 'change' event listener registered in buildConfigEditor() handles
  // the steady-state case; this initial render just shows the loaded data.
  const val = configEditor ? configEditor.getValue() : null;
  return updateConfigSummaryWith(val);
}

function updateConfigSummaryWith(val) {
  if (!val || typeof val !== 'object') { $('#config-summary').textContent = 'No data loaded'; $('#config-actions').hidden = true; return; }
  const apps = val.patch_repos ? Object.keys(val.patch_repos).length : 0;
  $('#config-summary').textContent = apps === 0
    ? 'Empty config (no apps)'
    : `${apps} app${apps === 1 ? '' : 's'} configured`;
  $('#config-actions').hidden = apps === 0 && !val.cli;
  if (configOriginalJson) {
    try {
      const orig = JSON.parse(configOriginalJson);
      const added = (val.patch_repos ? Object.keys(val.patch_repos).length : 0) - (orig.patch_repos ? Object.keys(orig.patch_repos).length : 0);
      $('#config-diff-info').textContent = `Δ apps: ${added >= 0 ? '+' : ''}${added}`;
    } catch { $('#config-diff-info').textContent = ''; }
  } else {
    $('#config-diff-info').textContent = '';
  }
}

$('#config-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);
    configOriginalJson = text;
    buildConfigEditor(data);
    showAlert($('#config-warnings'), 'success', `Loaded ${file.name} (${text.length.toLocaleString()} bytes).`);
    setTimeout(() => runConfigValidation() && clearAlert($('#config-warnings')), 2500);
  } catch (err) {
    showAlert($('#config-warnings'), 'error', 'Failed to parse file:', [`${err.message}`]);
  }
  // No explicit updateConfigSummary(): buildConfigEditor's onload callback
  // fires once JSONEditor finishes loading. Calling getValue() here throws.
});

$('#config-load-sample').addEventListener('click', async () => {
  try {
    const text = await fetchRaw('nxn94/AutoMorpheBuilder', 'dev', 'config.json');
    const data = JSON.parse(text);
    configOriginalJson = text;
    buildConfigEditor(data);
    showAlert($('#config-warnings'), 'success', 'Loaded sample config.json from nxn94/AutoMorpheBuilder@dev.');
    setTimeout(() => clearAlert($('#config-warnings')), 2500);
  } catch (err) {
    showAlert($('#config-warnings'), 'error', 'Could not fetch sample:', [`${err.message}`]);
  }
  // No explicit updateConfigSummary() here: buildConfigEditor's onload callback
  // fires once JSONEditor finishes loading, and the change event keeps the
  // summary fresh. Calling getValue() before then throws.
});

$('#config-fetch').addEventListener('click', async () => {
  const repo = $('#config-repo').value.trim();
  const branch = $('#config-branch').value.trim() || 'dev';
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    showAlert($('#config-warnings'), 'error', 'Invalid repo:', ['must be "owner/repo"']);
    return;
  }
  try {
    const text = await fetchRaw(repo, branch, 'config.json');
    const data = JSON.parse(text);
    configOriginalJson = text;
    buildConfigEditor(data);
    showAlert($('#config-warnings'), 'success', `Fetched ${repo}@${branch}/config.json`);
    setTimeout(() => clearAlert($('#config-warnings')), 2500);
  } catch (err) {
    showAlert($('#config-warnings'), 'error', 'Fetch failed:', [`${err.message}`]);
  }
  // No explicit updateConfigSummary(): buildConfigEditor's onload callback
  // fires once JSONEditor finishes loading. Calling getValue() here throws.
});

$('#config-clear').addEventListener('click', () => {
  $('#config-editor').innerHTML = '';
  configEditor = null;
  configOriginalJson = null;
  clearAlert($('#config-warnings'));
  $('#config-summary').textContent = 'No data loaded';
  $('#config-actions').hidden = true;
});

$('#config-download').addEventListener('click', () => {
  const result = runConfigValidation();
  if (!result.valid) {
    if (!confirm('Config has validation errors. Download anyway?')) return;
  }
  downloadFile('config.json', getConfigJson());
});
$('#config-copy').addEventListener('click', async () => {
  await copyToClipboard(getConfigJson());
  const orig = $('#config-copy').textContent;
  $('#config-copy').textContent = 'Copied ✓';
  setTimeout(() => { $('#config-copy').textContent = orig; }, 1200);
});

// ─── Boot: load sample data eagerly so the UI is usable without clicks ─────
(async function boot() {
  try {
    const text = await fetchRaw('nxn94/AutoMorpheBuilder', 'dev', 'patches.json');
    patchesEditor.setData(JSON.parse(text), text);
    updatePatchesSummary();
  } catch (err) {
    console.warn('Could not pre-load patches.json sample:', err);
  }
  renderAuthIndicator();
})();

// ─── GitHub auth + PR-back (v2) ─────────────────────────────────────────────
import('./auth.js').then(({ isAuthenticated, getUser, getToken, signIn, signOut, pushAsPR }) => {
  // Expose to the rest of this file via a shared object.
  window.__ambAuth = { isAuthenticated, getUser, getToken, signIn, signOut, pushAsPR };
  renderAuthIndicator();
  wireSaveButtons();
}).catch(err => {
  console.error('Failed to load auth.js:', err);
});

function renderAuthIndicator() {
  const slot = $('#auth-indicator');
  if (!slot || !window.__ambAuth) return;
  if (window.__ambAuth.isAuthenticated()) {
    const u = window.__ambAuth.getUser();
    slot.innerHTML = `
      <a href="${u?.html_url || '#'}" target="_blank" rel="noopener">
        ${u?.avatar_url ? `<img src="${u.avatar_url}" alt="" width="20" height="20" style="border-radius:50%;vertical-align:middle">` : ''}
        ${u?.login || 'Signed in'}
      </a>
      <button class="btn" id="sign-out-btn" type="button">Sign out</button>`;
    slot.querySelector('#sign-out-btn')?.addEventListener('click', () => {
      window.__ambAuth.signOut();
      renderAuthIndicator();
    });
  } else {
    slot.innerHTML = `<button class="btn primary" id="sign-in-btn" type="button">Sign in with GitHub</button>`;
    slot.querySelector('#sign-in-btn')?.addEventListener('click', async () => {
      const btn = slot.querySelector('#sign-in-btn');
      btn.disabled = true; btn.textContent = 'Opening GitHub…';
      try {
        await window.__ambAuth.signIn();
        renderAuthIndicator();
      } catch (err) {
        alert('Sign-in failed: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Sign in with GitHub';
      }
    });
  }
}

function wireSaveButtons() {
  // Patches tab save
  $('#patches-save')?.addEventListener('click', () => openSaveDialog('patches'));
  // Config tab save
  $('#config-save')?.addEventListener('click', () => openSaveDialog('config'));
}

async function openSaveDialog(tab) {
  if (!window.__ambAuth) {
    toast('error', 'Auth module still loading, try again in a second.');
    return;
  }
  if (!window.__ambAuth.isAuthenticated()) {
    if (!confirm('Sign in with GitHub to push changes as a PR?')) return;
    try {
      await window.__ambAuth.signIn();
      renderAuthIndicator();
    } catch (err) {
      toast('error', 'Sign-in failed: ' + err.message);
      return;
    }
  }

  // Build the default payload: both files (only changed ones are actually committed server-side).
  const files = {};
  const originals = {};
  files['patches.json'] = patchesEditor.getJson(2) + '\n';
  if (patchesEditor.originalJson) originals['patches.json'] = patchesEditor.originalJson;
  files['config.json'] = getConfigJson();
  if (configOriginalJson) originals['config.json'] = configOriginalJson;
  // Drop unchanged files.
  for (const [p, content] of Object.entries(files)) {
    if (originals[p] && originals[p].trim() === content.trim()) {
      delete files[p];
    }
  }
  if (Object.keys(files).length === 0) {
    toast('info', 'No changes to commit — files are identical to the loaded version.');
    return;
  }

  const fileList = Object.keys(files);
  const defaultTitle = `UI: update ${fileList.join(', ')}`;
  const defaultRepo = $('#config-target-repo')?.value?.trim() || 'nxn94/AutoMorpheBuilder';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultBranch = `automorphe-ui-${ts}`;

  const { repo, branch, title, body } = await openSaveModal({
    defaultRepo, defaultBranch, defaultTitle,
    fileList,
  });
  if (!repo) return; // user cancelled
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    toast('error', 'Invalid repo. Must be "owner/repo".');
    return;
  }

  const btn = $(`#${tab}-save`);
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }

  try {
    const pr = await window.__ambAuth.pushAsPR({
      repo, branch,
      token: window.__ambAuth.getToken(),
      files, title, body,
    });
    toast('success', `PR opened: ${fileList.join(', ')}`, { duration: 8000, href: pr.html_url });
    if (btn) { btn.textContent = 'PR opened ✓'; setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000); }
  } catch (err) {
    toast('error', 'Push failed: ' + err.message, { duration: 10000 });
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

// ─── Save modal ──────────────────────────────────────────────────────────────
// Native <dialog> with focus trap. Returns the form values or null on cancel.

function openSaveModal({ defaultRepo, defaultBranch, defaultTitle, fileList }) {
  return new Promise((resolve) => {
    const dlg = $('#save-modal');
    if (!dlg) { resolve(null); return; }
    $('#save-modal-repo').value = defaultRepo;
    $('#save-modal-branch').value = defaultBranch;
    $('#save-modal-title').value = defaultTitle;
    $('#save-modal-body').value = 'Generated by the AutoMorpheBuilder UI.';
    $('#save-modal-files').textContent = fileList.join(', ');

    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.returnValue === 'submit') {
        resolve({
          repo:   $('#save-modal-repo').value.trim(),
          branch: $('#save-modal-branch').value.trim(),
          title:  $('#save-modal-title').value.trim(),
          body:   $('#save-modal-body').value,
        });
      } else {
        resolve(null);
      }
    };
    const onCancel = (e) => { e.preventDefault(); dlg.close('cancel'); };
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    setTimeout(() => $('#save-modal-repo')?.focus(), 0);
  });
}