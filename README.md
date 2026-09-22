# Thru Track

A local-first desktop app for hikers to reconstruct and write up a trail day from GPS tracks, photos, and satellite messages. See `trail-journal-project-context.md` for the full project context and the PRD (issue #1) for scope.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Notes on Local Development

A few non-obvious gotchas encountered while working on this app — worth checking here before re-debugging them from scratch.

### Rebuilding `better-sqlite3` — use the Electron-targeted rebuild, not plain `npm rebuild`

`better-sqlite3` is a native module compiled against a specific Node ABI version. The app runs inside **Electron's** bundled Node, which is a different ABI than your system's `node` — so two different builds of the module are needed for two different purposes:

- **To run `vitest`** (plain Node, via the CLI): `npm rebuild better-sqlite3` targets your system Node. Use this if tests are failing with a `NODE_MODULE_VERSION` mismatch error.
- **To run the app** (`npm run dev`, or a packaged build): `npx electron-rebuild -f -w better-sqlite3` targets Electron's own Node version.

These two builds are **not interchangeable** — running `npm rebuild` to fix a failing test suite will silently break the Electron app's SQLite access the next time you launch it (and vice versa).

**Important: use `npx electron-rebuild -f -w better-sqlite3` (with `-f`/`--force`), not `npx electron-builder install-app-deps`, to switch back.** `install-app-deps` calls the same underlying `@electron/rebuild` tool, but that tool skips its own rebuild step if a stamp file it wrote last time (`node_modules/better-sqlite3/build/Release/.forge-meta`) already claims the right target — *without* checking whether the actual compiled binary still matches. If you've run a plain `npm rebuild` in between (which has no idea that stamp file exists, so never updates it), that stamp goes stale: `install-app-deps` reads it, believes nothing needs to change, and reports success while leaving the wrong binary in place. The `-f` flag skips that stamp check and always genuinely rebuilds.

To check which one is currently in place without launching the full app, load the module inside Electron's own runtime directly:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('better-sqlite3')(':memory:'); console.log('OK')"
```

### Testing a packaged build locally on macOS

For anything that needs a real packaged app rather than `npm run dev` — see "Local Network permission" below — the fastest path is an unpacked build (skips DMG creation):

```bash
npm run build:unpack
```

This produces `dist/mac/thru-track-scaffold-out.app`. Without a paid Apple Developer ID, `electron-builder` skips code signing entirely, and Electron's JIT won't run a fully unsigned app on modern macOS — ad-hoc sign it before launching:

```bash
codesign --force --deep --sign - --entitlements build/entitlements.mac.plist "dist/mac/thru-track-scaffold-out.app"
open "dist/mac/thru-track-scaffold-out.app"
```

Re-run both commands (rebuild, then re-sign) after any source change — this is a static build, not a live-reloading one.

### macOS Local Network permission (phone-upload / QR features)

The phone-to-desktop upload features (photos and GPX tracks) run a short-lived local HTTP server, which requires the OS-level "Local Network" permission (System Settings → Privacy & Security → Local Network). This permission is tied to the app's declared `NSLocalNetworkUsageDescription` (see `electron-builder.yml`'s `mac.extendInfo`) and a real code signature — **a raw `npm run dev` process often never triggers the permission prompt at all**, silently dropping incoming connections instead. Test these features against a packaged build (see above), not dev mode.

If a phone-upload session times out even against a packaged, permission-granted build, check whether a VPN client (Mullvad and similar privacy-focused VPNs are common culprits) is running with a strict local-network-blocking firewall/kill-switch — it can silently drop all LAN traffic, including this server's, independent of any of the app's own settings.
