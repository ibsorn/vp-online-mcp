// Offline checks (no browser, no VP account): safe for CI.
//   node test/smoke.js
// - the server starts over stdio and lists the 8 tools with instructions and annotations
// - tool definitions stay lean (no $schema, within the token budget)
// - every example is well formed: known keys, unique keys, from/to/parent resolve
// - package.json, server.json and the server agree on name and version
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
let pass = 0; const failures = [];
const check = (cond, msg) => { if (cond) pass++; else { failures.push(msg); console.log(`✗ ${msg}`); } };

// ── server over stdio ──
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'server.js')] }));
const pkg = read('package.json');
const info = client.getServerVersion();
check(info?.name === 'vp-online' && info?.version === pkg.version, `server reports vp-online ${pkg.version} (got ${info?.name} ${info?.version})`);
const instr = client.getInstructions() || '';
check(/vp_open/.test(instr) && /arrowhead is at "to"/.test(instr), 'server instructions present');
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const EXPECTED = ['vp_build', 'vp_edit', 'vp_eval', 'vp_inspect', 'vp_open', 'vp_save', 'vp_screenshot', 'vp_shapes'];
check(JSON.stringify(names) === JSON.stringify(EXPECTED), `tools are ${EXPECTED.join(', ')} (got ${names.join(', ')})`);
for (const t of tools) {
  check(t.description && t.description.length <= 300, `${t.name}: short description`);
  check(t.inputSchema?.type === 'object' && !('$schema' in t.inputSchema), `${t.name}: lean input schema`);
}
const ro = Object.fromEntries(tools.map((t) => [t.name, !!t.annotations?.readOnlyHint]));
check(ro.vp_inspect && ro.vp_shapes && ro.vp_screenshot && !ro.vp_build && !ro.vp_edit && !ro.vp_eval, 'readOnlyHint only on read-only tools');
const size = tools.reduce((n, t) => n + JSON.stringify(t).length, 0) + instr.length;
check(size / 3.8 < 1800, `tool definitions + instructions under 1800 tokens (~${Math.round(size / 3.8)})`);
// validation errors come back as tool errors, without touching the browser
const bad = await client.callTool({ name: 'vp_edit', arguments: { ops: [{ op: 'explode' }] } });
check(bad.isError, 'schema rejects an unknown vp_edit op');
const both = await client.callTool({ name: 'vp_open', arguments: { type: 'ClassDiagram', url: 'https://online.visual-paradigm.com/x' } });
check(both.isError && /either type/.test(both.content[0].text), 'vp_open rejects type + url together');
await client.close();

// ── examples ──
const ELEMENT_KEYS = new Set(['shape', 'label', 'key', 'x', 'y', 'w', 'h', 'parent', 'rows', 'rowAction', 'style']);
const CONNECTOR_KEYS = new Set(['shape', 'from', 'to', 'label', 'mult', 'roles', 'y', 'points', 'key', 'style']);
const files = fs.readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json'));
check(files.length === 14, `14 examples (got ${files.length})`);
for (const f of files) {
  const ex = read(`examples/${f}`);
  check(typeof ex.type === 'string' && /Diagram$|^Flowchart$|^OrganizationChart$/.test(ex.type), `${f}: has a diagram type`);
  const els = ex.elements || [], cons = ex.connectors || [];
  const badKeys = [...els.flatMap((e) => Object.keys(e).filter((k) => !ELEMENT_KEYS.has(k))),
    ...cons.flatMap((c) => Object.keys(c).filter((k) => !CONNECTOR_KEYS.has(k)))];
  check(!badKeys.length, `${f}: only known fields (unknown: ${badKeys.join(', ')})`);
  check([...els, ...cons].every((x) => typeof x.shape === 'string' && x.shape), `${f}: every item has a shape`);
  const keys = els.filter((e) => e.key).map((e) => e.key);
  check(new Set(keys).size === keys.length, `${f}: keys are unique`);
  const refs = new Set([...keys, ...els.filter((e) => !e.key && e.label).map((e) => e.label)]);
  const dangling = [...els.filter((e) => e.parent && !refs.has(e.parent)).map((e) => e.parent),
    ...cons.flatMap((c) => [c.from, c.to]).filter((r) => !refs.has(r))];
  check(!dangling.length, `${f}: every parent/from/to resolves (missing: ${dangling.join(', ')})`);
}

// ── registry metadata ──
const srv = read('server.json');
check(srv.name === pkg.mcpName, 'server.json name = package.json mcpName');
check(srv.version === pkg.version && srv.packages?.[0]?.version === pkg.version, 'server.json versions = package.json version');
check(srv.packages?.[0]?.identifier === pkg.name, 'server.json package identifier = package name');

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
