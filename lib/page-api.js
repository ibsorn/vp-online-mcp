// In-page API injected into the Visual Paradigm Online diagram editor (mxGraph based).
//
// Everything goes through VP's own code paths (palette drop handlers, palette templates,
// "Add X" context-menu methods, graph.labelChanged), so the result is a native VP model
// (cells carry vpId/modelVpId), not a drawing. VP's code is minified: no minified name is
// hard-coded here, they are all discovered at runtime (see init, itemMeta, rowMethods).
(() => {
  const VERSION = 'dev'; // replaced by a content hash on injection (lib/vp.js)
  if (window.__vpmcp && window.__vpmcp.version === VERSION) return;

  const api = { version: VERSION, keys: {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const G = () => { if (!api.g) throw new Error('editor not attached'); return api.g; };
  const M = () => G().getModel();

  // ───────────────────────── bootstrap ─────────────────────────
  // EditorUi / Graph instances are not global: wrap their prototypes for a moment and
  // capture `this` on the first call, triggered by a synthetic mousemove on the canvas.
  const hook = (P, key) => {
    for (const n of Object.getOwnPropertyNames(P)) {
      const d = Object.getOwnPropertyDescriptor(P, n);
      if (!d || typeof d.value !== 'function' || n === 'constructor' || d.value.__vpmcpOrig) continue;
      const o = d.value;
      const w = function () { if (!window[key]) window[key] = this; return o.apply(this, arguments); };
      w.__vpmcpOrig = o;
      try { P[n] = w; } catch { /* read-only */ }
    }
  };
  const unhook = (P) => {
    for (const n of Object.getOwnPropertyNames(P)) {
      const d = Object.getOwnPropertyDescriptor(P, n);
      if (d && typeof d.value === 'function' && d.value.__vpmcpOrig) try { P[n] = d.value.__vpmcpOrig; } catch { }
    }
  };
  api.init = async () => {
    if (api.ui && api.g && api.ui.editor && api.ui.editor.graph === api.g) return true;
    window.__vpmcpUi = null; window.__vpmcpG = null;
    hook(EditorUi.prototype, '__vpmcpUi');
    hook(mxGraph.prototype, '__vpmcpG');
    try {
      const c = document.querySelector('.geDiagramContainer');
      if (c) {
        const r = c.getBoundingClientRect();
        for (let i = 0; i < 6 && !(window.__vpmcpUi && window.__vpmcpG); i++) {
          c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + 40 + i, clientY: r.y + 40 }));
          await sleep(100);
        }
      }
    } finally { unhook(EditorUi.prototype); unhook(mxGraph.prototype); }
    api.ui = window.__vpmcpUi;
    api.g = api.ui && api.ui.editor ? api.ui.editor.graph : null;
    return !!(api.ui && api.g);
  };

  // ───────────────────────── palette ─────────────────────────
  // Each palette item is an <a class="geItem"> holding a metadata object (strings:
  // palette items [kind, diagramType, paletteId, itemId, title]; search results
  // [kind, itemId, title]) and an mxDragSource. Connector and attached items (Port, Pin,
  // Lane...) also expose a template cell through a getCell() method.
  const dragSourceOf = (a) => Object.values(a).find((v) => v instanceof mxDragSource);
  const metaOf = (a) => Object.values(a).find((v) => v && typeof v === 'object' && !(v instanceof mxDragSource) && !Array.isArray(v)
    && Object.values(v).filter((x) => typeof x === 'string').length >= 3 && Object.values(v).includes('ITEM'));
  let itemsCache = null; // valid during one fast() batch
  api.items = () => itemsCache || scanItems();
  const scanItems = () => [...document.querySelectorAll('.geSidebarContainer a.geItem')].map((a) => {
    const meta = metaOf(a); const ds = dragSourceOf(a);
    if (!meta || !ds) return null;
    const s = Object.values(meta).filter((v) => typeof v === 'string'); const n = s.length;
    const id = s[n - 2], title = s[n - 1];
    if (!id || /^unamed$/i.test(id)) return null;
    let kind = 'shape', tmpl = null;
    if (typeof a.getCell === 'function') { tmpl = a.getCell(); kind = tmpl && tmpl.edge ? 'connector' : 'attached'; }
    return { el: a, ds, tmpl, palette: n >= 5 ? s[2] : 'search', id, title, kind };
  }).filter(Boolean);

  const similar = (name, items) => {
    const n = norm(name);
    const scored = [...new Set(items.map((i) => i.id))].map((id) => {
      const k = norm(id);
      const score = k === n ? 0 : k.includes(n) || n.includes(k) ? 1 : lev(k, n) / Math.max(k.length, n.length) + 1;
      return [score, id];
    }).sort((a, b) => a[0] - b[0]);
    return scored.filter((s) => s[0] < 1.6).slice(0, 5).map((s) => s[1]);
  };
  const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  api.findItem = (name, want) => {
    const items = api.items();
    const ok = (i) => !want || (want === 'connector' ? i.kind === 'connector' : i.kind !== 'connector');
    const n = norm(name);
    const hit = items.find((i) => ok(i) && i.id === name) || items.find((i) => ok(i) && norm(i.id) === n) || items.find((i) => ok(i) && norm(i.title) === n);
    if (hit) return hit;
    const other = items.find((i) => norm(i.id) === n || norm(i.title) === n);
    if (other) throw new Error(`"${name}" is a ${other.kind}, not a ${want === 'connector' ? 'connector' : 'shape'}`);
    const sug = similar(name, items.filter(ok));
    throw new Error(`unknown ${want || 'item'} "${name}".${sug.length ? ` Did you mean: ${sug.join(', ')}?` : ''} vp_shapes lists the palette; vp_shapes {query} searches the whole library.`);
  };
  api.palette = () => {
    const groups = {};
    for (const i of api.items()) {
      const k = `${i.palette} ${i.kind}s`;
      const label = i.id === i.title.replace(/\s/g, '') ? i.id : `${i.id}(${i.title})`;
      (groups[k] = groups[k] || new Set()).add(label);
    }
    return Object.entries(groups).map(([k, v]) => `${k}: ${[...v].join(', ')}`).join('\n') || '(empty palette)';
  };

  // ───────────────────────── cells ─────────────────────────
  api.label = (c) => {
    const v = c && c.value;
    if (v && v.getAttribute) return v.getAttribute('label') || '';
    return v == null ? '' : String(v);
  };
  const plainLabel = (c) => String(api.label(c)).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const shapeOf = (c) => { const m = /(?:^|;)shape=([^;]+)/.exec(c.style || ''); return m ? m[1] : (c.edge ? 'edge' : 'vertex'); };
  const shortId = (c) => { const m = /-(\d+)$/.exec(String(c.id)); return m ? m[1] : String(c.id); };
  // compartment rows (attributes, operations, columns...): virtual cells (id null) or, after a
  // save/reload, real cells whose value carries a `signature`
  const isRow = (k) => !!(k && k.vertex && k.parent && k.parent.vertex && (k.id == null || (k.value && k.value.getAttribute && k.value.getAttribute('signature') != null)));
  const isEdgeLabel = (c) => c.vertex && c.parent && c.parent.edge; // multiplicity / role texts
  api.userCells = () => Object.values(M().cells).filter((c) => c.id != null && c.parent && c.parent.parent);
  const elements = () => api.userCells().filter((c) => c.vertex && !isRow(c) && !isEdgeLabel(c));
  const connectors = () => api.userCells().filter((c) => c.edge);

  api.resolve = (ref) => {
    if (ref && typeof ref === 'object') return ref;
    if (ref == null || ref === '') throw new Error('missing ref (use a key, a label or a #id from vp_inspect)');
    const m = M(), s = String(ref);
    let c = m.getCell(s);
    if (c) return c;
    if (api.keys[s] && (c = m.getCell(api.keys[s]))) return c;
    const r = s.replace(/^#/, '');
    if (/^\d+$/.test(r)) {
      const hit = api.userCells().filter((x) => shortId(x) === r);
      if (hit.length === 1) return hit[0];
    }
    const want = s.replace(/\s+/g, ' ').trim();
    const hits = api.userCells().filter((x) => !isRow(x) && !isEdgeLabel(x) && plainLabel(x) === want);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`"${s}" is ambiguous (${hits.map((h) => '#' + shortId(h)).join(', ')}): use one of these #ids`);
    const lc = want.toLowerCase();
    const near = elements().map(plainLabel).filter((l) => l && (l.toLowerCase().includes(lc) || lc.includes(l.toLowerCase()))).slice(0, 5);
    throw new Error(`no element "${s}".${near.length ? ` Similar: ${near.join(', ')}.` : ''} vp_inspect lists labels and #ids.`);
  };

  // VP draws some arrowheads (Generalization, Realization) at the source end
  const isSwapped = (c) => {
    const st = G().getCellStyle(c);
    const head = (a) => a && a !== 'none' && !/diamond|circle|oval|dash|cross/i.test(a);
    return !!head(st[mxConstants.STYLE_STARTARROW]) && !head(st[mxConstants.STYLE_ENDARROW]);
  };
  const isMessage = (c) => /Message$/i.test(shapeOf(c));
  // palette id the cell was created from (VP stores it in the value's "origin" JSON)
  const originId = (c) => { try { return JSON.parse(c.value.getAttribute('origin')).paletteItemUiId || null; } catch { return null; } };
  // direction of an existing connector comes from its palette template: a cell's own style can
  // change (a Realization to a lollipop interface loses its arrowhead)
  const swapCache = {};
  const connectorSwapped = (c) => {
    const id = originId(c);
    if (id) {
      if (!(id in swapCache)) { const it = api.items().find((i) => i.kind === 'connector' && i.id === id); swapCache[id] = it ? isSwapped(it.tmpl) : null; }
      if (swapCache[id] != null) return swapCache[id];
    }
    return isSwapped(c);
  };

  // ───────────────────────── primitives ─────────────────────────
  // graph.labelChanged is what the in-place editor commits to; VP hooks it to update the model.
  const setLabel = (cell, text) => G().labelChanged(cell, text == null ? '' : String(text), null);

  const setGeometry = (cell, { x, y, w, h }) => {
    const geo = cell.geometry.clone();
    if (x != null) geo.x = x; if (y != null) geo.y = y;
    if (w != null) geo.width = w; if (h != null) geo.height = h;
    M().setGeometry(cell, geo);
  };

  const applyStyle = (cell, styleStr) => {
    for (const part of String(styleStr).split(';')) {
      const i = part.indexOf('=');
      const k = (i < 0 ? part : part.slice(0, i)).trim();
      if (k) G().setCellStyles(k, i < 0 ? null : part.slice(i + 1).trim(), [cell]);
    }
  };

  // "Add X" context-menu methods of a cell, discovered from the menu builder source:
  //   mxResources.get("addAttribute"),function(){var u=a.getGraph();y.Kkb(u)}
  const methodCache = {};
  const rowMethods = (cell) => {
    const ck = shapeOf(cell);
    const cached = methodCache[ck];
    if (cached && Object.values(cached).every((n) => typeof cell[n] === 'function')) return cached;
    const found = {}; const seen = new Set();
    const re = /mxResources\.get\("(\w+)"\),function\(\)\{var (\w+)=\w+\.getGraph\(\);\w+\.([\w$]+)\(\2\)\}/g;
    for (let o = cell; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (seen.has(k)) continue; seen.add(k);
        let v; try { v = cell[k]; } catch { continue; }
        if (typeof v !== 'function') continue;
        const s = Function.prototype.toString.call(v);
        if (s.indexOf('mxResources.get("add') < 0) continue;
        let mm; re.lastIndex = 0;
        while ((mm = re.exec(s))) if (/^add/.test(mm[1]) && typeof cell[mm[3]] === 'function') found[mm[1]] = mm[3];
      }
    }
    return (methodCache[ck] = found);
  };

  // Which "Add X" action a row goes to: explicit > column > "(" means operation > the only one.
  const rowActionFor = (cell, text, explicit) => {
    const methods = rowMethods(cell); const names = Object.keys(methods);
    if (!names.length) throw new Error(`${shapeOf(cell)} has no rows (no "Add ..." menu actions)`);
    const pick = (a) => names.find((k) => norm(k) === norm(a) || norm(k) === norm('add' + a));
    if (explicit) { const k = pick(explicit); if (!k) throw new Error(`row action "${explicit}" not available on ${shapeOf(cell)}; use one of: ${names.join(', ')}`); return k; }
    if (pick('addColumn')) return pick('addColumn');
    if (pick('addAttribute') && pick('addOperation')) return /\(/.test(text) ? pick('addOperation') : pick('addAttribute');
    if (names.length === 1) return names[0];
    throw new Error(`ambiguous row for ${shapeOf(cell)}: set rowAction to one of ${names.join(', ')}`);
  };

  const isPartition = (k) => /Partition$/.test(shapeOf(k));
  const addRows = (cell, rows, explicitAction) => {
    const g = G();
    const orig = g.startEditingAtCell;
    // activity swimlanes: rows are the partition names (the template brings two partitions)
    const parts = M().getChildVertices(cell).filter(isPartition);
    if (parts.length && !explicitAction) {
      const names = rows.map((r) => (typeof r === 'string' ? r : r.text));
      names.slice(0, parts.length).forEach((n, i) => setLabel(parts[i], n));
      if (names.length < parts.length) g.removeCells(parts.slice(names.length), true);
      rows = rows.slice(parts.length);
      if (!rows.length) { touched.add(cell); return; }
    }
    for (const row of rows) {
      let text = typeof row === 'string' ? row : row.text;
      if (text == null) throw new Error('row without text');
      const set = { ...((typeof row === 'object' && row.set) || {}) };
      const key = /^(PK|FK|PK,\s*FK|FK,\s*PK)\s+/i.exec(text); // ER shorthand
      if (key) {
        if (/PK/i.test(key[1])) set.primaryKey = 'true';
        if (/FK/i.test(key[1])) set.foreignKey = 'true';
        text = text.slice(key[0].length);
      }
      const action = rowActionFor(cell, text, (typeof row === 'object' && row.action) || explicitAction);
      // VP's "Add X" creates the row and opens the in-place editor on it: capture the row instead
      let created = null;
      const kidsBefore = new Set(M().getChildVertices(cell));
      g.startEditingAtCell = function (c) { created = c; };
      try { cell[rowMethods(cell)[action]](g); } finally { g.startEditingAtCell = orig; }
      // some actions (e.g. addVerticalPartition) add a child without opening the editor
      if (!created) {
        const fresh = M().getChildVertices(cell).filter((k) => !kidsBefore.has(k));
        created = fresh.find(isPartition) || fresh.pop() || null; // partition header, not its compartment
      }
      if (!created) throw new Error(`${action} did not create a row on ${shapeOf(cell)}`);
      setLabel(created, text);
      if (Object.keys(set).length) {
        const v = cell.value.cloneNode(true);
        const el = [...v.getElementsByTagName('*')].filter((n) => n.getAttribute('signature') === text).pop();
        if (!el) throw new Error(`row "${text}" not found to set ${Object.keys(set).join(',')}`);
        for (const [k, val] of Object.entries(set)) el.setAttribute(k, String(val));
        M().setValue(cell, v);
      }
    }
    touched.add(cell);
  };

  const removeRows = (cell, match) => {
    const re = match ? new RegExp(match) : null;
    const v = cell.value.cloneNode(true);
    let n = 0;
    for (const el of [...v.getElementsByTagName('*')]) {
      const sig = el.getAttribute('signature');
      if (sig != null && (!re || re.test(sig))) { el.parentNode.removeChild(el); n++; }
    }
    M().setValue(cell, v);
    // after a save/reload rows are real cells: remove those too
    const kids = (cell.children || []).filter((k) => k.id != null && isRow(k) && (!re || re.test(api.label(k))));
    if (kids.length) G().removeCells(kids, false);
    return n;
  };

  // <fromEnd>/<toEnd> children of a connector value: multiplicity, role, aggregationKind...
  const setEnds = (cell, ends) => {
    if (!cell.value || !cell.value.cloneNode) throw new Error('this connector has no model ends');
    const v = cell.value.cloneNode(true);
    for (const [endName, attrs] of Object.entries(ends)) {
      if (!attrs || !Object.keys(attrs).length) continue;
      let e = [...v.childNodes].find((n) => n.nodeName === endName);
      if (!e) { e = v.ownerDocument.createElement(endName); v.appendChild(e); }
      for (const [k, val] of Object.entries(attrs)) if (val == null || val === '') e.removeAttribute(k); else e.setAttribute(k, String(val));
    }
    M().setValue(cell, v);
    endsDirty.add(cell); // VP does not draw the new texts by itself: see drawEndTexts
  };
  // VP keeps an end's role and multiplicity as text cells it creates from the model in two
  // methods of the connector (one for roles, one for multiplicities). It runs them only after a
  // label edit, which costs ~150 ms per connector, so call them directly once the view is
  // validated. They are recognised by their source (minified names change between releases);
  // if VP changes shape, fall back to a label edit.
  const endsDirty = new Set();
  let endMethods = null;
  const drawEndTexts = (cell) => {
    if (!endMethods) {
      const found = [];
      for (const k of Object.getOwnPropertyNames(cell)) {
        let f; try { f = cell[k]; } catch { continue; }
        if (typeof f !== 'function' || f.length !== 1) continue;
        const s = String(f);
        if (['Role', 'Multiplicity'].some((w) => new RegExp(`return \\w+\\.from${w}CellGeometry`).test(s) && new RegExp(`return \\w+\\.to${w}CellGeometry`).test(s))) found.push(k);
      }
      if (found.length !== 2) return false;
      endMethods = found;
    }
    if (!endMethods.length || !endMethods.every((k) => typeof cell[k] === 'function')) return false;
    try { for (const k of endMethods) cell[k](M()); } // they take the model (getGraph, remove)
    catch { endMethods = []; return false; } // VP changed: label edits from now on
    return true;
  };
  // mult/roles are given as [from, to] in the caller's direction
  const endsFor = (cell, spec) => {
    const sw = connectorSwapped(cell);
    const ends = { fromEnd: {}, toEnd: {} };
    const put = (i, k, val) => { if (val != null) ends[(i === 0) !== sw ? 'fromEnd' : 'toEnd'][k] = val; };
    (spec.mult || []).forEach((v, i) => put(i, 'multiplicity', v));
    (spec.roles || []).forEach((v, i) => put(i, 'role', v));
    return ends;
  };

  // VP draws a connector's texts centred on the line: the line strikes through them, and the
  // role and multiplicity of an end land on the same spot. Move them clear of the line
  // (role on one side, multiplicity on the other; the name beside the line) unless the user
  // already placed them. Needs a validated view, so it runs after the transactions.
  const END_TEXTS = [['fromRoleCell', true, -1], ['fromMultiplicityCell', true, 1], ['toRoleCell', false, -1], ['toMultiplicityCell', false, 1]];
  const isZero = (p) => !p || (!p.x && !p.y);
  const textBox = (cell, text, fallbackSize = 11) => {
    const fs = Number(G().getCellStyle(cell).fontSize) || fallbackSize;
    return String(text).split('\n').reduce((b, line) => {
      const sz = mxUtils.getSizeForString(line, fs, mxConstants.DEFAULT_FONTFAMILY);
      return { w: Math.max(b.w, sz.width), h: b.h + sz.height };
    }, { w: 0, h: 0 });
  };
  // half extent of a w×h box along a unit direction (ux, uy)
  const extent = (box, ux, uy) => Math.abs(ux) * box.w / 2 + Math.abs(uy) * box.h / 2;
  const placeConnectorTexts = () => {
    const g = G(), m = M();
    for (const e of connectors()) {
      const st = g.view.getState(e), abs = st && st.absolutePoints;
      if (!abs || abs.length < 2 || abs.some((p) => !p)) continue;
      const s = g.view.scale, tr = g.view.translate;
      const P = abs.map((p) => ({ x: p.x / s - tr.x, y: p.y / s - tr.y })); // model units
      const lens = P.slice(1).map((p, i) => Math.hypot(p.x - P[i].x, p.y - P[i].y));
      const total = lens.reduce((a, b) => a + b, 0);
      if (!total) continue;
      const unit = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return [(b.x - a.x) / l, (b.y - a.y) / l]; };
      const pointAt = (d) => { // point at path distance d (how mxGraph places a relative label)
        let i = 0;
        while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
        const f = lens[i] ? Math.max(0, Math.min(1, d / lens[i])) : 0;
        return { x: P[i].x + (P[i + 1].x - P[i].x) * f, y: P[i].y + (P[i + 1].y - P[i].y) * f };
      };
      // end texts: centred just outside the element in the direction the line leaves it, one
      // on each side of the line. Stored as a path position plus an absolute offset, so bends
      // near the end (layouts make short first segments) do not drag them back over the shape.
      for (const [k, atFrom, side] of END_TEXTS) {
        const t = e[k];
        if (!t || !m.contains(t) || !t.geometry || !t.geometry.relative) continue;
        const o = t.geometry.offset || { x: 0, y: 0 }, p = t.__vpmcpPos;
        const mine = p && t.geometry.x === p.x && !t.geometry.y && o.x === p.ox && o.y === p.oy;
        if (!mine && (t.geometry.y || !isZero(o))) continue; // placed by the user
        const end = atFrom ? P[0] : P[P.length - 1];
        const [ux, uy] = atFrom ? unit(P[0], P[1]) : unit(P[P.length - 1], P[P.length - 2]);
        const box = textBox(t, api.label(t));
        const along = 6 + extent(box, ux, uy);
        const across = 3 + extent(box, uy, ux); // perpendicular to (ux, uy): same extents swapped
        const cx = end.x + ux * along - uy * across * side, cy = end.y + uy * along + ux * across * side;
        const dist = Math.min(along, total * 0.45);
        const base = pointAt(atFrom ? dist : total - dist);
        const x = Math.round((atFrom ? -1 + 2 * dist / total : 1 - 2 * dist / total) * 1000) / 1000;
        const ox = Math.round(cx - base.x), oy = Math.round(cy - base.y);
        t.__vpmcpPos = { x, ox, oy };
        if (t.geometry.x === x && !t.geometry.y && o.x === ox && o.y === oy) continue;
        const geo = t.geometry.clone();
        geo.x = x; geo.y = 0; geo.offset = new mxPoint(ox, oy);
        m.setGeometry(t, geo);
      }
      // the name sits at half the path length: move it off the line, above (or right of) it
      const text = plainLabel(e);
      if (!text || e.__vpmcpSelf) continue;
      const mine = e.__vpmcpOff && e.geometry.offset && e.geometry.offset.x === e.__vpmcpOff.x && e.geometry.offset.y === e.__vpmcpOff.y;
      if (!mine && !isZero(e.geometry.offset)) continue; // placed by the user
      let half = total / 2, i = 0;
      while (i < lens.length - 1 && half > lens[i]) half -= lens[i++];
      const [ux, uy] = unit(P[i], P[i + 1]);
      let nx = -uy, ny = ux; // unit normal, pointing up (or right on a vertical line)
      if (ny > 0 || (!ny && nx < 0)) { nx = -nx; ny = -ny; }
      const d = extent(textBox(e, text, 12), nx, ny) + 3;
      const off = new mxPoint(Math.round(nx * d), Math.round(ny * d));
      if (mine && off.x === e.__vpmcpOff.x && off.y === e.__vpmcpOff.y) continue;
      const geo = e.geometry.clone();
      geo.offset = off;
      e.__vpmcpOff = { x: off.x, y: off.y };
      m.setGeometry(e, geo);
    }
  };

  // ───────────────────────── sizing ─────────────────────────
  // VP only grows shapes while the user types; grow names/rows that would be clipped.
  const touched = new Set();
  const fitSize = (cell) => {
    if (!M().contains(cell) || !cell.vertex) return;
    const rows = (cell.children || []).filter((k) => isRow(k) && k.geometry);
    const st = G().getCellStyle(cell);
    if (st.verticalLabelPosition === 'bottom' || /actor/i.test(shapeOf(cell))) return; // label outside the shape
    const font = Number(st.fontSize) || 12;
    let max = 0;
    for (const t of [api.label(cell), ...rows.map((k) => api.label(k))]) {
      const plain = String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
      for (const line of plain.split('\n')) max = Math.max(max, mxUtils.getSizeForString(line, font, mxConstants.DEFAULT_FONTFAMILY).width);
    }
    if ((st.fontStyle || 0) & 1) max *= 1.1;
    // non-rectangular outlines need extra room around the text
    const k = `${st.shape} ${shapeOf(cell)}`.toLowerCase();
    const wantW = Math.ceil(/rhombus|decision/.test(k) ? max * 1.6 + 20
      : /ellipse|usecase|oval|circle|cloud|start_/.test(k) ? max * 1.3 + 30
        : /parallelogram|data$|hexagon|mindmapnode|trapezoid|manual|preparation/.test(k) ? max * 1.15 + 40
          // typed BPMN tasks (UserTask, ServiceTask...) draw an icon top-left: keep the centred name clear of it
          : st.shape === 'BPTask' && /.Task$/.test(originId(cell) || '') ? max + 52
            : max + 16);
    const geo = cell.geometry;
    const wantH = rows.length ? Math.ceil(Math.max(...rows.map((k) => k.geometry.y + k.geometry.height)) + 5) : 0;
    if (wantW > geo.width || wantH > geo.height) setGeometry(cell, { w: Math.max(wantW, geo.width), h: Math.max(wantH, geo.height) });
  };

  // ───────────────────────── creation ─────────────────────────
  // Small border items (Port, Pin, parameter/expansion nodes) and stacked containers (Lane).
  const placeAttached = (cell, parent, spec) => {
    const pg = parent.geometry, cg = cell.geometry;
    const st = G().getCellStyle(cell);
    if (st.container == 1 || /lane/i.test(shapeOf(cell))) {
      const pst = G().getCellStyle(parent);
      const start = Number(pst.startSize || 20);
      const lanes = M().getChildVertices(parent).filter((k) => k !== cell && /lane/i.test(shapeOf(k)));
      const vertical = pst.horizontal == 0; // title on the left: lanes stack top-down
      const used = lanes.reduce((s, k) => s + (vertical ? k.geometry.height : k.geometry.width), 0);
      const size = vertical ? (spec.h || cg.height || 150) : (spec.w || cg.width || 150);
      if (vertical) setGeometry(cell, { x: start, y: used, w: Math.max(pg.width - start, spec.w || 0, 300), h: size });
      else setGeometry(cell, { x: used, y: start, w: size, h: Math.max(pg.height - start, spec.h || 0, 300) });
      const total = used + size;
      if (vertical) setGeometry(parent, { w: Math.max(pg.width, start + cell.geometry.width), h: Math.max(pg.height, total) });
      else setGeometry(parent, { w: Math.max(pg.width, total), h: Math.max(pg.height, start + cell.geometry.height) });
      return;
    }
    if (spec.x != null && spec.y != null) return setGeometry(cell, { x: spec.x, y: spec.y });
    const left = /input|parameter/i.test(shapeOf(cell));
    const siblings = M().getChildVertices(parent).filter((k) => k !== cell && !isRow(k) && k.geometry.width <= 30 && (left ? k.geometry.x < pg.width / 2 : k.geometry.x >= pg.width / 2));
    // centred on the edge, further ones alternating below/above: 0, +1, -1, +2, -2...
    const k = siblings.length, step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const y = (pg.height - cg.height) / 2 + step * (cg.height + 12);
    setGeometry(cell, { x: left ? -cg.width / 2 : pg.width - cg.width / 2, y: Math.max(0, Math.min(pg.height - cg.height, y)) });
  };

  api.addElement = (spec) => {
    const g = G(), m = M();
    if (!spec || !spec.shape) throw new Error('element needs a shape (palette id, e.g. "Class")');
    const item = api.findItem(spec.shape, 'shape');
    const parent = spec.parent != null ? api.resolve(spec.parent) : null;
    let cell;
    if (item.kind === 'attached') {
      if (!parent) throw new Error(`${item.id} must be attached to a parent element (set parent)`);
      cell = g.importCells([item.tmpl], 0, 0, parent)[0];
      placeAttached(cell, parent, spec);
      cell.__vpmcpAttached = true;
    } else {
      g.clearSelection();
      const before = new Set(Object.keys(m.cells));
      const s = g.view.scale, t = g.view.translate;
      item.ds.drop(g, new MouseEvent('mouseup'), parent, ((spec.x || 0) + t.x) * s, ((spec.y || 0) + t.y) * s);
      let added = g.getSelectionCells().filter((c) => !before.has(c.id));
      if (!added.length) added = Object.values(m.cells).filter((c) => !before.has(c.id));
      cell = added.find((c) => c.vertex);
      if (!cell) throw new Error(`palette item "${item.id}" inserted nothing`);
      // some templates bring loose connectors along (decision + [guard]/[else]): drop them
      const loose = added.filter((c) => c.edge && (!c.source || !c.target));
      if (loose.length) g.removeCells(loose, true);
      if (parent && cell.parent !== parent) g.moveCells([cell], 0, 0, false, parent);
      setGeometry(cell, { x: spec.x != null ? spec.x : cell.geometry.x, y: spec.y != null ? spec.y : cell.geometry.y, w: spec.w, h: spec.h });
    }
    if (spec.label != null) setLabel(cell, spec.label);
    if (spec.rows && spec.rows.length) addRows(cell, spec.rows, spec.rowAction);
    if (spec.style) applyStyle(cell, spec.style);
    if (spec.w == null) touched.add(cell);
    g.clearSelection();
    return cell;
  };

  // sequence diagrams: a message's height is a connection constraint (0, y - terminalTop)
  const seq = { lastY: null };
  const placeMessage = (e, y) => {
    const g = G(), s = e.source, t = e.target;
    const top = (c) => { let y0 = c.geometry.y; for (let p = c.parent; p && p.geometry && p.vertex; p = p.parent) y0 += p.geometry.y; return y0; };
    if (y == null) y = seq.lastY != null ? seq.lastY + 40 : Math.max(top(s), top(t)) + 80;
    const self = s === t;
    seq.lastY = y + (self ? 25 : 0); // the next message goes below the loop
    g.setConnectionConstraint(e, s, true, new mxConnectionConstraint(new mxPoint(0, y - top(s))));
    g.setConnectionConstraint(e, t, false, new mxConnectionConstraint(new mxPoint(0, y + (self ? 25 : 0) - top(t))));
    if (self) { // a self message is a loop to the right of the lifeline, label beside it
      fitSize(s); // final width first: the loop is anchored on the lifeline centre
      let x0 = s.geometry.x; for (let p = s.parent; p && p.geometry && p.vertex; p = p.parent) x0 += p.geometry.x;
      const cx = x0 + s.geometry.width / 2;
      const geo = e.geometry.clone();
      geo.points = [new mxPoint(cx + 40, y), new mxPoint(cx + 40, y + 25)];
      e.__vpmcpSelf = true;
      M().setGeometry(e, geo);
    }
    for (const c of new Set([s, t])) { // lifelines must reach the message
      const need = y + (self ? 25 : 0) - top(c) + 40;
      if (c.geometry.height < need) setGeometry(c, { h: need });
    }
  };

  api.addConnector = (spec) => {
    const g = G(), m = M();
    if (!spec || !spec.shape) throw new Error('connector needs a shape (e.g. "Association")');
    const item = api.findItem(spec.shape, 'connector');
    let src = api.resolve(spec.from), tgt = api.resolve(spec.to);
    const swapped = isSwapped(item.tmpl);
    if (swapped) [src, tgt] = [tgt, src]; // arrowhead always ends on `to`
    let e;
    m.beginUpdate();
    try {
      e = g.importCells([item.tmpl], 0, 0, g.getDefaultParent())[0];
      g.connectCell(e, src, true);
      g.connectCell(e, tgt, false);
      const geo = e.geometry.clone();
      geo.points = spec.points ? spec.points.map((p) => new mxPoint(p[0], p[1])) : null;
      geo.setTerminalPoint(null, true); geo.setTerminalPoint(null, false);
      m.setGeometry(e, geo);
      if (isMessage(e)) placeMessage(e, spec.y);
    } finally { m.endUpdate(); }
    if (spec.mult || spec.roles) setEnds(e, endsFor(e, spec));
    if (spec.label != null && spec.label !== '') setLabel(e, spec.label);
    if (e.__vpmcpSelf && spec.label) { // self message: label right of the loop, not on it
      const geo = e.geometry.clone();
      geo.offset = new mxPoint(mxUtils.getSizeForString(plainLabel(e), 12, mxConstants.DEFAULT_FONTFAMILY).width / 2 + 8, 0);
      m.setGeometry(e, geo);
    }
    if (spec.style) applyStyle(e, spec.style);
    g.clearSelection();
    return e;
  };

  // ───────────────────────── fast mode ─────────────────────────
  // VP re-renders every label (getBBox) and refreshes the format panel on each change.
  // Suspend both while working; finish (fit shapes, connector texts) and refresh once.
  let fastDepth = 0;
  api.fast = async (fn) => {
    const g = G();
    if (fastDepth) return fn();
    fastDepth = 1;
    itemsCache = scanItems();
    const F = window.Format && Format.prototype;
    const origRefresh = F && F.refresh;
    if (F) F.refresh = function () { };
    // VP's format panel subclasses override refresh: silence the live instance as well
    const fmt = api.ui && api.ui.format;
    const fmtOwn = fmt && Object.prototype.hasOwnProperty.call(fmt, 'refresh') ? fmt.refresh : undefined;
    if (fmt) fmt.refresh = function () { };
    // on every model change VP searches the whole canvas DOM for its 3D-character host
    // (querySelector over thousands of SVG nodes): skip that search while working
    const V = window.mxGraphView && mxGraphView.prototype;
    const hostFinder = V && Object.getOwnPropertyNames(V).find((k) => {
      try { return typeof V[k] === 'function' && !V[k].length && String(V[k]).includes('babylonjs-canvas-host-parent-element'); } catch { return false; }
    });
    const origFinder = hostFinder && V[hostFinder];
    if (hostFinder) V[hostFinder] = function () { return null; };
    // a drop lands at a provisional spot before we move it: don't let it stretch the container
    const ext = { extendParents: g.extendParents, extendParentsOnAdd: g.extendParentsOnAdd, extendParentsOnMove: g.extendParentsOnMove };
    g.extendParents = g.extendParentsOnAdd = g.extendParentsOnMove = false;
    g.view.rendering = false;
    try { return await fn(); } finally {
      try {
        Object.assign(g, ext);
        g.view.rendering = true;
        g.clearSelection();
        try { window.getSelection().removeAllRanges(); } catch { }
        g.refresh(); // VP lays out compartment rows while rendering: sizes are final only now
        finishFast(g);
      } finally {
        touched.clear();
        endsDirty.clear();
        if (hostFinder) V[hostFinder] = origFinder;
        if (F) F.refresh = origRefresh;
        if (fmt) { if (fmtOwn) fmt.refresh = fmtOwn; else delete fmt.refresh; }
        fastDepth = 0;
        itemsCache = null;
        seq.lastY = null;
      }
    }
  };
  // Final sizes, then VP's end texts and the placement of every connector text against the
  // resulting view (the format panel and the 3D-host search are still muted).
  const finishFast = (g) => {
    const list = [...touched];
    if (list.length) {
      M().beginUpdate();
      try { list.forEach(fitSize); growContainers(list); } finally { M().endUpdate(); }
    }
    if (!connectors().length) return;
    g.view.validate();
    M().beginUpdate();
    try {
      for (const e of endsDirty) if (M().contains(e) && !drawEndTexts(e)) setLabel(e, api.label(e));
      placeConnectorTexts();
    } finally { M().endUpdate(); }
  };

  // Containers (system, node, package, pool, lane...) grow to hold their children, innermost first.
  const growContainers = (cells) => {
    const parents = new Set();
    for (const c of cells) for (let p = M().contains(c) ? c.parent : null; p && p.vertex; p = p.parent) parents.add(p);
    const depth = (c) => { let d = 0; for (let p = c.parent; p && p.vertex; p = p.parent) d++; return d; };
    for (const p of [...parents].sort((a, b) => depth(b) - depth(a))) {
      const kids = M().getChildVertices(p).filter((k) => !isRow(k) && !k.__vpmcpAttached);
      if (!kids.length) continue;
      const lanes = kids.every((k) => /lane/i.test(shapeOf(k)));
      const pad = lanes ? 0 : 20;
      const right = Math.max(...kids.map((k) => k.geometry.x + k.geometry.width)) + pad;
      const bottom = Math.max(...kids.map((k) => k.geometry.y + k.geometry.height)) + pad;
      if (right > p.geometry.width || bottom > p.geometry.height) setGeometry(p, { w: Math.max(right, p.geometry.width), h: Math.max(bottom, p.geometry.height) });
    }
  };

  // ───────────────────────── layout ─────────────────────────
  const gridPlace = (cells, parent, opts) => {
    if (!cells.length) return;
    const gap = opts.spacing || (parent ? 30 : 70);
    const colW = Math.max(...cells.map((c) => c.geometry.width));
    const pw = parent && opts.parentW;
    const cols = opts.columns || (pw ? Math.max(1, Math.floor((pw - 60 + gap) / (colW + gap)))
      : Math.max(1, Math.ceil(Math.sqrt(cells.length * (parent ? 1 : 1.6)))));
    const x0 = parent ? 30 : 40;
    let y = parent ? 50 : 40;
    if (!parent && opts.below) y = opts.below;
    let rowH = 0;
    cells.forEach((c, i) => {
      if (i && i % cols === 0) { y += rowH + gap; rowH = 0; }
      setGeometry(c, { x: x0 + (i % cols) * (colW + gap) + (colW - c.geometry.width) / 2, y });
      rowH = Math.max(rowH, c.geometry.height);
    });
    if (parent) {
      const kids = M().getChildVertices(parent).filter((k) => !isRow(k));
      const right = Math.max(...kids.map((k) => k.geometry.x + k.geometry.width)) + 30;
      const bottom = Math.max(...kids.map((k) => k.geometry.y + k.geometry.height)) + 30;
      setGeometry(parent, { w: Math.max(opts.parentW || 0, right), h: Math.max(opts.parentH || 0, bottom) });
    }
  };

  api.layout = (kind = 'hierarchical', opts = {}) => {
    const g = G(), m = M();
    const parent = g.getDefaultParent();
    const tops = m.getChildVertices(parent);
    if (!tops.length) return 'nothing to lay out';
    m.beginUpdate();
    try {
      if (kind === 'grid') gridPlace(tops, null, opts);
      else {
        let layout;
        if (kind === 'hierarchical' || kind === 'horizontal') {
          layout = new mxHierarchicalLayout(g, kind === 'horizontal' ? mxConstants.DIRECTION_WEST : mxConstants.DIRECTION_NORTH);
          layout.intraCellSpacing = opts.spacing || 60; layout.interRankCellSpacing = opts.rankSpacing || 90;
        } else if (kind === 'organic') {
          layout = new mxFastOrganicLayout(g); layout.forceConstant = opts.spacing || 160;
        } else if (kind === 'tree') {
          layout = new mxCompactTreeLayout(g, false); layout.levelDistance = opts.rankSpacing || 60; layout.nodeDistance = opts.spacing || 40;
        } else throw new Error(`unknown layout "${kind}": use grid, hierarchical, horizontal, organic or tree`);
        layout.execute(parent);
        // keep a 40px margin from the origin; the connectors' waypoints move with their shapes
        const xs = tops.map((c) => c.geometry.x), ys = tops.map((c) => c.geometry.y);
        g.moveCells(tops.concat(m.getChildEdges(parent)), 40 - Math.min(...xs), 40 - Math.min(...ys));
      }
      // only the hierarchical layouts route connectors: elsewhere old waypoints now point at
      // empty space, so drop them (loops and sequence messages keep theirs) and fan out again
      if (kind !== 'hierarchical' && kind !== 'horizontal') {
        for (const e of connectors()) {
          if (e.source === e.target || isMessage(e) || !(e.geometry.points && e.geometry.points.length)) continue;
          const geo = e.geometry.clone();
          geo.points = null;
          m.setGeometry(e, geo);
        }
        spreadParallel();
      }
    } finally { m.endUpdate(); }
    return `layout ${kind} applied to ${tops.length} elements`;
  };

  // ───────────────────────── build ─────────────────────────
  // One call for a whole diagram: elements (parents first), auto-placement, connectors.
  api.build = (spec) => api.fast(async () => {
    const out = { elements: [], connectors: [], errors: [] };
    if (spec.clear) {
      const g = G();
      g.removeCells(G().getModel().getChildCells(g.getDefaultParent()), true);
      api.keys = {};
    }
    const els = spec.elements || [];
    const keyOf = (e, i) => e.key || e.label || `${e.shape}#${i}`;
    const byKey = new Map(els.map((e, i) => [keyOf(e, i), e]));
    const depth = (e, n = 0) => (e.parent && byKey.has(e.parent) && n < 25 ? depth(byKey.get(e.parent), n + 1) + 1 : 0);
    const order = els.map((e, i) => ({ e, i, d: depth(e) })).sort((a, b) => a.d - b.d || a.i - b.i);
    const auto = new Map(); // parentId|'' -> cells without coordinates
    const specOf = new Map();
    const created = [];
    // Each phase is ONE model transaction: VP revalidates the whole view on every committed
    // change, so batching is ~10x faster on big diagrams. Shape sizes (class heights...) are
    // only final after a commit, hence the separate phases.
    const m = M();
    m.beginUpdate(); // phase 1: elements, labels, rows
    try {
      for (const { e, i } of order) {
        const key = keyOf(e, i);
        try {
          const cell = api.addElement(e);
          if (e.key) api.keys[e.key] = cell.id; // labels resolve by search (ambiguity stays visible)
          specOf.set(cell.id, e);
          created.push(cell);
          out.elements.push(`${key}#${shortId(cell)}`);
          if ((e.x == null || e.y == null) && !cell.__vpmcpAttached) {
            const pk = cell.parent && cell.parent.vertex ? cell.parent.id : '';
            (auto.get(pk) || auto.set(pk, []).get(pk)).push(cell);
          }
        } catch (err) { out.errors.push(`element ${key}: ${err.message}`); }
      }
    } finally { m.endUpdate(); }
    m.beginUpdate(); // phase 2: real sizes, auto-placement, containers
    try {
      created.filter((c) => specOf.get(c.id).w == null).forEach(fitSize);
      // innermost containers first so their final size is known before placing them
      const groups = [...auto.entries()].sort((a, b) => depthOf(b[0]) - depthOf(a[0]));
      for (const [pid, cells] of groups) {
        const parent = pid ? m.getCell(pid) : null;
        const ps = parent ? specOf.get(parent.id) || {} : {};
        let below = null;
        if (!parent) {
          const placed = elements().filter((c) => c.parent === G().getDefaultParent() && !cells.includes(c));
          if (placed.length) below = Math.max(...placed.map((c) => c.geometry.y + c.geometry.height)) + 70;
        }
        gridPlace(cells, parent, { columns: parent ? null : spec.columns, parentW: ps.w, parentH: ps.h, below });
      }
      growContainers(created);
    } finally { m.endUpdate(); }
    m.beginUpdate(); // phase 3: connectors
    try {
      for (const [i, c] of (spec.connectors || []).entries()) {
        const key = c.key || `${c.from}→${c.to}`;
        try {
          const e = api.addConnector(c);
          if (c.key) api.keys[c.key] = e.id;
          out.connectors.push(`#${shortId(e)}`);
        } catch (err) { out.errors.push(`connector ${i} (${c.shape} ${key}): ${err.message}`); }
      }
      spreadParallel();
    } finally { m.endUpdate(); }
    if (spec.layout && spec.layout !== 'none') api.layout(spec.layout, {});
    return out;
  });
  // Connectors sharing the same two ends would be drawn on top of each other: fan them out with
  // one waypoint each, perpendicular to the line between the (absolute) centres. Sequence
  // messages and connectors with explicit waypoints are left alone.
  const absCenter = (c) => {
    let x = c.geometry.x + c.geometry.width / 2, y = c.geometry.y + c.geometry.height / 2;
    for (let p = c.parent; p && p.vertex && p.geometry; p = p.parent) { x += p.geometry.x; y += p.geometry.y; }
    return { x, y };
  };
  const spreadParallel = () => {
    const groups = new Map();
    for (const e of connectors()) {
      if (!e.source || !e.target || e.source === e.target || isMessage(e)) continue;
      const k = [e.source.id, e.target.id].sort().join('|');
      (groups.get(k) || groups.set(k, []).get(k)).push(e);
    }
    for (const es of groups.values()) {
      if (es.length < 2) continue;
      const free = es.filter((e) => !(e.geometry.points && e.geometry.points.length) || e.__vpmcpSpread);
      if (free.length < 2) continue;
      const a = absCenter(es[0].source), b = absCenter(es[0].target);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      free.forEach((e, i) => {
        const off = (i - (free.length - 1) / 2) * 36;
        const geo = e.geometry.clone();
        geo.points = off ? [new mxPoint((a.x + b.x) / 2 + nx * off, (a.y + b.y) / 2 + ny * off)] : null;
        e.__vpmcpSpread = true;
        M().setGeometry(e, geo);
      });
    }
  };

  const depthOf = (id) => { let d = 0; for (let c = id ? M().getCell(id) : null; c && c.parent && c.parent.vertex; c = c.parent) d++; return d + (id ? 1 : 0); };

  // ───────────────────────── edit ─────────────────────────
  const OPS = 'label{ref,text} move{ref,x,y} resize{ref,w,h} rows{ref,rows,rowAction?} removeRows{ref,match?} ends{ref,mult?,roles?} style{ref,style} delete{ref} add{element fields} connect{connector fields} layout{kind} fit{ref}';
  api.edit = (ops) => api.fast(async () => {
    const res = [];
    const m = M();
    m.beginUpdate(); // one transaction for the batch (see build)
    try {
    for (const [i, op] of (ops || []).entries()) {
      try {
        let target; // resolved once: a rename must not break the op's own reference
        const need = () => target || (target = api.resolve(op.ref));
        const req = (...fields) => { const miss = fields.filter((f) => op[f] == null); if (miss.length) throw new Error(`${op.op} needs ${miss.join(', ')}`); };
        let msg = 'ok';
        switch (op.op) {
          case 'label': req('text'); setLabel(need(), op.text); touched.add(need()); break;
          case 'move': if (op.x == null && op.y == null) req('x', 'y'); setGeometry(need(), { x: op.x, y: op.y }); break;
          case 'resize': if (op.w == null && op.h == null) req('w', 'h'); setGeometry(need(), { w: op.w, h: op.h }); break;
          case 'rows': req('rows'); addRows(need(), op.rows, op.rowAction); break;
          case 'removeRows': msg = `${removeRows(need(), op.match)} rows removed`; touched.add(need()); break;
          case 'ends': if (!op.mult && !op.roles) req('mult'); setEnds(need(), endsFor(need(), op)); break;
          case 'style': req('style'); applyStyle(need(), op.style); break;
          case 'delete': { const c = need(); G().removeCells([c], true); msg = `deleted #${shortId(c)}`; break; }
          case 'add': { const c = api.addElement(op); if (op.key) api.keys[op.key] = c.id; msg = `${op.key || op.label || op.shape}#${shortId(c)}`; break; }
          case 'connect': { const e = api.addConnector(op); if (op.key) api.keys[op.key] = e.id; msg = `#${shortId(e)}`; break; }
          case 'layout': { // needs committed sizes: close the transaction around it
            m.endUpdate();
            try { const list = [...touched]; list.forEach(fitSize); msg = api.layout(op.kind, op); } finally { m.beginUpdate(); }
            break;
          }
          case 'fit': touched.add(need()); break;
          default: throw new Error(`unknown op "${op.op}". Ops: ${OPS}`);
        }
        res.push(`${i} ${msg}`);
      } catch (err) { res.push(`${i} ERROR ${err.message}`); }
    }
    if (ops.some((o) => o.op === 'connect')) spreadParallel();
    } finally { m.endUpdate(); }
    return res.join('\n');
  });

  // ───────────────────────── inspect ─────────────────────────
  const termName = (c, counts) => { if (!c) return '?'; const l = plainLabel(c); return l && counts[l] === 1 ? l : '#' + shortId(c); };
  const stereo = (c) => {
    const v = c.value; if (!v || !v.getElementsByTagName) return '';
    const st = [...v.getElementsByTagName('Stereotype')].filter((n) => n.parentNode && n.parentNode.parentNode === v).map((n) => n.getAttribute('name')).filter(Boolean);
    return st.length ? `«${st.join(',')}»` : '';
  };
  const describe = (c, counts, detail) => {
    const id = shortId(c), lab = plainLabel(c);
    const type = originId(c) || `${shapeOf(c)}${stereo(c)}`; // same id vp_build takes
    if (c.edge) {
      const sw = connectorSwapped(c);
      const endStr = (name) => {
        const n = [...((c.value && c.value.childNodes) || [])].find((x) => x.nodeName === name);
        if (!n) return '';
        const at = [...n.attributes].filter((a) => !/vpId$|^aggregationKind$/i.test(a.name)).sort((a, b) => (b.name === 'multiplicity') - (a.name === 'multiplicity'));
        return at.length ? `{${at.map((a) => (a.name === 'multiplicity' ? a.value : `${a.name}=${a.value}`)).join(',')}}` : '';
      };
      const [a, b] = sw ? [c.target, c.source] : [c.source, c.target];
      const [ea, eb] = sw ? [endStr('toEnd'), endStr('fromEnd')] : [endStr('fromEnd'), endStr('toEnd')];
      return `#${id} ${type} ${termName(a, counts)}${ea === '{}' ? '' : ea} -> ${termName(b, counts)}${eb === '{}' ? '' : eb}${lab ? ` "${lab}"` : ''}`;
    }
    const geo = c.geometry;
    const rows = (c.children || []).filter(isRow).map(plainLabel).filter(Boolean);
    const par = c.parent && c.parent.vertex ? ` in ${termName(c.parent, counts)}` : '';
    const pos = detail === 'brief' ? '' : ` @${Math.round(geo.x)},${Math.round(geo.y)} ${Math.round(geo.width)}x${Math.round(geo.height)}`;
    const rowStr = rows.length ? (detail === 'brief' ? ` (${rows.length} rows)` : ` [${rows.join('; ')}]`) : '';
    return `#${id} ${type} "${lab}"${pos}${par}${rowStr}`;
  };
  api.inspect = (opts = {}) => {
    const detail = opts.detail || 'full';
    let vs = elements(), es = connectors();
    const counts = {};
    for (const c of vs) { const l = plainLabel(c); counts[l] = (counts[l] || 0) + 1; }
    if (opts.ref != null) {
      const root = api.resolve(opts.ref);
      const inside = (c) => { for (let p = c; p; p = p.parent) if (p === root) return true; return false; };
      vs = vs.filter(inside);
      es = es.filter((e) => e === root || inside(e) || vs.includes(e.source) || vs.includes(e.target));
    }
    let lines = [...vs, ...es].map((c) => describe(c, counts, detail));
    if (opts.filter) { const f = String(opts.filter).toLowerCase(); lines = lines.filter((l) => l.toLowerCase().includes(f)); }
    const st = api.status();
    const head = `"${st.title}" ${st.type || ''} | ${elements().length} elements, ${connectors().length} connectors${st.saved ? '' : ' | unsaved'}`;
    const limit = opts.limit || 150;
    const more = lines.length - limit;
    if (more > 0) lines = lines.slice(0, limit).concat(`… ${more} more lines: narrow with filter, ref, or detail:"brief"`);
    return [head, ...lines].join('\n');
  };

  api.status = () => ({
    title: document.title.replace(/ \| Visual Paradigm Online$/, ''),
    type: (/[#&]type=([^&]+)/.exec(location.hash) || [])[1] || null,
    saved: /[#&]id=\d+/.test(location.hash),
    workspace: (/\/w\/([^/]+)\//.exec(location.pathname) || /[#&]workspace=([^&]+)/.exec(location.hash) || [])[1] || null,
    // signed-in editors live under /w/<workspace>/ or carry workspace= in the hash; anonymous
    // (session expired) ones fall back to /app/diagrams without it
    signedIn: /^\/w\//.test(location.pathname) || /[#&]workspace=/.test(location.hash),
    url: location.href,
  });

  api.runAction = (name) => {
    const a = api.ui.actions.get(name);
    if (!a) throw new Error(`no editor action "${name}"`);
    Object.values(a).find((v) => typeof v === 'function').call(a);
  };

  // exposed for vp_eval
  Object.assign(api, { shapeOf, shortId, plainLabel, isRow, setLabel, setGeometry, setEnds, addRows, removeRows, rowMethods, fitSize, applyStyle });
  window.__vpmcp = api;
})();
