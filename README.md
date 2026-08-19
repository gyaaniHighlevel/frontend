# frontend

Genesis — AI-powered HighLevel app builder (frontend). Vue 3 + TypeScript + Vite + Tailwind CSS v4 + shadcn-vue, per `genesis-lld.md`.

This phase is UI-plus-preview-runtime: all data is mocked in Pinia stores (`src/stores`); Firebase, the generation SSE client, and the HighLevel proxy wiring come later.

The workspace implements the LLD's fixed three-file contract (§1.2) and preview runtime (§9): the working tree is exactly `index.html` / `app.js` / `styles.css`, `src/lib/previewBuilder.ts#buildSrcdoc` wraps them in the platform-owned shell (CSP meta, Tailwind CDN, import map pinning `vue`, `[v-cloak]` + styles.css, `window.__GENESIS__`, inlined `src/assets/hl-sdk.js` shim), and the preview renders the result in an `<iframe sandbox="allow-scripts">` (opaque origin, INV-5). The shim is a mock build: `window.hl.*` resolves canned HighLevel data; the postMessage protocol (`genesis:ready`/`genesis:error`, §9.3–9.4) is real. Sending a chat prompt simulates a generation turn — the three files stream into the editor, then the preview does a full srcdoc reload (decision 6); Reload and Restore rebuild it the same way.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## Screens

| Route | Screen |
|---|---|
| `/signin`, `/signup` | Auth (mock; not part of the hi-fi mockups) |
| `/projects` | Projects dashboard — empty state (prompt hero) or populated grid, driven by store state; flask button bottom-right toggles demo data |
| `/p/:projectId` | Workspace — chat, code, preview panels |
| Workspace → History | Version history + diff, as a sheet over the workspace |

## Structure

- `src/pages` — file-based routes (unplugin-vue-router)
- `src/components/workspace` — ChatPanel, EditorPanel, PreviewPanel, SnapshotSheet, WorkspaceTopBar
- `src/components/dashboard`, `src/components/layout`, `src/components/ConnectHL.vue`
- `src/components/ui` — shadcn-vue primitives
- `src/stores` — auth, projects, workspace (mock data)
