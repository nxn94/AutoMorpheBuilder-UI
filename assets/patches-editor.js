// ─────────────────────────────────────────────────────────────────────────────
// Custom editor for patches.json
//
// Shape: { "owner/repo": { "com.pkg.id": { "Patch name": true|false } } }
//
// Renders one collapsible card per (repo, app). The card shows checkboxes for
// every patch with a search filter, "all on / all off" buttons, an "add patch"
// input, and a "remove patch" button per row.
//
// We render this ourselves (instead of using json-editor) because the structure
// is 3-deep and the per-patch rows want checkboxes, not free-form input.
// ─────────────────────────────────────────────────────────────────────────────

import { validatePatches } from './validate.js';

export class PatchesEditor {
  constructor(rootEl, warningsEl, options = {}) {
    this.root = rootEl;
    this.warnings = warningsEl;
    this.data = {}; // { repo: { pkg: { patch: bool } } }
    this.originalJson = null; // for diff summary
    this.onChange = options.onChange || (() => {});
    this._lastValidation = { valid: true, errors: [] };
    this.render();
  }

  setData(data, originalJson = null) {
    // Deep clone so mutations from the UI don't affect the caller's object
    this.data = JSON.parse(JSON.stringify(data || {}));
    this.originalJson = originalJson !== null ? originalJson : JSON.stringify(data, null, 2) + '\n';
    this.render();
    this._validate();
  }

  getData() {
    return JSON.parse(JSON.stringify(this.data));
  }

  getJson(indent = 2) {
    // Stable key ordering: match upstream repo order, then app, then patch name
    return JSON.stringify(this.data, Object.keys(this.data).sort ? this._stableReplacer : null, indent) + '\n';
  }

  _stableReplacer(key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  }

  // Returns { added, removed, changed } compared against originalJson (if loaded).
  diffSummary() {
    if (this.originalJson == null) return null;
    let orig;
    try { orig = JSON.parse(this.originalJson); } catch { return null; }
    let added = 0, removed = 0, changed = 0;
    const seenKeys = new Set();
    for (const repo of Object.keys(this.data)) {
      for (const pkg of Object.keys(this.data[repo] || {})) {
        for (const patch of Object.keys(this.data[repo][pkg] || {})) {
          const k = `${repo}\u0000${pkg}\u0000${patch}`;
          seenKeys.add(k);
          if (!(repo in orig) || !(pkg in (orig[repo] || {})) || !(patch in (orig[repo]?.[pkg] || {}))) {
            added++;
          } else if (orig[repo][pkg][patch] !== this.data[repo][pkg][patch]) {
            changed++;
          }
        }
      }
    }
    for (const repo of Object.keys(orig)) {
      for (const pkg of Object.keys(orig[repo] || {})) {
        for (const patch of Object.keys(orig[repo][pkg] || {})) {
          const k = `${repo}\u0000${pkg}\u0000${patch}`;
          if (!seenKeys.has(k)) removed++;
        }
      }
    }
    return { added, removed, changed };
  }

  render() {
    this.root.innerHTML = '';
    const repos = Object.keys(this.data);
    if (repos.length === 0) {
      this.root.innerHTML = '<p class="muted">No apps configured. Load a file or sample to begin.</p>';
      return;
    }
    repos.sort();
    for (const repo of repos) {
      const apps = this.data[repo] || {};
      const appPkgs = Object.keys(apps).sort();
      for (const pkg of appPkgs) {
        this.root.appendChild(this._renderApp(repo, pkg, apps[pkg] || {}));
      }
    }
    // Add-app card at the end
    this.root.appendChild(this._renderAddApp());
  }

  _renderApp(repo, pkg, patches) {
    const card = document.createElement('div');
    card.className = 'patches-app';
    card.dataset.repo = repo;
    card.dataset.pkg = pkg;

    const total = Object.keys(patches).length;
    const offCount = Object.values(patches).filter(v => v === false).length;

    // ── head ──
    const head = document.createElement('div');
    head.className = 'patches-app-head';
    head.innerHTML = `
      <span class="chevron">▼</span>
      <div style="flex:1; min-width:0;">
        <div class="title">${escapeHtml(displayAppName(repo, pkg))}</div>
        <div class="subtitle">${escapeHtml(pkg)} · ${escapeHtml(repo)}</div>
      </div>
      <span class="counts">
        <span class="off">${offCount}</span> off / ${total} total
      </span>
    `;
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      card.classList.toggle('collapsed');
    });
    card.appendChild(head);

    // ── body ──
    const body = document.createElement('div');
    body.className = 'patches-app-body';

    // search + bulk
    const controls = document.createElement('div');
    controls.className = 'patches-controls';
    controls.innerHTML = `
      <input type="search" placeholder="Filter patches…" aria-label="Filter patches" />
      <button class="btn" data-action="all-on">Enable all</button>
      <button class="btn" data-action="all-off">Disable all</button>
    `;
    body.appendChild(controls);

    const grid = document.createElement('div');
    grid.className = 'patches-grid';
    const patchNames = Object.keys(patches).sort();
    const patchEls = new Map();
    for (const name of patchNames) {
      const id = `cb-${repo}-${pkg}-${cssId(name)}`;
      const label = document.createElement('label');
      label.dataset.name = name;
      label.innerHTML = `
        <input type="checkbox" id="${id}" ${patches[name] ? 'checked' : ''} />
        <span>${escapeHtml(name)}</span>
      `;
      const cb = label.querySelector('input');
      cb.addEventListener('change', () => {
        this.data[repo][pkg][name] = cb.checked;
        this._updateCounts(card, patches);
        this.onChange();
      });
      grid.appendChild(label);
      patchEls.set(name, label);
    }
    body.appendChild(grid);

    // Filter behaviour
    controls.querySelector('input[type=search]').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const [name, el] of patchEls) {
        el.style.display = (!q || name.toLowerCase().includes(q)) ? '' : 'none';
      }
    });

    // Bulk actions
    controls.querySelector('[data-action=all-on]').addEventListener('click', () => {
      for (const name of Object.keys(patches)) patches[name] = true;
      for (const [, el] of patchEls) {
        const cb = el.querySelector('input');
        if (cb) cb.checked = true;
      }
      this._updateCounts(card, patches);
      this.onChange();
    });
    controls.querySelector('[data-action=all-off]').addEventListener('click', () => {
      for (const name of Object.keys(patches)) patches[name] = false;
      for (const [, el] of patchEls) {
        const cb = el.querySelector('input');
        if (cb) cb.checked = false;
      }
      this._updateCounts(card, patches);
      this.onChange();
    });

    // Add / remove patches
    const actions = document.createElement('div');
    actions.className = 'patches-app-actions';
    actions.innerHTML = `
      <input type="text" placeholder="Add a patch (exact name as in upstream patches-list.json)…" />
      <button class="btn">+ Add patch</button>
      <button class="btn" data-action="remove-app">Remove app</button>
    `;
    const addInput = actions.querySelector('input');
    const addBtn = actions.querySelector('button:not([data-action])');
    const submit = (defValue = true) => {
      const name = addInput.value.trim();
      if (!name) return;
      if (name in patches) {
        flashInput(addInput, 'already exists');
        return;
      }
      patches[name] = defValue;
      this._renderGridInto(grid, patches, patchEls);
      this._updateCounts(card, patches);
      addInput.value = '';
      this.onChange();
    };
    addBtn.addEventListener('click', () => submit(true));
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(true);
    });
    actions.querySelector('[data-action=remove-app]').addEventListener('click', () => {
      if (!confirm(`Remove ${pkg} entirely? (You can re-add it later from upstream.)`)) return;
      delete this.data[repo][pkg];
      if (Object.keys(this.data[repo]).length === 0) delete this.data[repo];
      this.render();
      this.onChange();
    });

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  _renderGridInto(grid, patches, patchEls) {
    grid.innerHTML = '';
    patchEls.clear();
    for (const name of Object.keys(patches).sort()) {
      const id = `cb-${cssId(patches) || 'x'}-${cssId(name)}-${Math.random().toString(36).slice(2, 7)}`;
      const label = document.createElement('label');
      label.dataset.name = name;
      label.innerHTML = `
        <input type="checkbox" id="${id}" ${patches[name] ? 'checked' : ''} />
        <span>${escapeHtml(name)}</span>
      `;
      label.querySelector('input').addEventListener('change', (e) => {
        patches[name] = e.target.checked;
        this.onChange();
      });
      grid.appendChild(label);
      patchEls.set(name, label);
    }
  }

  _renderAddApp() {
    const card = document.createElement('div');
    card.className = 'patches-app';
    card.style.borderStyle = 'dashed';
    card.innerHTML = `
      <div class="patches-app-body" style="padding: 0.75rem;">
        <strong>Add an app to <code>patches.json</code></strong>
        <p class="muted small">Paste the <code>owner/repo</code> slug and the Android package id. Existing apps aren't overwritten.</p>
        <div class="patches-controls">
          <input type="text" placeholder="owner/repo (e.g. MorpheApp/morphe-patches)" id="new-repo" />
          <input type="text" placeholder="com.example.package" id="new-pkg" />
          <button class="btn primary" id="new-app-add">Add</button>
        </div>
      </div>
    `;
    card.querySelector('#new-app-add').addEventListener('click', () => {
      const repo = card.querySelector('#new-repo').value.trim();
      const pkg  = card.querySelector('#new-pkg').value.trim();
      if (!repo || !pkg) return;
      if (!this.data[repo]) this.data[repo] = {};
      if (!this.data[repo][pkg]) this.data[repo][pkg] = {};
      this.render();
      this.onChange();
    });
    return card;
  }

  _updateCounts(card, patches) {
    const total = Object.keys(patches).length;
    const offCount = Object.values(patches).filter(v => v === false).length;
    const counts = card.querySelector('.counts');
    counts.innerHTML = `<span class="off">${offCount}</span> off / ${total} total`;
  }

  _validate() {
    const result = validatePatches(this.data);
    this._lastValidation = result;
    this.warnings.innerHTML = '';
    if (!result.valid) {
      const box = document.createElement('div');
      box.className = 'alert error';
      box.innerHTML = `<strong>Invalid patches.json</strong><ul>` +
        result.errors.map(e => `<li><code>${escapeHtml(e.path)}</code>: ${escapeHtml(e.message)}</li>`).join('') +
        `</ul>`;
      this.warnings.appendChild(box);
    }
    return result;
  }

  validate() { return this._validate(); }
}

// ───── helpers ─────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function cssId(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}
function flashInput(input, msg) {
  const old = input.placeholder;
  input.placeholder = msg;
  input.style.borderColor = '#d4a72c';
  setTimeout(() => { input.placeholder = old; input.style.borderColor = ''; }, 1200);
}

// Try to find a display name from a sibling config.json (optional, but pretty)
function displayAppName(repo, pkg) {
  // The patches UI doesn't know about config.json by default. The caller can
  // pass a name-resolver via the constructor if it wants prettier labels.
  return pkg;
}

export function setDisplayNameResolver(editor, resolver) {
  // No-op stub: the patches UI is intentionally repo+pkg-only.
  // A future improvement could merge in display_name from config.json.
  void editor; void resolver;
}