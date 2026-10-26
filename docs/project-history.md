# Development history

3DOM2 is the ownership mapping project also called **Press Trace** and **Who owns your news?** in its source. It is distinct from the broader 3DOM news aggregation and country-perspective work.

## September 2026: from a first node to a research prototype

The earliest local experiment was a handwritten HTML/CSS/JavaScript page that loaded a Polska Press JSON file and drew one SVG node. The application grew into publication search, bounded ownership-chain research, graph rendering, click-through evidence, review controls and persistent JSON snapshots.

The interface was then simplified around one question, a search form and a map. Sources and review details stayed available inside expandable sections.

The first retained application commit, `612d645`, records the local prototype on 17 September. Subsequent commits added clearer API-response errors (`d27154b`) and the Cloudflare backend with persistent research limits (`6dd5cea`).

## 18 September 2026: prepared collection

Commit `64ae57f` added 20 saved maps while live research was paused for funding. The collection contains 112 entity appearances, 131 proposed connections and 86 distinct source URLs. Its maps were researched on 17–18 September. All relationships remain pending human review.

Serving snapshots directly allowed readers to explore without triggering paid searches. Aliases and shareable map links made the collection accessible through the minimal interface.

## 6 October 2026: hosted research enabled

Commit `397764e04626e0e076b925511ed04f34adfe8a63` enabled the funded hosted path. The project record reports a completed ProPublica search through the live site and 21 passing automated tests. That is historical execution evidence, not an accuracy benchmark or a measure of adoption.

## 26 October 2026: open-source release

This release starts from the tracked application at `397764e`, with fresh public history. It adds the MIT licence, contributor documentation, architecture notes, an environment template and test-only CI. It removes the original Cloudflare account and domain bindings and disables new research in the public copy's defaults. The original private repository and deployment are preserved.

The original four-file learning prototype and private conversation transcripts are not copied into the application release. Credentials, personal runtime maps, browser sessions and private Git history are excluded.
