# AutoMorpheBuilder UI

A static, no-build, no-server UI for configuring your fork of
[nxn94/AutoMorpheBuilder](https://github.com/nxn94/AutoMorpheBuilder). Loads,
validates, and lets you edit `patches.json` and `config.json` from the browser,
then downloads the changed files for you to commit back to your fork.

Hosted at <https://nxn94.github.io/AutoMorpheBuilder-UI/> via GitHub Pages.

## Why a separate repo?

This UI has a different audience, lifecycle, and dependency footprint than the
build pipeline it configures. Keeping them apart means:

- The build repo stays focused: contributors can PR pipeline fixes without
  dragging in a 500 KB JS bundle and a Node toolchain they don't need.
- The UI can iterate (themes, layouts, PR-back via API, etc.) on its own
  release cadence.
- A single UI can serve forks of *any* AutoMorpheBuilder repo, not just one.

## Stack

- Vanilla JS + ES modules. **No build step.**
- [JSONEditor 2.10.0](https://github.com/json-editor/json-editor) (vendored)
  for the schema-driven `config.json` editor.
- A 200-line custom editor for `patches.json` (3-level structure, wants
  checkboxes, not generic JSON).
- A 200-line hand-rolled validator that mirrors the rules in
  [`schemas/config.schema.json`](https://github.com/nxn94/AutoMorpheBuilder/blob/dev/schemas/config.schema.json)
  and the semantic checks in
  [`.github/scripts/validate-config.js`](https://github.com/nxn94/AutoMorpheBuilder/blob/dev/.github/scripts/validate-config.js).
  No ajv dependency — keeps the page under 600 KB total.

## Layout

```
.
├── index.html              # The single page
├── assets/
│   ├── app.css             # App styles
│   ├── app.js              # Main controller (ES module)
│   ├── patches-editor.js   # Custom editor for patches.json
│   ├── validate.js         # Hand-rolled schema validator
│   ├── json-editor.min.js  # Vendored: @json-editor/json-editor@2.10.0
│   ├── json-editor-base.css
│   └── json-editor-theme.css
└── .github/workflows/
    └── pages.yml           # Deploy to GitHub Pages on push to main
```

## Development

Just open `index.html` in a browser, or:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080/
```

The UI calls `raw.githubusercontent.com` to fetch samples, which works fine
from any origin — no CORS proxy needed.

## Updating vendored libraries

```bash
# json-editor (CSS theme + base)
npm pack @json-editor/json-editor@2.10.0
tar xzf json-editor-*.tgz package/dist/jsoneditor.min.js
tar xzf json-editor-*.tgz package/src/themes/barebones.css
tar xzf json-editor-*.tgz package/src/style.css
cp package/dist/jsoneditor.min.js   assets/json-editor.min.js
cp package/src/style.css            assets/json-editor-base.css
cp package/src/themes/barebones.css assets/json-editor-theme.css
```

(ajv is intentionally not vendored — the validator in `assets/validate.js` is
small and avoids ~250 KB of bundle.)

## Roadmap

- v1 (current): load, edit, download. Manual commit-back.
- v2: PR-back via GitHub Contents API (requires OAuth app + user-supplied PAT).
- v3: Live patches-list.json fetch from upstream — show only available patches.
- v4: Diff view against current file before download.

## License

MIT — same as the upstream `AutoMorpheBuilder` repo.