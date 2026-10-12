// End-to-end suite: drives the real MCP server over stdio against VP Online and asserts on results.
//   node test/e2e.js            all suites except saving
//   node test/e2e.js --save     also save/reopen tests (creates diagrams in the VP cloud)
//   node test/e2e.js class er   only the named suites
// Screenshots of every diagram go to test/out/ for visual review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const SAVE = args.includes('--save');
const only = args.filter((a) => !a.startsWith('--'));

const client = new Client({ name: 'e2e', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'server.js')] }));

let pass = 0, fail = 0; const failures = [];
const call = async (name, a = {}) => {
  const t0 = Date.now();
  let r;
  try { r = await client.callTool({ name, arguments: a }, undefined, { timeout: 600000 }); }
  catch (e) { return { text: `PROTOCOL ERROR ${e.message}`, isError: true, ms: Date.now() - t0 }; }
  const text = r.content.map((c) => (c.type === 'text' ? c.text : `<${c.type}:${c.data.length}>`)).join('\n');
  return { text, isError: !!r.isError, ms: Date.now() - t0, content: r.content };
};
const check = (cond, msg, ctx = '') => {
  if (cond) { pass++; return; }
  fail++; failures.push(`${msg}${ctx ? `\n      ${String(ctx).split('\n').join('\n      ')}` : ''}`);
  console.log(`   ✗ ${msg}`);
};
const has = (text, ...subs) => subs.every((s) => (s instanceof RegExp ? s.test(text) : text.includes(s)));
const ok = (r, msg) => check(!r.isError && !/ERROR/.test(r.text), `${msg} (no errors)`, r.text);
// Rendered end texts (multiplicities, roles) that overlap the shapes their connector joins or
// each other: "" when every text is clear. Prefixed by the number of end texts found.
const END_TEXT_CLASHES = `const g=api.g, v=g.view;
const box=(c)=>{const s=v.getState(c); if(!s) return null; const b=s.text&&s.text.boundingBox||s; return {x:b.x,y:b.y,w:b.width,h:b.height,n:api.label(c)}};
const hit=(a,b)=>a&&b&&a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
let n=0; const bad=[];
for (const e of api.userCells().filter(c=>c.edge)) {
  const ts=['fromMultiplicityCell','fromRoleCell','toMultiplicityCell','toRoleCell'].map(k=>e[k]&&box(e[k]));
  ts.forEach((t,i)=>{ if(!t) return; n++; for (const end of [e.source,e.target]) if (hit(t,box(end))) bad.push(t.n+' on '+api.plainLabel(end)); if (i%2===0 && hit(t,ts[i+1])) bad.push(t.n+' on '+ts[i+1].n); });
}
return n+':'+bad.join('; ');`;

// ───────────── generic diagram suite ─────────────
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf8'));
async function diagram(name, { type, ...spec }, expects, extra) {
  console.log(`▶ ${name} (${type})`);
  const o = await call('vp_open', { type });
  check(!o.isError && has(o.text, type), `${name}: vp_open`, o.text);
  const b = await call('vp_build', { clear: true, ...spec });
  ok(b, `${name}: vp_build`);
  const n = (spec.elements || []).length, c = (spec.connectors || []).length;
  check(has(b.text, `created ${n} elements, ${c} connectors`), `${name}: counts ${n}/${c}`, b.text);
  const i = await call('vp_inspect');
  for (const e of expects) check(has(i.text, e), `${name}: inspect has ${e}`, i.text);
  if (extra) await extra(i.text);
  const s = await call('vp_screenshot', { path: path.join(OUT, `${name}.png`) });
  check(!s.isError, `${name}: screenshot`, s.text);
  console.log(`   build ${b.ms}ms, ${i.text.split('\n').length - 1} lines`);
  return i.text;
}

const suites = {
  async class() {
    await diagram('class', example('class'), [
      'Class "User"', 'Interface "Authenticable"', 'Enumeration "LoanStatus"', '[-id : String; -fullName : String; -failedLogins : int; +login(id : String, pwd : String) : boolean]',
      'Generalization Member -> User', 'Generalization Librarian -> User', 'Realization User -> Authenticable',
      'Association Member{0..1} -> BookCopy{0..1} "holds"', 'Association BookCopy{1,role=copy} -> Loan{0..*,role=loans} "lent in"',
      'Aggregation Shelf{1} -> BookCopy{1..*}', 'Dependency Loan -> LoanStatus',
      '[ACTIVE; RETURNED; OVERDUE; LOST]',
    ]);
    // end texts are drawn (VP skips them unless the label changes) and moved off the line:
    // multiplicity on one side, role on the other; connector names beside the line
    const ends = await call('vp_eval', { code: END_TEXT_CLASHES });
    check(ends.text === '8:', 'class: all 8 multiplicities/roles drawn, clear of the shapes and of each other', ends.text);
    const offs = await call('vp_eval', { code: 'return api.userCells().filter(c=>c.edge && api.plainLabel(c)).map(c=>c.geometry.offset ? c.geometry.offset.x+","+c.geometry.offset.y : "none").join(" ")' });
    check(offs.text.split(' ').length === 2 && !/none|^0,0|\s0,0/.test(offs.text), 'class: connector names moved off the line', offs.text);
    // edit ops on the class diagram
    console.log('▶ edit ops');
    const e = await call('vp_edit', { ops: [
      { op: 'label', ref: 'Shelf', text: 'MainShelf' },
      { op: 'move', ref: 'MainShelf', x: 470, y: 520 },
      { op: 'resize', ref: 'Librarian', w: 220, h: 60 },
      { op: 'rows', ref: 'BookCopy', rows: ['-timesLent : int', '+lend(m : Member) : void'] },
      { op: 'removeRows', ref: 'User', match: 'failedLogins' },
      { op: 'ends', ref: '#' + (await idOf('holds')), mult: ['0..1', '1'] },
      { op: 'style', ref: 'Authenticable', style: 'fillColor=#FFF2CC;' },
      { op: 'add', shape: 'Class', label: 'Branch', x: 1050, y: 330, rows: ['-code : String'] },
      { op: 'connect', shape: 'Association', from: 'Loan', to: 'Branch', mult: ['0..*', '1'], label: 'issued at' },
      { op: 'add', shape: 'Note', label: 'temporary', x: 1050, y: 40, key: 'note' },
      { op: 'delete', ref: 'note' },
      { op: 'fit', ref: 'BookCopy' },
    ] });
    check(!/ERROR/.test(e.text), 'edit: all ops ok', e.text);
    const i = await call('vp_inspect');
    check(has(i.text, 'Class "MainShelf" @470,520'), 'edit: label+move', i.text);
    check(has(i.text, /Class "Librarian" @20,260 220x60/), 'edit: resize', i.text);
    check(has(i.text, '-price : float; -timesLent : int; +lend(m : Member) : void]'), 'edit: rows add', i.text);
    check(!has(i.text, 'failedLogins'), 'edit: removeRows', i.text);
    check(has(i.text, 'Member{0..1} -> BookCopy{1} "holds"'), 'edit: ends', i.text);
    check(has(i.text, 'Association Loan{0..*} -> Branch{1} "issued at"'), 'edit: connect', i.text);
    check(!has(i.text, 'temporary'), 'edit: delete', i.text);
    const st = await call('vp_eval', { code: 'return api.g.getModel().getStyle(api.resolve("Authenticable"))' });
    check(has(st.text, 'fillColor=#FFF2CC'), 'edit: style', st.text);
    // inspect options
    const f = await call('vp_inspect', { filter: 'Generalization' });
    check(f.text.split('\n').length === 3, 'inspect: filter', f.text);
    const br = await call('vp_inspect', { detail: 'brief' });
    check(has(br.text, 'Class "BookCopy" (4 rows)') && !has(br.text, '@'), 'inspect: brief', br.text);
    const r = await call('vp_inspect', { ref: 'BookCopy' });
    check(has(r.text, 'Class "BookCopy"') && has(r.text, 'holds') && !has(r.text, 'Class "Branch"'), 'inspect: ref', r.text);
    const l = await call('vp_inspect', { limit: 3 });
    check(has(l.text, 'more lines: narrow with filter'), 'inspect: limit/truncation hint', l.text);
    // layout + screenshot variants
    const lay = await call('vp_edit', { ops: [{ op: 'layout', kind: 'hierarchical' }] });
    check(has(lay.text, 'layout hierarchical applied'), 'edit: layout', lay.text);
    const ends2 = await call('vp_eval', { code: END_TEXT_CLASHES });
    check(/^\d+:$/.test(ends2.text) && +ends2.text.split(':')[0] >= 8, 'edit: end texts re-placed clear of the shapes after a layout', ends2.text);
    const img = await call('vp_screenshot', { scale: 0.5 });
    check(img.content && img.content[0].type === 'image' && img.content[0].data.length > 1000, 'screenshot: inline image');
    const one = await call('vp_screenshot', { ref: 'BookCopy', path: path.join(OUT, 'class-bookcopy.png') });
    check(!one.isError, 'screenshot: ref', one.text);
    await call('vp_screenshot', { path: path.join(OUT, 'class-edited.png') });
  },

  async usecase() {
    await diagram('usecase', example('usecase'), ['UseCase "Log in"', 'in LIBRARY', 'Include Borrow book -> Check availability', 'Extend Show error -> Borrow book', 'Generalization Member -> Visitor'],
    async (t) => {
      const sys = /System "LIBRARY" @220,20 (\d+)x(\d+)/.exec(t);
      check(sys && +sys[1] === 420, 'usecase: container keeps requested width', t);
      // no two use cases overlap inside the system
      const boxes = [...t.matchAll(/UseCase "[^"]+" @(-?\d+),(-?\d+) (\d+)x(\d+) in/g)].map((m) => m.slice(1).map(Number));
      let overlap = false;
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const [x1, y1, w1, h1] = boxes[a], [x2, y2, w2, h2] = boxes[b];
        if (x1 < x2 + w2 && x2 < x1 + w1 && y1 < y2 + h2 && y2 < y1 + h1) overlap = true;
      }
      check(boxes.length === 5 && !overlap, 'usecase: auto-placed children do not overlap', t);
    });
  },

  async activity() {
    await diagram('activity', example('activity'), ['InputPin "isbn"', 'in Select book', 'ControlFlow #', '"[available]"', 'DecisionNode ""', 'MergeNode ""']);
  },

  async sequence() {
    await diagram('sequence', example('sequence'), ['Message Member -> :LoanScreen "1: borrow(isbn)"', 'SelfMessage :LoanController -> :LoanController', 'ReplyMessage :LoanScreen -> Member'],
    async () => {
      const ys = await call('vp_eval', { code: `const g=api.g; return api.userCells().filter(c=>c.edge).map(e=>{const s=g.getCellStyle(e); let y=e.source.geometry.y; return Math.round(y+Number(s.exitY))}).join(',')` });
      const arr = ys.text.split(',').map(Number);
      check(arr.length === 6 && arr.every((v, i) => i === 0 || v > arr[i - 1]), 'sequence: messages strictly top-down', ys.text);
      const off = await call('vp_eval', { code: 'return api.userCells().filter(c=>c.edge && c.source!==c.target).map(c=>c.geometry.offset ? c.geometry.offset.y : 0).join(",")' });
      check(off.text.split(',').length === 5 && off.text.split(',').every((v) => +v < 0), 'sequence: message names above the arrows', off.text);
    });
  },

  async state() {
    await diagram('state', example('state'), ['State "Lost"', 'Transition Reserved -> Active "pickUp()"', 'Transition Active -> Lost "reportLost(reason)"']);
  },

  async component() {
    await diagram('component', example('component'), ['Port "http"', 'in WebApp', 'Realization LoanService -> ILoans', 'Usage WebApp -> ILoans', 'Interface "ILoans"']);
  },

  async deployment() {
    await diagram('deployment', example('deployment'), ['DeviceNode "Web server"', 'Artifact "library DB"', 'in Web server', 'Link Web server -> Auth server "fiber optic"'],
    async (t) => {
      const web = /"Web server" @360,40 (\d+)x(\d+)/.exec(t);
      const sec = /"Auth server" @360,420/.exec(t);
      check(web && sec && 40 + +web[2] < 420, 'deployment: auto-grown container does not reach the node below', t);
    });
  },

  async package() {
    await diagram('package', example('package'), ['Package "domain"', 'in library', 'Import persistence -> java.sql']);
  },

  async er() {
    await diagram('er', example('er'), ['Entity "User"', '[id varchar(9); fullName varchar(100); failedLogins int]', 'OnetoManyRelationship BookCopy -> Loan', 'View "ActiveLoans"'],
    async () => {
      const x = await call('vp_eval', { code: 'return [...api.resolve("Loan").value.getElementsByTagName("*")].map(n=>n.getAttribute("signature")+":"+(n.getAttribute("primaryKey")||"")+(n.getAttribute("foreignKey")||"")+(n.getAttribute("nullable")||"")).join("|")' });
      check(has(x.text, 'loanId int:true', 'barcode varchar(10):true', 'status varchar(12):false'), 'er: PK/FK/set flags stored', x.text);
      const pk = await call('vp_eval', { code: 'return [...api.resolve("Member").value.getElementsByTagName("*")].map(n=>n.getAttribute("signature")+":"+n.getAttribute("primaryKey")+n.getAttribute("foreignKey")).join("|")' });
      check(has(pk.text, 'userId varchar(9):truetrue'), 'er: PK,FK shorthand', pk.text);
    });
  },

  async dfd() {
    await diagram('dfd', example('dfd'), ['"1.0 Borrow book"', '"book request"', 'BidirectionalDataFlow']);
  },

  async bpmn() {
    await diagram('bpmn', example('bpmn'), ['Lane "Librarian"', 'in LIBRARY', '"Register book"', 'in Librarian', 'UserTask', '"available"'],
    async (t) => {
      const l1 = /Lane "Librarian" @(\d+),(\d+) (\d+)x(\d+)/.exec(t), l2 = /Lane "Member" @(\d+),(\d+) (\d+)x(\d+)/.exec(t);
      check(l1 && l2 && +l2[2] >= +l1[2] + +l1[4], 'bpmn: lanes stacked without overlap', t);
    });
  },

  async flowchart() {
    await diagram('flowchart', example('flowchart'), ['"Credentials OK?"', 'FlowLine Credentials OK? -> Show home "yes"']);
  },

  async orgchart() {
    await diagram('orgchart', example('orgchart'), ['"Director"', 'Line Director -> Operations']);
  },

  async mindmap() {
    await diagram('mindmap', example('mindmap'), ['"Members"', 'Branch Library -> Loans']);
  },

  async autolayout() {
    console.log('▶ autolayout');
    await call('vp_open', { type: 'ClassDiagram' });
    const b = await call('vp_build', { elements: ['A', 'B', 'C', 'D', 'E'].map((n) => ({ shape: 'Class', label: n })), connectors: [{ shape: 'Association', from: 'A', to: 'B' }, { shape: 'Association', from: 'A', to: 'C' }], layout: 'hierarchical' });
    ok(b, 'autolayout: build with layout');
    const i = await call('vp_inspect');
    const boxes = [...i.text.matchAll(/@(-?\d+),(-?\d+) (\d+)x(\d+)/g)].map((m) => m.slice(1).map(Number));
    let overlap = false;
    for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) {
      const [x1, y1, w1, h1] = boxes[a], [x2, y2, w2, h2] = boxes[c];
      if (x1 < x2 + w2 && x2 < x1 + w1 && y1 < y2 + h2 && y2 < y1 + h1) overlap = true;
    }
    check(boxes.length === 5 && !overlap && boxes.every(([x, y]) => x >= 0 && y >= 0), 'autolayout: no overlap, positive coords', i.text);
    for (const kind of ['grid', 'horizontal', 'organic', 'tree']) {
      const r = await call('vp_edit', { ops: [{ op: 'layout', kind }] });
      check(has(r.text, `layout ${kind} applied`), `autolayout: ${kind}`, r.text);
    }
    const g = await call('vp_build', { clear: true, columns: 2, elements: ['P', 'Q', 'R'].map((n) => ({ shape: 'Class', label: n })) });
    ok(g, 'autolayout: columns');
    const gi = await call('vp_inspect');
    const ys = [...gi.text.matchAll(/@(-?\d+),(-?\d+)/g)].map((m) => +m[2]);
    check(ys[0] === ys[1] && ys[2] > ys[0], 'autolayout: grid with 2 columns', gi.text);
  },

  async errors() {
    console.log('▶ errors');
    await call('vp_open', { type: 'ClassDiagram' });
    const e1 = await call('vp_build', { elements: [{ shape: 'Clas', label: 'X' }] });
    check(e1.isError && has(e1.text, 'Did you mean: Class'), 'error: unknown shape suggests', e1.text);
    const e2 = await call('vp_build', { elements: [{ shape: 'Association', label: 'X' }] });
    check(has(e2.text, 'is a connector, not a shape'), 'error: connector used as shape', e2.text);
    const e3 = await call('vp_build', { elements: [{ shape: 'Class', label: 'Solo' }], connectors: [{ shape: 'Association', from: 'Solo', to: 'Nobody' }] });
    check(!e3.isError && has(e3.text, 'created 1 elements, 0 connectors, 1 errors', 'no element "Nobody"'), 'error: partial success reported', e3.text);
    const e4 = await call('vp_build', { elements: [{ shape: 'Class', label: 'Solo' }] });
    const e5 = await call('vp_edit', { ops: [{ op: 'label', ref: 'Solo', text: 'Y' }] });
    check(has(e5.text, 'ambiguous') && has(e5.text, '#'), 'error: ambiguous ref lists #ids', e5.text);
    const e6 = await call('vp_build', { elements: [{ shape: 'Note', label: 'n', rows: ['x'] }] });
    check(has(e6.text, 'has no rows'), 'error: rows on shape without rows', e6.text);
    const e7 = await call('vp_build', {});
    check(e7.isError && has(e7.text, 'nothing to build'), 'error: empty build', e7.text);
    const e8 = await call('vp_open', { type: 'ClassDiagram', url: 'https://online.visual-paradigm.com/x' });
    check(e8.isError && has(e8.text, 'either type'), 'error: open with both args', e8.text);
    const e9 = await call('vp_edit', { ops: [{ op: 'explode', ref: 'x' }] });
    check(e9.isError, 'error: unknown op rejected by schema', e9.text);
    const e10 = await call('vp_inspect', { ref: 'NoSuchThing' });
    check(e10.isError && has(e10.text, 'no element "NoSuchThing"'), 'error: inspect bad ref', e10.text);
    await call('vp_open', { type: 'ComponentDiagram' });
    const e11 = await call('vp_build', { elements: [{ shape: 'Port' }] });
    check(has(e11.text, 'must be attached to a parent'), 'error: attached without parent', e11.text);
    const e12 = await call('vp_eval', { code: 'throw new Error("boom")' });
    check(e12.isError && has(e12.text, 'boom'), 'error: eval exception surfaced', e12.text);
    const e13 = await call('vp_screenshot', { path: path.join(OUT, 'empty.png') });
    check(!e13.isError || has(e13.text, 'empty'), 'screenshot on empty/near-empty diagram handled', e13.text);
  },

  async shapes() {
    console.log('▶ shapes');
    await call('vp_open', { type: 'ClassDiagram' });
    const p = await call('vp_shapes');
    check(has(p.text, 'class shapes: Class, Interface', 'class connectors: Generalization'), 'shapes: palette', p.text);
    const q = await call('vp_shapes', { query: 'Actor', limit: 5 });
    check(has(q.text, 'results:') && has(q.text, 'Actor'), 'shapes: search', q.text);
    const b = await call('vp_build', { clear: true, elements: [{ shape: 'Actor', label: 'Searched actor' }] });
    ok(b, 'shapes: searched shape usable in build');
    const n = await call('vp_shapes', { query: 'zzqxnotashape' });
    check(has(n.text, 'no shapes match'), 'shapes: no match message', n.text);
  },

  async concurrency() {
    console.log('▶ concurrency');
    await call('vp_open', { type: 'ClassDiagram' });
    const rs = await Promise.all([
      call('vp_build', { elements: [{ shape: 'Class', label: 'K1' }] }),
      call('vp_inspect'),
      call('vp_build', { elements: [{ shape: 'Class', label: 'K2' }] }),
      call('vp_inspect', { detail: 'brief' }),
    ]);
    check(rs.every((r) => !r.isError), 'concurrency: parallel calls all succeed', rs.map((r) => r.text).join('\n---\n'));
    const i = await call('vp_inspect');
    check(has(i.text, '"K1"', '"K2"'), 'concurrency: both builds applied', i.text);
  },

  async save() {
    if (!SAVE) { console.log('▶ save (skipped: pass --save)'); return; }
    console.log('▶ save + reopen');
    await call('vp_open', { type: 'ClassDiagram' });
    await call('vp_build', { elements: [{ shape: 'Class', label: 'Persist', x: 40, y: 40, rows: ['-id : int', '+get() : int'] }, { shape: 'Class', label: 'Other', x: 400, y: 40 }], connectors: [{ shape: 'Association', from: 'Persist', to: 'Other', label: 'uses', mult: ['1', '*'], roles: ['owner', 'items'] }] });
    const textsOf = 'const e=api.userCells().find(c=>c.edge); const o=(g)=>g.offset?g.offset.x+","+g.offset.y:"0,0"; return [e.fromMultiplicityCell,e.fromRoleCell,e.toMultiplicityCell,e.toRoleCell].map(t=>t?api.label(t)+"@"+t.geometry.x+"/"+o(t.geometry):"-").join(" ")+" name="+o(e.geometry)';
    const before = await call('vp_eval', { code: textsOf });
    const s1 = await call('vp_save', { name: 'vp-online-mcp e2e (safe to delete)' });
    check(!s1.isError && has(s1.text, 'saved "vp-online-mcp e2e (safe to delete)"', 'id='), 'save: untitled -> named', s1.text);
    const url = (s1.text.match(/https:\S+/) || [])[0];
    await call('vp_edit', { ops: [{ op: 'rows', ref: 'Other', rows: ['-x : int'] }] });
    const s2 = await call('vp_save');
    check(!s2.isError && has(s2.text, 'vp-online-mcp e2e'), 'save: re-save', s2.text);
    const o = await call('vp_open', { url });
    check(!o.isError && has(o.text, 'vp-online-mcp e2e'), 'save: reopen by url', o.text);
    const i = await call('vp_inspect');
    check(has(i.text, '[-id : int; +get() : int]', '[-x : int]', 'Association Persist{1,role=owner} -> Other{*,role=items} "uses"'), 'save: content survives reload', i.text);
    const after = await call('vp_eval', { code: textsOf });
    check(/^1@\S+ owner@\S+ \*@\S+ items@\S+ name=0,-\d+$/.test(before.text) && !/\/0,0 /.test(before.text) && after.text === before.text, 'save: end texts and name placement survive reload', `${before.text}\n${after.text}`);
    const clash = await call('vp_eval', { code: END_TEXT_CLASHES });
    check(clash.text === '4:', 'save: end texts clear after reload', clash.text);
    // rows are real cells after reload: editing must still work
    const e = await call('vp_edit', { ops: [{ op: 'rows', ref: 'Persist', rows: ['-y : int'] }, { op: 'removeRows', ref: 'Persist', match: '^-id' }] });
    check(!/ERROR/.test(e.text), 'save: edit rows after reload', e.text);
    const i2 = await call('vp_inspect', { ref: 'Persist' });
    check(has(i2.text, '-y : int') && !has(i2.text, '-id : int'), 'save: rows edited after reload', i2.text);
    await call('vp_save');
    const cp = await call('vp_save', { name: 'vp-online-mcp e2e copy (safe to delete)' });
    const url2 = (cp.text.match(/https:\S+/) || [])[0];
    check(!cp.isError && has(cp.text, 'saved "vp-online-mcp e2e copy') && url2 && url2 !== url, 'save: different name on a saved diagram = copy', cp.text);
    const st = await call('vp_open');
    check(!st.isError && has(st.text, 'vp-online-mcp e2e copy', 'id='), 'open: no args describes current diagram', st.text);
  },

  async misc() {
    console.log('▶ misc');
    const bad = await call('vp_open', { url: 'https://example.com/x' });
    check(bad.isError && has(bad.text, 'Visual Paradigm Online'), 'open: rejects non-VP url', bad.text);
    await call('vp_open', { type: 'BusinessProcessDiagram' });
    const v = await call('vp_build', { elements: [
      { key: 'vp', shape: 'VerticalPool', label: 'Company', x: 40, y: 40 },
      { key: 'a', shape: 'Lane', label: 'Office', parent: 'vp', w: 200 },
      { key: 'b', shape: 'Lane', label: 'Almacén', parent: 'vp', w: 200 }, // non-ASCII label on purpose
      { shape: 'Task', label: 'Plan', parent: 'a', x: 40, y: 80 },
    ] });
    ok(v, 'vertical pool + lanes');
    const vi = await call('vp_inspect');
    const la = /Lane "Office" @(\d+),(\d+) (\d+)x(\d+)/.exec(vi.text), lb = /Lane "Almacén" @(\d+),(\d+) (\d+)x(\d+)/.exec(vi.text);
    check(la && lb && +lb[1] >= +la[1] + +la[3] && la[2] === lb[2], 'vertical pool: lanes side by side', vi.text);
    await call('vp_screenshot', { path: path.join(OUT, 'bpmn-vertical.png') });
    // row objects with explicit action
    await call('vp_open', { type: 'ClassDiagram' });
    const r = await call('vp_build', { elements: [{ shape: 'Class', label: 'R', rows: [{ text: 'getX', action: 'addOperation' }, 'y : int'] }] });
    ok(r, 'row object with action');
    const ops = await call('vp_eval', { code: 'return api.resolve("R").value.getElementsByTagName("Operation").length' });
    check(ops.text === '1', 'row action created an Operation', ops.text);
  },

  async coverage() {
    console.log('▶ coverage (every shape named in the README)');
    const cases = [
      ['ActivityDiagram', { elements: [
        { key: 'sw', shape: 'VerticalSwimlane', x: 40, y: 40, rows: ['Office', 'Member', 'System'] },
        { key: 'ob', shape: 'ObjectNode', label: 'Loan', x: 600, y: 40 },
        { key: 'a', shape: 'Action', label: 'Validate', x: 400, y: 40 },
        { key: 'pn', shape: 'OutputPin', label: 'ok', parent: 'a' },
      ], connectors: [{ shape: 'ObjectFlow', from: 'a', to: 'ob' }] }, ['ActivityPartition "Office"', 'ActivityPartition "System"', 'OutputPin "ok"', 'ObjectFlow Validate -> Loan']],
      ['SequenceDiagram', { elements: [
        { key: 'a', shape: 'Lifeline', label: ':A', x: 40, y: 20 },
        { key: 'b', shape: 'Lifeline', label: ':B', x: 260, y: 20 },
        { key: 'l', shape: 'LoopCombinedFragment', label: 'loop', x: 20, y: 90, w: 360, h: 120 },
      ], connectors: [
        { shape: 'CreateMessage', from: 'a', to: 'b', label: 'create', y: 120 },
        { shape: 'Message', from: 'a', to: 'b', label: 'm', y: 170 },
      ] }, ['LoopCombinedFragment', 'CreateMessage :A -> :B "create"', 'Message :A -> :B "m"']],
      ['StateMachineDiagram', { elements: [
        { shape: 'State', label: 'S1', x: 40, y: 40 }, { key: 'c', shape: 'Choice', x: 220, y: 50 }, { shape: 'State', label: 'S2', x: 360, y: 0 }, { shape: 'State', label: 'S3', x: 360, y: 100 },
      ], connectors: [{ shape: 'Transition', from: 'S1', to: 'c' }, { shape: 'Transition', from: 'c', to: 'S2', label: '[x>0]' }, { shape: 'Transition', from: 'c', to: 'S3', label: '[else]' }] },
      ['Choice', 'Transition #', '"[x>0]"']],
      ['DeploymentDiagram', { elements: [
        { key: 'n', shape: 'Node', label: 'Server', x: 40, y: 40, w: 260 }, { key: 'ar', shape: 'Artifact', label: 'app.war', x: 400, y: 60 },
      ], connectors: [{ shape: 'Deployment', from: 'ar', to: 'n' }] }, ['Deployment app.war -> Server']],
      ['ERDiagram', { elements: [
        { shape: 'Entity', label: 'A', x: 40, y: 40, rows: ['PK id int'] }, { shape: 'Entity', label: 'B', x: 300, y: 40, rows: ['PK id int'] },
        { shape: 'StoredProcedures', label: 'Procs', x: 40, y: 220, rows: ['borrowBook'], rowAction: 'addProcedure' },
      ], connectors: [{ shape: 'ManytoManyRelationship', from: 'A', to: 'B' }] }, ['ManytoManyRelationship', 'StoredProcedures "Procs"', '[borrowBook]']],
      ['BusinessProcessDiagram', { elements: [
        { key: 'p1', shape: 'HorizontalPool', label: 'Company', x: 40, y: 40, w: 500, h: 150 },
        { key: 'p2', shape: 'HorizontalPool', label: 'Customer', x: 40, y: 260, w: 500, h: 150 },
        { key: 't1', shape: 'Task', label: 'Send', parent: 'p1', x: 60, y: 50 },
        { key: 't2', shape: 'Task', label: 'Receive', parent: 'p2', x: 60, y: 50 },
        { key: 'go', shape: 'ParallelForkJoinAND', parent: 'p1', x: 250, y: 50 },
      ], connectors: [{ shape: 'MessageFlow', from: 't1', to: 't2', label: 'order' }, { shape: 'SequenceFlow', from: 't1', to: 'go' }] },
      ['MessageFlow Send -> Receive "order"', 'ParallelForkJoinAND']],
      ['ClassDiagram', { elements: [
        { shape: 'Package', label: 'model', x: 40, y: 40, w: 400 }, { shape: 'Class', label: 'A', parent: 'model' }, { shape: 'Class', label: 'B', parent: 'model' },
        { shape: 'Note', label: 'remark', x: 500, y: 40 },
      ], connectors: [{ shape: 'Composition', from: 'A', to: 'B', mult: ['1', '*'] }, { shape: 'Usage', from: 'A', to: 'B' }, { shape: 'Anchor', from: 'remark', to: 'model' }] },
      ['Composition A{1} -> B{*}', 'Usage A -> B', 'in model', 'Note "remark"', 'Anchor remark -> model']],
    ];
    for (const [type, spec, exp] of cases) {
      await call('vp_open', { type });
      const b = await call('vp_build', spec);
      ok(b, `coverage ${type}: build`);
      const i = await call('vp_inspect');
      for (const e of exp) check(has(i.text, e), `coverage ${type}: ${e}`, i.text);
      if (type === 'ClassDiagram') { // the two A-B connectors must not overlap
        const pts = await call('vp_eval', { code: 'return api.userCells().filter(c=>c.edge && c.source && c.target && api.plainLabel(c.source)==="A").map(c=>JSON.stringify(c.geometry.points||[])).join("|")' });
        const [p1, p2] = pts.text.split('|');
        check(p1 !== p2, 'coverage: parallel connectors are fanned out', pts.text);
      }
      await call('vp_screenshot', { path: path.join(OUT, `coverage-${type}.png`) });
    }
  },

  async stress() {
    console.log('▶ stress (40 classes, 320 rows, 45 connectors)');
    await call('vp_open', { type: 'ClassDiagram' });
    const els = Array.from({ length: 40 }, (_, i) => ({ shape: 'Class', label: `C${i}`, rows: Array.from({ length: 8 }, (_, j) => (j < 6 ? `-a${j} : int` : `+m${j}(p : int) : void`)) }));
    const cons = Array.from({ length: 45 }, (_, i) => ({ shape: i % 3 ? 'Association' : 'Generalization', from: `C${(i * 7) % 40}`, to: `C${(i * 7 + 3) % 40}`, ...(i % 3 ? { mult: ['1', '0..*'] } : {}) }));
    const b = await call('vp_build', { elements: els, connectors: cons });
    ok(b, 'stress: build');
    check(has(b.text, 'created 40 elements, 45 connectors'), 'stress: counts', b.text);
    console.log(`   build ${b.ms}ms`);
    check(b.ms < 60000, `stress: build under 60s (${b.ms}ms)`);
    const i = await call('vp_inspect', { detail: 'brief' });
    check(i.text.split('\n').length === 86 && has(i.text, '(8 rows)'), 'stress: inspect brief lists all', i.text.slice(0, 300));
    const lim = await call('vp_inspect');
    check(lim.text.split('\n').length <= 152, 'stress: default limit caps output', String(lim.text.split('\n').length));
    const lay = await call('vp_edit', { ops: [{ op: 'layout', kind: 'organic' }] });
    ok(lay, 'stress: layout');
    const stale = await call('vp_eval', { code: 'const es=api.userCells().filter(c=>c.edge); const key=(e)=>[e.source.id,e.target.id].sort().join(); const n={}; es.forEach(e=>n[key(e)]=(n[key(e)]||0)+1); return es.filter(e=>e.geometry.points&&e.geometry.points.length&&n[key(e)]===1).length' });
    check(stale.text === '0', 'stress: organic layout leaves no stale waypoints', stale.text);
    await call('vp_screenshot', { path: path.join(OUT, 'stress.png'), scale: 0.6 });
  },
};

const t0 = Date.now();
for (const [name, fn] of Object.entries(suites)) {
  if (only.length && !only.includes(name)) continue;
  try { await fn(); } catch (e) { check(false, `${name}: crashed ${e.stack}`); }
}
console.log(`\n${pass} passed, ${fail} failed in ${Math.round((Date.now() - t0) / 1000)}s`);
if (failures.length) console.log(`\nFAILURES:\n- ${failures.join('\n- ')}`);
await client.close();
process.exit(fail ? 1 : 0);

async function idOf(label) {
  const r = await call('vp_inspect', { filter: label });
  const m = /#(\d+) \w+ .*"/.exec(r.text.split('\n').find((l) => l.includes(`"${label}"`)) || '');
  return m ? m[1] : '?';
}
