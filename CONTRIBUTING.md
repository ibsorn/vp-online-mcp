# Contributing

Thanks for helping! Bug reports with a reproducible `vp_build` payload are the most useful
contribution: VP Online changes its internals from time to time, and a failing payload
pinpoints the problem quickly.

## Setup

```bash
git clone https://github.com/ibsorn/vp-online-mcp.git
cd vp-online-mcp
npm install
npm run check        # offline smoke test, no browser needed
```

The end-to-end suite needs Chrome and a VP Online account. The first run opens the
dedicated Chrome window: log in there once, then:

```bash
npm test             # full suite, ~2–5 min, nothing is saved
npm test -- class er # only some suites
npm run test:save    # also save/reopen tests (creates 2 diagrams in your VP cloud)
```

Screenshots of every diagram land in `test/out/`: look at them, the assertions cannot
catch everything visual.

## Where things live

| File | Role |
|---|---|
| `server.js` | MCP tools, schemas, server instructions, queue and timeouts |
| `lib/browser.js` | Dedicated Chrome over CDP |
| `lib/vp.js` | Tab lifecycle, injection, save, screenshots |
| `lib/page-api.js` | Code injected into the VP editor; does the real work |
| `examples/` | One example per diagram type; also the e2e test data |
| `scripts/eval.js` | Debug helper: `node scripts/eval.js -e "return window.__vpmcp.inspect()"` |
| `scripts/profile.js` | CPU-profiles a snippet in the editor and prints the hottest VP functions |

## Rules of thumb

- **Token budget.** Tool definitions are paid in every conversation. Keep descriptions to
  one line, put shared conventions in the server `instructions`, and run
  `npm run measure` before and after changing a schema.
- **Compact output.** Results are plain text with short `#id`s. Do not echo inputs back.
- **Actionable errors.** An error should say what to do next ("Did you mean…",
  "set parent", the list of `#id`s).
- **No minified names.** VP's code is minified and changes between releases. Discover
  methods by shape or by resource strings (see `rowMethods` in `lib/page-api.js`).
- **Tests.** Add an e2e assertion for every fix, and an example when you add support for
  a diagram type. `npm run check` and `npm test` must pass.

## Releasing

1. Bump `version` in `package.json` and both versions in `server.json`; update `CHANGELOG.md`.
2. `npm run check && npm run test:save`
3. Tag `vX.Y.Z` and push; publish to npm (`npm publish`) and to the MCP Registry
   (`mcp-publisher publish`).
