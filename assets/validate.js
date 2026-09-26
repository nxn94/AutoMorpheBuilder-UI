// ─────────────────────────────────────────────────────────────────────────────
// Hand-rolled schema validator. Mirrors the rules in
//   AutoMorpheBuilder/schemas/config.schema.json
// and the cross-key semantic checks in
//   AutoMorpheBuilder/.github/scripts/validate-config.js
//
// Returns { valid: boolean, errors: [{path, message}] }.
// We avoid vendoring ajv (~250KB) by implementing only what the UI generates.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = '1.0';

// Regexes copied verbatim from schemas/config.schema.json
const RE_PKG_ID       = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const RE_SLUG         = /^[a-z0-9][a-z0-9-]*$/;
const RE_OWNER_REPO   = /^[^/\s]+\/[^/\s]+$/;
const RE_BRANCH       = /^[A-Za-z0-9._/-]+$/;
const RE_PIN_VERSION  = /^\d+(\.\d+)+$/;
const RE_PIN_TAG      = /^v?\d+(\.\d+)+([-.+][\w.-]+)?$/;
const RE_URI          = /^https?:\/\/\S+$/;

const ARCH_ENUM = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
const CLI_BRANCH_ENUM = ['main', 'dev'];

function err(errors, path, message) { errors.push({ path, message }); }

// Validate a single app entry. `path` is the dotted JSON path for error reporting.
export function validateApp(app, path, errors) {
  if (typeof app !== 'object' || app === null || Array.isArray(app)) {
    err(errors, path, 'must be an object');
    return;
  }
  const required = ['name', 'repo', 'branch', 'apkmirror_path'];
  for (const k of required) {
    if (!(k in app)) err(errors, `${path}.${k}`, 'required');
  }
  if ('name' in app && !RE_SLUG.test(String(app.name))) {
    err(errors, `${path}.name`, `must match ${RE_SLUG} (lowercase letters/digits/hyphens)`);
  }
  for (const k of ['repo', 'apkmirror_path']) {
    if (k in app && !RE_OWNER_REPO.test(String(app[k]))) {
      err(errors, `${path}.${k}`, `must be "owner/slug" with no whitespace`);
    }
  }
  if ('branch' in app && !RE_BRANCH.test(String(app.branch))) {
    err(errors, `${path}.branch`, `must match ${RE_BRANCH}`);
  }
  if ('pin_version' in app && app.pin_version != null) {
    if (!RE_PIN_VERSION.test(String(app.pin_version))) {
      err(errors, `${path}.pin_version`, `must match ${RE_PIN_VERSION} (e.g. "20.44.38")`);
    }
  }
  if ('pin_patch_tag' in app && app.pin_patch_tag != null) {
    if (!RE_PIN_TAG.test(String(app.pin_patch_tag))) {
      err(errors, `${path}.pin_patch_tag`, `must match ${RE_PIN_TAG} (e.g. "v1.18.3" or "v1.24.0-dev.8")`);
    }
  }
  if ('display_name' in app && app.display_name != null) {
    if (typeof app.display_name !== 'string' || app.display_name.length < 1) {
      err(errors, `${path}.display_name`, 'must be a non-empty string');
    }
  }
}

export function validateConfig(cfg) {
  const errors = [];
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    err(errors, '', 'config must be a JSON object');
    return { valid: false, errors };
  }

  if ('preferred_arch' in cfg && cfg.preferred_arch != null) {
    if (!ARCH_ENUM.includes(cfg.preferred_arch)) {
      err(errors, 'preferred_arch', `must be one of ${ARCH_ENUM.join(', ')}`);
    }
  }

  if ('auto_update_urls' in cfg && typeof cfg.auto_update_urls !== 'boolean') {
    err(errors, 'auto_update_urls', 'must be a boolean');
  }

  if (!('patch_repos' in cfg)) {
    err(errors, 'patch_repos', 'required');
  } else {
    const pr = cfg.patch_repos;
    if (typeof pr !== 'object' || pr === null || Array.isArray(pr)) {
      err(errors, 'patch_repos', 'must be an object');
    } else {
      const keys = Object.keys(pr);
      if (keys.length < 1) err(errors, 'patch_repos', 'must have at least one app');
      for (const pkgId of keys) {
        if (!RE_PKG_ID.test(pkgId)) {
          err(errors, `patch_repos.${pkgId}`, `key must be a valid Android package id matching ${RE_PKG_ID}`);
        }
        validateApp(pr[pkgId], `patch_repos.${pkgId}`, errors);
      }
    }
  }

  if (!('cli' in cfg)) {
    err(errors, 'cli', 'required');
  } else if (typeof cfg.cli !== 'object' || cfg.cli === null) {
    err(errors, 'cli', 'must be an object');
  } else {
    if (!('repo' in cfg.cli)) err(errors, 'cli.repo', 'required');
    else if (!RE_OWNER_REPO.test(String(cfg.cli.repo))) {
      err(errors, 'cli.repo', `must be "owner/repo" with no whitespace`);
    }
    if (!('branch' in cfg.cli)) err(errors, 'cli.branch', 'required');
    else if (!CLI_BRANCH_ENUM.includes(cfg.cli.branch)) {
      err(errors, 'cli.branch', `must be one of ${CLI_BRANCH_ENUM.join(', ')}`);
    }
  }

  if ('download_urls' in cfg && cfg.download_urls != null) {
    const du = cfg.download_urls;
    if (typeof du !== 'object' || du === null || Array.isArray(du)) {
      err(errors, 'download_urls', 'must be an object');
    } else {
      for (const pkgId of Object.keys(du)) {
        if (!RE_PKG_ID.test(pkgId)) {
          err(errors, `download_urls.${pkgId}`, `key must be a valid Android package id`);
          continue;
        }
        const versions = du[pkgId];
        if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) {
          err(errors, `download_urls.${pkgId}`, 'must be an object');
          continue;
        }
        for (const v of Object.keys(versions)) {
          if (!RE_URI.test(String(versions[v]))) {
            err(errors, `download_urls.${pkgId}.${v}`, 'must be an http(s) URL');
          }
        }
      }
    }
  }

  // Cross-key semantic checks (mirror validate-config.js)
  if (cfg.patch_repos && typeof cfg.patch_repos === 'object') {
    const seen = new Map(); // name -> pkgId
    for (const [pkgId, app] of Object.entries(cfg.patch_repos)) {
      if (app && typeof app === 'object' && typeof app.name === 'string') {
        if (seen.has(app.name)) {
          err(errors, `patch_repos.${pkgId}.name`,
              `duplicate release name "${app.name}" (already used by ${seen.get(app.name)}) — release tags would collide`);
        } else {
          seen.set(app.name, pkgId);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Validate patches.json shape: { repoSlug: { pkgId: { patchName: boolean } } }
export function validatePatches(p) {
  const errors = [];
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    err(errors, '', 'patches.json must be an object keyed by repo slug');
    return { valid: false, errors };
  }
  for (const repoSlug of Object.keys(p)) {
    if (!RE_OWNER_REPO.test(repoSlug)) {
      err(errors, repoSlug, `top-level key must be "owner/repo"`);
    }
    const apps = p[repoSlug];
    if (typeof apps !== 'object' || apps === null || Array.isArray(apps)) {
      err(errors, repoSlug, 'must be an object keyed by package id');
      continue;
    }
    for (const pkgId of Object.keys(apps)) {
      if (!RE_PKG_ID.test(pkgId)) {
        err(errors, `${repoSlug}.${pkgId}`, 'key must be a valid Android package id');
        continue;
      }
      const patches = apps[pkgId];
      if (typeof patches !== 'object' || patches === null || Array.isArray(patches)) {
        err(errors, `${repoSlug}.${pkgId}`, 'must be an object keyed by patch name');
        continue;
      }
      for (const patchName of Object.keys(patches)) {
        const v = patches[patchName];
        if (v !== true && v !== false) {
          err(errors, `${repoSlug}.${pkgId}.${patchName}`, `must be true or false (got ${JSON.stringify(v)})`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}