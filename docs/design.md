# AO3 Semantic Search via Personalized PageRank

## Algorithm & System Design

---

# Motivation

AO3’s folksonomy is expressive but inherently inconsistent. The same semantic concept may be represented by dozens of tag variants, while many authors deliberately under-tag their works. Traditional tag search therefore favors popular tags and heavily tagged works rather than the works most relevant to a user’s actual interests.

The goal of this project is to build a semantic recommendation engine that discovers works through their structural relationships rather than exact tag matches.

Rather than treating AO3 as a searchable database of tags, this system treats it as a graph and performs graph-based ranking using Personalized PageRank (PPR).

The primary design constraint is **minimizing requests to AO3**, not minimizing local computation. Modern desktop hardware can easily afford repeated graph computations, while AO3 aggressively rate-limits automated traffic.

---

# Core Insight

AO3 naturally forms a sparse heterogeneous graph.

Work  
  ↕  
Tags

(Optional)  
Author

Works sharing rare, semantically meaningful tags become strongly connected, while generic tags act as weak bridges between otherwise unrelated regions.

Instead of searching directly for tags, we perform a random walk beginning from user-selected seed works.

The resulting authority distribution naturally identifies:

* semantically related works

* synonymous or closely related tags

* high-quality under-tagged authors

* previously unknown semantic neighborhoods

Importantly, **relevance emerges from graph connectivity rather than exact textual similarity.**

---

# Graph Structure

## Node Types

### Work Nodes

Represent individual AO3 works.

### Tag Nodes

Represent every encountered AO3 tag, canonical or otherwise.

Canonicalization is intentionally avoided. The graph itself is responsible for discovering semantic equivalence.

### Author Nodes (Planned V2)

Authors connect all of their works together.

This allows authority to propagate from a well-tagged work to another work by the same author, solving many cases of systematic under-tagging.

---

## Edge Types

Work  ←→  Tag

(Optional)

Author ←→ Work

All edges are undirected for PageRank purposes.

The underlying graph remains **unweighted**.

---

# Authority Propagation

The graph itself is intentionally simple.

Instead of storing weighted edges, edge weighting is incorporated into the transition probabilities during the random walk.

For a work connected to multiple tags,

P(work → tag)

∝

1 / log(global\_tag\_frequency)

followed by normalization.

This has an important interpretation.

Popular tags create high-conductance bridges that allow probability mass to escape into unrelated regions of the graph.

By reducing transition probability through these hubs, the random walk remains concentrated inside semantically informative neighborhoods.

This is mathematically similar to TF-IDF but should be viewed as **reducing authority leakage through high-degree hubs**, rather than simply rewarding rare tags.

---

# Sparse Graph Construction

The extension never attempts to crawl AO3.

Instead, it incrementally materializes only the portion of the graph needed for the current search.

Every AO3 request should ideally reveal many new graph edges.

The objective is to maximize information gained per request.

---

# Cold Start

Users begin by selecting several known-good works.

Typically:

* 3–5 seed works

Initially only these pages are fetched.

Their tags provide an initial local graph.

Before global statistics are known, tag importance is estimated using local co-occurrence among the seed works.

Tags appearing repeatedly across seeds receive greater initial influence.

This provides a reasonable prior without requiring additional requests.

---

# Progressive Graph Expansion

The graph expands adaptively.

Each iteration performs:

1. Compute Personalized PageRank.

2. Rank unexplored frontier nodes.

3. Select the next node for expansion.

4. Fetch exactly one new AO3 page.

5. Merge newly discovered nodes and edges.

6. Recompute PPR.

Because network latency dominates runtime, PPR computation is performed aggressively after each graph update.

Computation is intentionally traded for fewer AO3 requests.

---

# Exploration Strategy

Initially, frontier selection is deterministic.

Once the graph stabilizes, expansion follows a beam-search strategy.

Maintain the top **K** unexplored frontier nodes.

Most expansions choose the highest-ranked frontier node.

Occasionally, an ε-greedy exploration step chooses a random frontier node.

For example,

95%

Highest-scoring frontier

5%

Random frontier

This prevents early overconfidence and allows discovery of nearby semantic neighborhoods that PPR initially undervalues.

---

# Implicit Negative Evidence

No explicit negative examples are required during normal search.

Instead, negative evidence emerges naturally.

Works unrelated to the seed set simply receive little authority because relatively few random walks reach them.

In other words,

semantic distance becomes probabilistic rather than binary.

---

# Explicit Negative Queries

Users may optionally specify tags or works they wish to avoid.

These act as authority sinks.

Conceptually,

Positive seeds

inject authority

Negative seeds

remove authority

The final ranking becomes the equilibrium between positive and negative influences.

This naturally supports queries such as

Time Travel without Major Character Death

without requiring manually curated incompatibility rules.

---

# Frequency Calibration

Tag frequencies are calibrated lazily.

When a tag page is visited,

its true AO3 work count replaces the local estimate.

No attempt is made to pre-fetch global statistics.

This ensures that every request contributes directly to graph expansion.

Future experimentation may combine

Global rarity

×

Local enrichment

to better identify niche semantic communities.

---

# Branch Evaluation

Instead of measuring entropy, graph expansion is evaluated by **information gain**.

Useful expansions are those that significantly alter the unexplored frontier.

Possible metrics include

* average score change among unseen nodes

* number of newly promoted frontier nodes

* total authority redistributed into previously unexplored regions

The objective is not maximizing entropy, but maximizing useful discovery.

---

# Natural Self-Pruning

Personalized PageRank already provides a strong inductive bias.

Because the walk continually restarts from the seed set,

authority naturally decays along long or weakly connected paths.

Consequently,

irrelevant branches simply receive negligible authority.

No explicit depth limit is required.

Poor exploration wastes requests but does not significantly corrupt rankings.

---

# Synonym Discovery

Tags with similar semantic meaning repeatedly connect to the same works.

Consequently they accumulate similar authority distributions.

Semantic equivalence therefore emerges naturally from graph topology rather than manually maintained synonym dictionaries.

This is particularly valuable for niche fandom terminology where canonical tag wrangling is incomplete.

---

# Future Graph Extensions

## Author Nodes

Authors become powerful semantic bridges.

Seed Work

↓

Author

↓

Other Works

This surfaces under-tagged works written by authors already identified as relevant.

---

## Bookmark Graph

Reader bookmark relationships could further connect semantically similar works.

Work

↓

Reader

↓

Work

This captures community behavior rather than author tagging.

The graph becomes substantially larger but addresses many remaining blind spots.

---

# Graph Layers

The implementation separates persistent data from ranking logic.

## Layer 1 — Raw Graph

Persistent crawl results.

Works

Tags

Authors

Edges

Never modified except by new graph construction.

---

## Layer 2 — Weighted Graph

Derived representation.

Responsible for computing transition probabilities and graph normalization.

Different weighting strategies can be evaluated without rebuilding the crawl database.

---

## Layer 3 — Query Graph

Temporary state.

Contains

* seed nodes

* negative seeds

* current authority vector

* frontier

* cached PageRank state

Destroyed after each search.

---

# Storage Representation

Graph algorithms operate entirely on compact integer node IDs.

String identifiers (AO3 URLs, tag names, author names) are interned into integer IDs.

Graph connectivity is stored in a sparse compressed representation (CSR):

Node IDs

↓

Offset Array

↓

Neighbor Array

This minimizes memory usage while enabling extremely efficient sparse matrix operations.

Since Personalized PageRank is fundamentally repeated sparse matrix-vector multiplication,

this representation aligns naturally with numerical linear algebra techniques.

---

# Browser Extension Architecture

## Background Service Worker

Responsible for

* request scheduling

* database updates

* persistence

* task routing

Contains no long-lived graph state.

---

## Content Scripts

Passively scrape only pages the user is actively viewing.

Every visited page incrementally enriches the graph.

Normal browsing therefore becomes passive graph construction.

---

## Offscreen Document

Receives computation requests from the background worker.

Coordinates heavy graph operations.

---

## Dedicated Web Worker

Executes Personalized PageRank.

Uses typed arrays and sparse graph structures for efficient computation.

---

# Request Scheduler

A single scheduler owns every AO3 request.

Responsibilities include

* rate limiting

* crawl queue

* retry logic

* expansion policy

No other component is permitted to fetch AO3 pages.

This guarantees compliance with request limits while preventing accidental aggressive crawling.

---

# Stopping Conditions

Graph expansion terminates when any of the following occur:

* request budget exhausted

* frontier authority falls below threshold

* authority distribution converges

* no unexplored high-information frontier nodes remain

The search therefore adapts naturally to both easy and difficult queries.

---

# Design Philosophy

The system is fundamentally **request-efficient rather than compute-efficient**.

CPU time is intentionally exchanged for fewer AO3 requests.

Every request should maximize newly discovered graph structure.

Rather than relying on manually curated ontologies or embedding models, semantic relationships emerge from the structure of AO3 itself.

The recommendation engine therefore improves organically as the local graph grows through normal browsing, gradually constructing a personalized semantic view of AO3 without requiring large-scale crawling or centralized indexing.