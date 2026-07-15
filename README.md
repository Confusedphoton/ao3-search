# AO3 Graph Search

A browser extension that discovers [Archive of Our Own](https://archiveofourown.org/) works through graph-based ranking instead of exact tag matching.

AO3’s folksonomy is expressive but inconsistent: the same concept can appear under many tag variants, and many works are under-tagged. This extension treats AO3 as a graph of works, tags, and authors, then ranks results from your seed selections using query propagation (relevance, authority, and precision) with expected-information frontier expansion.

The primary design constraint is **minimizing requests to AO3**, not minimizing local computation.

> **AO3 usage disclaimer:** This extension is designed to make as few requests to AO3 as possible. It is **not** a full web crawler and is not intended to scrape AO3 at scale. Search is deliberately sparse: it expands the graph one page at a time, targeting high-value nodes the way a human might browse, rather than bulk-fetching content. I make **no promises** about AO3’s position on whether they consider this a scraper or whether use of this extension complies with their Terms of Service. Use at your own discretion.

> **AI disclaimer:** AI tools were used to help write much of this codebase — it is essentially a tech demo, and I am a mathematician not a front-end web developer. **No machine learning or AI is used** to perform searching, ranking, graph expansion, or any other runtime behavior in the deployed extension.

## Features

- **Seed-based search** — Start from works, tags, or authors you already like (or want to avoid).
- **Incremental graph building** — The graph grows from pages you visit and from targeted fetches during search; there is no bulk crawl.
- **Multi-signal ranking** — Works are ranked by query relevance; unexplored nodes are expanded by expected information gain.
- **Negative seeds** — Exclude works, tags, or authors from results (e.g. “this trope, but not that one”).
- **Passive ingestion** — A content script scrapes AO3 pages you browse and offers on-page “Add as seed” / “Avoid” buttons.
- **Graph persistence** — Your graph is stored locally in IndexedDB and can be exported/imported as JSON.
- **Stats dump import** — Optionally import AO3’s official tag stats CSV on the options page to calibrate tag frequencies and merge canonical tag aliases.
- **Chrome and Firefox** — Built with [WXT](https://wxt.dev/) for Manifest V3 on both browsers.

## How it works

1. You pick one or more positive seeds (and optionally negative seeds) in the popup or from AO3 pages.
2. The extension fetches seed pages, builds a sparse work–tag–author graph, and runs query propagation in a Web Worker.
3. It ranks unexplored nodes by expected information, fetches one high-value page per iteration (rate-limited), merges new nodes/edges, and repeats.
4. Search stops when the expansion budget is exhausted, the frontier is empty, or remaining frontier nodes fall below an information threshold.
5. Results are works ranked by relevance to your seeds.

For algorithm and system design details, see [docs/design.md](docs/design.md).

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm

### Setup

```bash
git clone <repository-url>
cd ao3-search
npm install
```

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server and load unpacked extension in Chrome |
| `npm run dev:firefox` | Same for Firefox |
| `npm run build` | Production build for Chrome |
| `npm run build:firefox` | Production build for Firefox |
| `npm run zip` | Package Chrome extension as `.zip` |
| `npm run zip:firefox` | Package Firefox extension as `.zip` |
| `npm run test` | Run Vitest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run compile` | Type-check with `tsc --noEmit` |

### Loading the extension locally

**Chrome:** Run `npm run dev`, then open `chrome://extensions`, enable Developer mode, and load the unpacked extension from `.output/chrome-mv3`.

**Firefox:** Run `npm run dev:firefox`, then open `about:debugging#/runtime/this-firefox` and load temporary add-on from `.output/firefox-mv3/manifest.json`.

## Installation

**Firefox:** Install from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ao3-search-plus/).

For local development builds, see [Loading the extension locally](#loading-the-extension-locally).

## Usage

1. Install the extension (see [Installation](#installation)) and browse AO3 normally — visited work, tag, and author pages are added to your local graph.
2. Open the extension popup:
   - Add **positive seeds** (works/tags/authors you want more of).
   - Optionally add **negative seeds** to steer results away from specific nodes.
   - Start a search and watch progress as the extension expands the graph.
3. Open the **options page** to import an AO3 stats dump (`tags-YYYYMMDD.csv`) for better tag calibration and canonical merges.
4. Use **export/import** in the popup to back up or transfer your graph between browsers or machines.

Search uses a small per-run request budget (default: 20 expansions) and respects AO3 rate limits (~2.5s between requests with jitter).

## Project structure

```
entrypoints/          Extension entry points (background, popup, options, content script)
src/
  ao3/                AO3 page parsers and URL helpers
  compute/            Web Worker host for propagation
  config/             Constants, settings, AO3 metadata enums
  graph/              CSR graph representation and types
  messaging/          Extension message protocol
  propagation/        Query propagation engine and signals
  scheduler/          Rate-limited AO3 fetch scheduler
  search/             Search orchestration, frontier, topology policy
  storage/            IndexedDB, graph I/O, stats import, tag canonicalization
  ui/                 Shared theme styles
tests/                Vitest unit tests
evals/                Synthetic-graph ranking evals (`npm run eval:synthetic-graph`)
docs/design.md        Algorithm and system design document
docs/overall_status.md  Implementation checklist vs design
```

## Status

This project is **still in active development**. It is a working MVP: core search, graph persistence, stats import, and tag canonicalization are implemented, but APIs, behavior, and UI may change. See [docs/overall_status.md](docs/overall_status.md) for a detailed implementation checklist and known gaps.

## Roadmap

This is where the project is headed—not a promise of dates or order, but the loose ends I know about plus directions I want to explore.

### Known loose ends

These are gaps between the current MVP and [docs/design.md](docs/design.md); see [docs/overall_status.md](docs/overall_status.md) for the full checklist.

- **Search loop** — beam search with a maintained top-K frontier; post-expansion branch evaluation (score change, newly promoted nodes, authority redistribution); convergence-based early stopping when relevance stabilizes across iterations.
- **Exploration** — tag/author listing pagination with `partial`/`complete` status and stale rechecks; `/works/search` is request-handler-ready but unused by the default policy; passive browsing enrichment is skipped while a search is running.
- **Query layer** — each expansion rebuilds CSR and reruns the full propagation pipeline; no persistent query-graph object or cached propagation state between iterations.
- **Negative seeds** — live ranking uses dual-PPR contrast (`r⁺ − λ r⁻`); `signedQuery` / signed-edge graph build still exists but is unused. Decide: delete the signed path or re-adopt it; keep docs/tests aligned either way.
- **Graph extensions** — bookmark graph (reader → work edges) is design-only so far.
- **Compute routing** — propagation runs in a Web Worker spawned from the service worker; the offscreen-document coordinator from the design doc is not used. Unused worker entry (`runPropagationViaWorker` / signals mode) and deprecated request-handler helpers (`fetchWork` / `expandNode`) should be cleaned up or wired.
- **Design doc drift** — `docs/design.md` still frames PPR-only search, lists authors as future work, and says canonicalization is avoided. Missing from the spec: topological fragility policy, dual-PPR negatives + λ, stats dump / tag canonicalization, permeability filters, suppress-from-results, selectable expansion policy.
- **Settings gaps** — `EXPANSION_BUDGET` is hardcoded (default 20) and not exposed in options; other knobs (top results, seeds, λ, policy, permeability) are tunable.
- **Polish & UX** — no UI for surfacing synonym/tag-equivalence clusters (merges come from the stats dump only); document permeability filters and suppress-from-results as product behavior.
- **Evals** — `evals/synthetic-graph/` and `npm run eval:synthetic-graph` exist but are not part of the documented workflow.
- **Weighting experiments** — explicit cold-start co-occurrence priors; global rarity × local enrichment for niche communities.

### Compute backend (WASM)

Rewrite the compute backend (`src/compute/`, `src/propagation/`) so heavy graph work runs in WebAssembly instead of the current TypeScript Web Worker. Goal: faster sparse propagation on large local graphs without changing the extension’s request-minimization philosophy.

### Firefox for Android

Desktop Firefox is supported today; **Firefox for Android is not tested or targeted yet**, but the project is a plausible fit later. The Firefox build already uses background scripts (not a service worker), which is the MV3 pattern Android expects, and the extension avoids desktop-only APIs (context menus, sidebar, keyboard commands, etc.).

Before calling it supported, it needs real-device validation. Known risks to work through:

- **MV3 on Fenix** — content-script injection and host-permission UX are less mature on Android than desktop.
- **Background lifecycle** — Android may suspend the extension during a multi-minute search (rate-limited fetches + propagation).
- **AO3 mobile DOM** — parsers and selectors assume desktop page markup; mobile AO3 layouts may need separate handling.
- **Mobile UX** — popup is a fixed 360px panel; on Android it opens as a fullscreen overlay. Export/import and stats CSV upload need a phone-friendly pass.

### Everything else

I’ll add things here as I think of new features or run across ideas I find cool—this roadmap isn’t exhaustive and priorities will shift.

## Privacy and security

**No telemetry or data collection.** This extension does not phone home, collect analytics, or transmit your data to any third-party service. There are no accounts, sign-ups, or external backends.

**Local storage only.** Your search graph, seeds, settings, and imported stats live entirely on your device (IndexedDB in the browser). Nothing is uploaded or synced anywhere. Local persistence exists only because the extension cannot function without caching the graph between sessions — it is a requirement of how search works, not a data-gathering choice.

**Minimal dependencies.** The shipped extension has no runtime npm dependencies. The build toolchain intentionally keeps third-party packages to a small set of dev-only tools (WXT, TypeScript, Vitest) to limit supply-chain exposure and reduce the surface area for known vulnerabilities in the JavaScript ecosystem.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
