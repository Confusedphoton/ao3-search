# AO3 Graph Search

A browser extension that discovers [Archive of Our Own](https://archiveofourown.org/) works through graph-based ranking instead of exact tag matching.

AO3’s folksonomy is expressive but inconsistent: the same concept can appear under many tag variants, and many works are under-tagged. This extension treats AO3 as a graph of works, tags, and authors, then ranks results from your seed selections using query propagation (relevance, authority, and precision) with expected-information frontier expansion.

The primary design constraint is **minimizing requests to AO3**, not minimizing local computation.

> **AO3 usage disclaimer:** This extension is designed to make as few requests to AO3 as possible. It is **not** a full web crawler and is not intended to scrape AO3 at scale. Search is deliberately sparse: it expands the graph one page at a time, targeting high-value nodes the way a human might browse, rather than bulk-fetching content. I make **no promises** about AO3’s position on whether they consider this a scraper or whether use of this extension complies with their Terms of Service. Use at your own discretion.

> **AI disclaimer:** AI tools were used to help write much of this codebase — it is essentially a tech demo, and I am a mathmetician not a front-end web developer. **No machine learning or AI is used** to perform searching, ranking, graph expansion, or any other runtime behavior in the deployed extension.

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

## Usage

1. Install or load the extension and browse AO3 normally — visited work, tag, and author pages are added to your local graph.
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
  graph/              CSR graph representation and types
  messaging/          Extension message protocol
  propagation/        Query propagation engine and signals
  scheduler/          Rate-limited AO3 fetch scheduler
  search/             Search orchestration and frontier selection
  storage/            IndexedDB, graph I/O, stats import, tag canonicalization
  ui/                 Shared theme styles
tests/                Vitest unit tests
docs/design.md        Algorithm and system design document
```

## Status

This project is **still in active development**. It is a working MVP: core search, graph persistence, stats import, and tag canonicalization are implemented, but APIs, behavior, and UI may change. See [overall_status.md](overall_status.md) for a detailed implementation checklist and known gaps.

## Privacy and security

**No telemetry or data collection.** This extension does not phone home, collect analytics, or transmit your data to any third-party service. There are no accounts, sign-ups, or external backends.

**Local storage only.** Your search graph, seeds, settings, and imported stats live entirely on your device (IndexedDB in the browser). Nothing is uploaded or synced anywhere. Local persistence exists only because the extension cannot function without caching the graph between sessions — it is a requirement of how search works, not a data-gathering choice.

**Minimal dependencies.** The shipped extension has no runtime npm dependencies. The build toolchain intentionally keeps third-party packages to a small set of dev-only tools (WXT, TypeScript, Vitest) to limit supply-chain exposure and reduce the surface area for known vulnerabilities in the JavaScript ecosystem.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
