# Validation record

## Saved maps — 18 September 2026

The collection contains 20 maps: Polska Press, The Guardian, Reuters, Associated Press, BBC, Financial Times, The Economist, The New York Times, The Washington Post, The Wall Street Journal, CNN, Fox News, Le Monde, Le Figaro, Der Spiegel, El País, Gazeta Wyborcza, Nature, Science and The Lancet. Six dated snapshots from 17 September were reused; fourteen were researched on 18 September using the local Codex provider. This batch explicitly unset `OPENAI_API_KEY`; no API-credit research requests were made.

The files contain 112 entity appearances, 131 connections and 86 distinct evidence URLs. All relationships remain pending human review, with their original research/observation dates, sources and gaps retained. Automated citation retrieval is not factual verification. Source excerpts total no more than 25 quoted words per exact URL (ignoring fragments) across this collection.

Twenty-one automated tests pass. New checks cover all 20 saved graphs, unique identifiers, source links, pending review status, search aliases, unknown/ambiguous queries, and malformed catalog paths. The Wrangler deployment dry run passes with live research disabled. Browser checks cover saved-map search, shared-link reload, source details, unsupported searches, and desktop/390-pixel layouts. The literal funding notice is present. Published snapshots have no public review mutation controls; browsing the collection bypasses the research API entirely.

## Cloudflare backend and spending controls — 17 September 2026

The hosted adapter uses the OpenAI Responses API in background mode, with persistent SQLite Durable Object storage and alarms. Nineteen automated tests pass, including concurrent starts, limits surviving an object restart, limits across fresh browser sessions, cache hits, review revisions, missing configuration, CSRF/origin rejection, cancellation, timeout cancellation, uncertain start responses, and malformed API output. Provider responses in these tests are mocked; no paid AI calls were made.

Wrangler's deployment dry run passes. The actual local Cloudflare runtime returns JSON for status, saved maps and unknown API routes; a research attempt without a key returns 503 with the setup message. The public deployment still requires its `OPENAI_API_KEY` secret before a real hosted research run can be verified. Limits are 5 starts per UTC day site-wide, 2 per IP per UTC day, 20 lifetime starts, one active slot, 6,000 output tokens and 12 tool calls per request. An eight-minute deadline requests cancellation; provider failures may delay cancellation. The cloud adapter leaves citation checks marked `not_checked`; factual accuracy has not been established by these tests.

The records below describe the earlier local-only build.

Build checked on 17 September 2026 with Node.js 22.13.1 and the local Codex research provider.

## Minimal interface revision

The later simplification removes branding, navigation, type/depth menus, examples, status logs, map statistics, filter tabs, and footer copy. The question and search form lead directly to the map. Sources, review controls and research notes are collapsed inside click details.

Browser checks for this revision: search reopens Polska Press; node and connection details work; sources and review sections expand; a temporary rejection was reset to unreviewed; a new research run showed the compact loading state and cancelled successfully. Desktop (1280 × 800) and mobile (390 × 844) layouts were inspected. JavaScript syntax checks pass. Backend behavior and research data are unchanged; the original full-build checks below document the earlier interface where relevant.

## Live research

These were real web-research runs, not hardcoded example graphs. Their snapshots are stored locally in `runtime/maps/` and are excluded from this repository. All connections remain **unreviewed**; successful execution does not establish factual correctness.

| Search | Entities | Connections | Approximate research time |
| --- | ---: | ---: | --- |
| Polska Press | 6 | 7 | 2 minutes |
| Nature | 6 | 5 | 3 minutes |
| The Guardian | 5 | 11 | 3 minutes |

Each run returned cited sources, observation dates where available, and unresolved questions. Source checks distinguish reachable HTML, matching excerpts, reachable PDFs, and retrieval failures. PDF text is not independently extracted by the citation checker. Images from Wikimedia Commons render where available; other entities use initials.

## Functional checks

- New live search through the browser, progress updates and reconnection after page reload.
- Saved snapshots reopened through the UI and retained after server restart.
- Connection evidence drawer, approval persistence after reload, approved-path filter, and reset to unreviewed.
- SVG graph layout, zoom controls, and fit; desktop and a 390-pixel mobile viewport inspected.
- Circular imagery, publication labels and multiple distinct relationships between the same entities inspected in the browser.
- Cancellation stops a run without saving a map.
- Required frontend assets return 200; server code and runtime directories are not served as static files.
- Missing mutation token and foreign origin return 403; invalid search returns 400; stale review revision returns 409.
- Six automated tests pass: research cannot approve itself, evidence/reference filtering, graph depth, duplicate/parallel relationships, cycles/disconnected entities, invalid percentages and private-network URL rejection.

## Not established

- Coverage or accuracy across “most journals”: three samples are not a benchmark.
- Completeness of ultimate beneficial ownership, editorial independence, or every control relationship.
- The optional API-key provider: implemented but untested because no API key was configured.
- Multi-user use or public hosting: this build runs locally and uses the owner's existing Codex sign-in/account usage.
