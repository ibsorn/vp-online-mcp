#!/usr/bin/env node
// vp-online MCP server: builds native Visual Paradigm Online diagrams with few, cheap calls.
// Design notes (token economy): 8 tools with distinct purposes, conventions stated once in
// `instructions`, short descriptions, compact text results with short #ids, actionable errors.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getContext } from './lib/browser.js';
import * as vp from './lib/vp.js';

const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const INSTRUCTIONS = `Builds native Visual Paradigm Online diagrams (real, editable VP model) in a dedicated Chrome where the user is logged in.
Flow: vp_open{type} -> vp_build (whole diagram, ONE call) -> vp_inspect -> vp_save{name}. Changes: vp_edit. Picture: vp_screenshot{path} (no image tokens).
- shape = palette id from vp_open/vp_shapes; vp_shapes{query} searches every VP shape.
- Refs: key, label or #id (from vp_inspect).
- Connector arrowhead is at "to" (Generalization from=subclass, Realization from=implementor, Include/Extend from=base). Aggregation/Composition diamond at "from". mult, roles = [from,to].
- rows: class row with "(" = operation, else attribute; ER "name type" with optional "PK "/"FK "; other shapes need rowAction.
- No x,y = auto-placed (inside parent; containers grow). Units px; a child's x,y are relative to its parent. Ports/pins/lanes need a parent.
- Sequence messages stack in order; y places one. label "" clears a default name.`;

const server = new McpServer({ name: 'vp-online', version: VERSION }, { instructions: INSTRUCTIONS });

// One browser, one editor: run tool calls one at a time, each with a time limit.
let queue = Promise.resolve();
const serial = (fn, ms) => {
  const run = queue.then(() => Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s; the work may be partially applied: check with vp_inspect`)), ms)),
  ]));
  queue = run.catch(() => {});
  return run;
};
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const tool = (name, config, fn, ms = 120000) => server.registerTool(name, config, async (args) => {
  try { return await serial(() => fn(args || {}), ms); }
  catch (e) { return { isError: true, ...text(`ERROR: ${String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').split('\n    at ')[0]}`) }; }
});
const inPage = (fn, arg) => vp.withEditor((page) => page.evaluate(fn, arg));

const Row = z.union([z.string(), z.object({ text: z.string(), action: z.string().optional(), set: z.record(z.string(), z.string()).optional() })]);
const Element = z.object({
  shape: z.string().describe('palette id'),
  label: z.string().optional(),
  key: z.string().optional().describe('name used by from/to/parent (default: label)'),
  x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(),
  parent: z.string().optional().describe('container key/label/#id'),
  rows: z.array(Row).optional().describe('compartment rows, e.g. "-id : String", "+login() : bool", "PK id int"'),
  rowAction: z.string().optional().describe('e.g. addTrigger'),
  style: z.string().optional().describe('mxGraph style, e.g. "fillColor=#fff;"'),
});
const Pair = z.array(z.string()).max(2);
const Connector = z.object({
  shape: z.string().describe('connector palette id'),
  from: z.string(), to: z.string(),
  label: z.string().optional(),
  mult: Pair.optional().describe('[from, to] e.g. ["1","0..*"]'),
  roles: Pair.optional(),
  y: z.number().optional().describe('sequence message height'),
  points: z.array(z.array(z.number())).optional().describe('waypoints [[x,y],...]'),
  key: z.string().optional(),
  style: z.string().optional(),
});
const LAYOUTS = ['grid', 'hierarchical', 'horizontal', 'organic', 'tree'];

tool('vp_open', {
  description: 'Open a new diagram (type) or an existing one (url). No args: describe the current one. Returns the palette ids.',
  inputSchema: {
    type: z.string().optional().describe('ClassDiagram, UseCaseDiagram, ActivityDiagram, SequenceDiagram, StateMachineDiagram, ComponentDiagram, DeploymentDiagram, PackageDiagram, ERDiagram, DataFlowDiagram, BusinessProcessDiagram, Flowchart, OrganizationChart, MindMapDiagram...'),
    url: z.string().optional().describe('VP Online diagram link'),
  },
  annotations: { destructiveHint: false },
}, async ({ type, url }) => {
  if (type && url) throw new Error('pass either type (new diagram) or url (existing), not both');
  if (type) await vp.newDiagram(type);
  else if (url) await vp.open(url);
  else {
    try { await vp.editor(); } catch (e) {
      const pages = (await getContext()).pages().map((p) => p.url()).filter((u) => u.startsWith('http'));
      return text(`${e.message}\nopen tabs: ${pages.join(' , ') || 'none'}`);
    }
  }
  const [head, palette, st] = await inPage(() => [window.__vpmcp.inspect({ limit: 1 }).split('\n')[0], window.__vpmcp.palette(), window.__vpmcp.status()]);
  const warn = st.signedIn ? '' : '\nNOT SIGNED IN to VP Online (session expired?): diagrams can be built but not saved. Ask the user to log in once in the MCP Chrome window, then vp_open again.';
  return text(`${head}${st.saved ? `\n${st.url}` : ''}${warn}\n${palette}`);
}, 150000);

tool('vp_shapes', {
  description: 'No query: palette ids of the current diagram. query: search the whole VP shape library; results become usable in vp_build.',
  inputSchema: { query: z.string().optional(), limit: z.number().optional().describe('default 40') },
  annotations: { readOnlyHint: true },
}, async ({ query, limit = 40 }) => vp.withEditor(async (page) => {
  if (!query) return text(await page.evaluate(() => window.__vpmcp.palette()));
  const results = (limit) => page.evaluate((limit) => {
    const items = window.__vpmcp.items().filter((x) => x.palette === 'search');
    const ids = [...new Set(items.map((x) => (x.id === x.title.replace(/\s/g, '') ? x.id : `${x.id}(${x.title})`) + (x.kind === 'shape' ? '' : `[${x.kind}]`)))];
    return ids.length ? `${ids.length > limit ? `${limit} of ${ids.length}` : ids.length} results: ${ids.slice(0, limit).join(', ')}` : '';
  }, limit);
  const before = await results(1e6);
  if (before && page.__vpmcpLastQuery === query) return text(await results(limit)); // already shown
  const input = page.locator('.geSidebarContainer input').first();
  await input.fill(query);
  await input.press('Enter');
  // wait for the result list to change (or settle) so a previous search is never reported
  let res = '', emptyPolls = 0, all = before;
  for (let i = 0; i < 40; i++) { // up to 10 s
    await page.waitForTimeout(250);
    all = await results(1e6);
    if (all === before) continue; // VP has not replaced the previous list yet
    if (all) { res = await results(limit); break; }
    if (++emptyPolls >= 14) break; // list cleared and still empty after 3.5 s: no match
  }
  page.__vpmcpLastQuery = query;
  return text(res || `no shapes match "${query}"; try a broader word`);
}));

tool('vp_build', {
  description: 'Create many elements and connectors in one call (preferred over vp_edit). Continues past per-item errors and reports them.',
  inputSchema: {
    elements: z.array(Element).optional(),
    connectors: z.array(Connector).optional(),
    layout: z.enum(LAYOUTS).optional().describe('auto-arrange afterwards'),
    columns: z.number().optional().describe('grid columns for auto-placed elements'),
    clear: z.boolean().optional().describe('delete everything first'),
  },
}, async (spec) => {
  if (!spec.elements?.length && !spec.connectors?.length && !spec.clear) throw new Error('nothing to build: pass elements and/or connectors');
  const r = await inPage((spec) => window.__vpmcp.build(spec), spec);
  const lines = [`created ${r.elements.length} elements, ${r.connectors.length} connectors${r.errors.length ? `, ${r.errors.length} errors` : ''}`];
  if (r.elements.length) lines.push(r.elements.join(' '));
  if (r.connectors.length) lines.push(`connectors ${r.connectors.join(' ')}`);
  if (r.errors.length) lines.push(...r.errors.map((e) => `ERROR ${e}`));
  return { ...text(lines.join('\n')), ...(r.errors.length && !r.elements.length && !r.connectors.length ? { isError: true } : {}) };
}, 300000);

tool('vp_edit', {
  description: 'Batch changes. ops: label{ref,text} move{ref,x,y} resize{ref,w,h} rows{ref,rows,rowAction?} removeRows{ref,match?} ends{ref,mult?,roles?} style{ref,style} delete{ref} add{<element>} connect{<connector>} layout{kind} fit{ref}.',
  inputSchema: {
    ops: z.array(z.object({
      op: z.enum(['label', 'move', 'resize', 'rows', 'removeRows', 'ends', 'style', 'delete', 'add', 'connect', 'layout', 'fit']),
      ref: z.string().optional().describe('key, label or #id'),
    }).passthrough()).min(1),
  },
}, async ({ ops }) => text(await inPage((ops) => window.__vpmcp.edit(ops), ops)), 300000);

tool('vp_inspect', {
  description: 'Compact listing: #id shape "label" @x,y wxh [rows]; connectors as #id shape from{mult} -> to{mult} "label".',
  inputSchema: {
    ref: z.string().optional().describe('only this element, its contents and its connectors'),
    filter: z.string().optional().describe('keep lines containing this text'),
    detail: z.enum(['full', 'brief']).optional().describe('brief: no geometry, row counts only'),
    limit: z.number().optional().describe('max lines, default 150'),
  },
  annotations: { readOnlyHint: true },
}, async (opts) => text(await inPage((o) => window.__vpmcp.inspect(o), opts)));

tool('vp_save', {
  description: 'Save to the VP cloud (needs login). Untitled: saved as name. Already saved: Ctrl+S, or a copy if name differs.',
  inputSchema: { name: z.string().optional() },
  annotations: { destructiveHint: false, idempotentHint: true },
}, async ({ name }) => {
  const st = await vp.withEditor((page) => vp.save(page, name));
  return text(`saved "${st.title}"\n${st.url}`);
});

tool('vp_screenshot', {
  description: 'Image of the diagram cropped to its content. path: write PNG/JPG there and return only the path (cheap).',
  inputSchema: {
    path: z.string().optional(),
    ref: z.string().optional().describe('capture only this element'),
    scale: z.number().min(0.1).max(2).optional().describe('max zoom, default 1'),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ path, ref, scale }) => {
  const data = await vp.withEditor((page) => vp.screenshot(page, { file: path, ref, scale }));
  return path ? text(`saved ${path}`) : { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
});

tool('vp_eval', {
  description: 'Escape hatch: async JS body run in the editor page with `api` (api.g = mxGraph, api.resolve(ref), api.inspect()). Return a small value.',
  inputSchema: { code: z.string() },
}, async ({ code }) => {
  const r = await inPage(async (code) => {
    const fn = new Function('api', `return (async () => { ${code} })();`);
    const v = await fn(window.__vpmcp);
    return v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v);
  }, code);
  return text(r.length > 20000 ? `${r.slice(0, 20000)}… (${r.length} chars, truncated: return less)` : r);
});

const handlers = server.server._requestHandlers;
const listTools = handlers && handlers.get('tools/list');
if (listTools) {
  handlers.set('tools/list', async (...a) => {
    const r = await listTools(...a);
    for (const t of r.tools) {
      delete t.inputSchema?.$schema;
      if (t.execution?.taskSupport === 'forbidden') delete t.execution;
    }
    return r;
  });
}

await server.connect(new StdioServerTransport());
