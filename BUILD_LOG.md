# BUILD_LOG — SABLE LINE (threejs-fps-02)

## Entry

- `main.ts` (Node 22, stdlib only): copies `game/` + `screenshots/` to
  `/output`, writes `dossier.json` via the kit's `buildDossier`.
- Game: three.js 0.187.0 (kit-vendored), static ES modules, no network.
- Wallet: `Cfdgeggmd6ij5dLpqwmqAaGExTbi4JPZJYcRdi4iSjSW`.

## What was built

- Map FOUNDRY (40 x 30 m): two bomb sites, three lanes, waypoint graph
  (25 nodes) for bot pathing, site plates, containers/crates as cover.
- 5v5 rounds: freeze + buy, 100 s clock, first to 5 (max 9 rounds).
  Elimination, plant/detonate, defuse and clock wins all implemented.
- Economy: $800 start, kill $300, plant $300, win $3,250, loss $1,900.
  Four weapons + kevlar in the buy menu.
- Bots: BFS pathing, line-of-sight, reaction times, burst fire,
  strafing, retreat at low HP, carrier plants, defenders defuse.
- HUD: health/armor, ammo, money, timer, score, pips, killfeed,
  hitmarker, damage arc, minimap, plant progress, banners.
- Synthesised WebAudio SFX (no assets). Deterministic `?shot=` modes
  (start/play/buy/end) with `window.__shotReady` for captures.

## Verification (2026-11-16 ~13:05 WIB, headless Chromium + swiftshader)

- `node --check` passes on all 10 game src files, `main.ts`, `serve.ts`.
- Screenshots: 4 real renders, 1280x720 JPEG q88, captured via
  `?shot=start|play|buy|end` with `window.__shotReady` (no timeouts):
  1-start.jpg 37,059 B (title + controls, map behind),
  2-play.jpg 43,936 B (live firefight: target bot at crosshair, muzzle
  flash + tracer, killfeed, minimap, HUD),
  3-buy.jpg 53,709 B (buy menu: 4 weapons + kevlar, $3,850),
  4-end.jpg 53,848 B (ROUND WON banner, two fallen VULTURE bots on site A).
  All ≤256 KiB, long side 1280, short side 720. Only console error in
  the capture run is a favicon 404.
- `MAKEFUN_OUTPUT_DIR=out node main.ts` (exit 0): dossier.json
  345,746 B (schema makefun/dossier/v1, cover 0, 4 images, game text
  90,941 B); game/ 14 files, 2,224,707 B; index.html 11,274 B.
  All within the gates (game ≤993 files / 48 MiB, dossier ≤1.5 MiB).
- Kit `check --worktree`: 4 passed (competition_open, snapshot,
  license_osi, entrypoint), 1 failed (transcripts_present — no bundle
  yet, parent step), 14 skipped, 5 checked at submission.
- Bugs found and fixed during verification:
  - `three.module.min.js` imports `./three.core.min.js` — the core file
    was missing from game/vendor/three; copied from the kit starter.
  - Bot bodies never rendered and player raycast hits never landed:
    `buildBody` in bots.js added the health bar to the scene but never
    the body group (`scene.add(group)` missing). Fixed; the play shot
    now shows the target bot and the shot registers.
  - Shot staging: the buy menu stayed open in the play/end shots
    (closeBuy() now called in those branches); staged bots were
    teleported before the settle so they walked off-mark, and dead
    staged bots were never re-synced (step() skips them) — both fixed.
  - LICENSE gained its `SPDX-License-Identifier: MIT` line (kit check
    failure), and scene lighting was brightened (hemisphere 1.7, key
    2.9) so the map reads in screenshots.
- `out/` (local dossier build) removed after verification; entry is
  27 files, 2,478,359 B total.
