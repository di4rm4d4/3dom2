# Contributing to 3DOM2

Small, focused pull requests are welcome. Describe the user-visible problem, the change and how you checked it. Run `npm test` before submitting; changes to the Worker should also pass `npm run check:deploy` after `npm ci`.

The local server and browser interface intentionally use plain JavaScript and native controls. Keep new dependencies and interface text proportionate to the problem.

## Research and map changes

- Use direct source links and retain both research dates and known observation dates.
- Distinguish equity ownership, publishing arrangements, management and appointment rights.
- Keep uncertainty visible. Do not infer editorial influence or independence from an ownership chain.
- Leave generated claims pending until a human has reviewed their evidence.
- Keep quotations short and preserve attribution. Do not include paywalled article bodies or private records.
- Preserve previous observations rather than silently presenting an old snapshot as current.

## Tests and development

Provider fixtures allow tests to run without credentials or paid searches. Never add a real API call to CI. A change affecting graph validity, browser-session isolation, review revisions or spending limits needs an appropriate regression check.

Do not commit `.env`, `.dev.vars`, account configuration, local `runtime/` data or downloaded credentials. See [SECURITY.md](SECURITY.md) for reporting security issues.
