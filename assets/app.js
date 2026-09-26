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
      format: 'table',
      title: 'Apps to build',
      description: 'Keyed by Android package id. Each entry defines a build target.',
      propertyNames: {
        pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$',
      },
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
  // JSONEditor 2.x global from the vendored bundle
  configEditor = new JSONEditor(container, {
    schema: configSchema,
    startval: value,
    theme: 'barebones',
    iconlib: 'null',
    object_layout: 'normal',
    show_errors: 'always',
    required_by_default: true,
    no_additional_properties: true,
    disable_collapse: false,
    disable_edit_json: false,
    disable_properties: false,
    remove_empty_properties: false,
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
  const val = configEditor ? configEditor.getValue() : null;
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
  const val = configEditor ? configEditor.getValue() : null;
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
  updateConfigSummary();
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
  updateConfigSummary();
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
  updateConfigSummary();
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
})();