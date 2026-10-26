# Open-source release validation

Recorded 26 October 2026, starting from source revision `397764e04626e0e076b925511ed04f34adfe8a63`.

## Automated checks

- `npm test`: all **21 tests pass** on Node.js 22.13.1.
- Worker deployment dry run: **passes** with Wrangler 4.134.0, matching the pinned version. No deployment or paid research request was made.
- Prepared collection: 20 maps, 112 entity appearances, 131 pending connections and 86 distinct evidence URLs; research dates remain 17–18 September 2026.
- Local HTTP smoke check: homepage and all 20 map files return correctly; private source, environment and runtime paths return 404. Unknown API routes return JSON errors.
- Test-only provider configuration: unavailable, ensuring verification cannot start a paid research job.

The suite covers graph normalization, invalid references, depth, cycles, percentages, public URLs, malformed API responses, saved-map aliases, session isolation, review revisions, cache reuse, concurrent jobs, persistent quotas, cancellation, timeouts and uncertain provider responses. Provider responses are mocked.

## Browser checks

The local public copy was opened in the browser. Searching for Polska Press loaded the prepared graph. Selecting its ownership connection showed the unreviewed status and observation date; expanding its sources showed source links and excerpts, including a retrieval warning where recorded. The application preview in `docs/3dom2-preview.jpg` was captured from that run.

## Release defaults

New research is disabled in `public/data/catalog.json` and the Worker configuration. The original Cloudflare account and custom-domain bindings are removed. The public Git history begins with this release and includes no credentials, private conversations or runtime maps. The workflow runs checks without deploying the original site.

## Limits of these checks

These checks establish application behavior and buildability. They do not validate ownership claims, source completeness, editorial independence or current live-site availability. No paid research was rerun for this release. Historical live research records are retained separately in [validation-history.md](docs/validation-history.md).
