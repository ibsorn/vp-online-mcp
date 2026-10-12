# Security

## How the server touches your machine and your account

- It starts a **dedicated Chrome** with its own profile (`~/.vp-online-mcp/chrome-profile`)
  and the Chrome DevTools Protocol enabled on `127.0.0.1:9333`. Your VP Online login lives
  in that profile. Your everyday Chrome profile is never read.
- The DevTools port only listens on the loopback interface, but **any program running as
  your user can connect to it** and control that browser (and therefore your VP session)
  while it is open. Close the MCP Chrome window when you are not using it, or choose
  another port with `VP_MCP_PORT`.
- `vp_eval` runs arbitrary JavaScript inside the VP editor tab, with your VP session.
  MCP clients ask for confirmation before tool calls by default; keep it that way for
  `vp_eval` if you work with untrusted prompts or documents.
- The server never sends data anywhere except to `online.visual-paradigm.com` through
  the browser. It stores only the last workspace id in `~/.vp-online-mcp/state.json`.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/ibsorn/vp-online-mcp/security/advisories/new)
instead of a public issue. You should get an answer within a week.
