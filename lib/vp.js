// Node-side controller: page lifecycle, injection of the in-page API, save, screenshot.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContext, findDiagramPage, isDiagramUrl, PROFILE } from './browser.js';

const RAW_API = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page-api.js'), 'utf8');
// version = content hash, so an edited page-api replaces a stale copy already in the page
const PAGE_VERSION = crypto.createHash('sha1').update(RAW_API).digest('hex').slice(0, 10);
const PAGE_API = RAW_API.replace(/const VERSION = [^;]+;/, `const VERSION = '${PAGE_VERSION}';`);

let current = null; // the diagram tab being driven

// The user's workspace (e.g. "my-team"): from VP_WORKSPACE, any open tab
// (/w/<ws>/ path or workspace=<ws> hash parameter) or the value remembered last time.
// Opening the right base URL avoids a redirect after the editor has loaded.
const STATE_FILE = path.join(PROFILE, '..', 'state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
const workspaceOf = (u) => ((/online\.visual-paradigm\.com\/w\/([^/#?]+)\//.exec(u) || /[#&]workspace=([^&]+)/.exec(u) || [])[1]) || null;
export function rememberWorkspace(u) {
  const ws = workspaceOf(u);
  if (ws && readState().workspace !== ws) try { fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), workspace: ws })); } catch { }
  return ws;
}
async function diagramBase() {
  let ws = process.env.VP_WORKSPACE || null;
  if (!ws) for (const p of (await getContext()).pages()) if ((ws = rememberWorkspace(p.url()))) break;
  if (!ws) ws = readState().workspace || null;
  return ws ? `https://online.visual-paradigm.com/w/${ws}/diagrams/` : 'https://online.visual-paradigm.com/app/diagrams/';
}

// VP may rewrite or redirect the URL right after loading: wait until it stays put.
async function settle(page) {
  let last = page.url();
  for (let i = 0, stable = 0; i < 40 && stable < 4; i++) {
    await page.waitForTimeout(250);
    const u = page.url();
    stable = u === last ? stable + 1 : 0;
    last = u;
  }
  rememberWorkspace(last);
}

const DESTROYED = /Execution context was destroyed|Target (page, context or browser )?closed|frame was detached|__vpmcp|reading '(build|edit|inspect|palette|status|items)'|editor not attached/i;
/** Run fn(page) on the editor; if the page navigated underneath us, re-attach and retry once. */
export async function withEditor(fn) {
  try { return await fn(await editor()); }
  catch (e) {
    if (!DESTROYED.test(String(e && e.message))) throw e;
    await settle(current);
    return fn(await editor());
  }
}

async function waitEditor(page) {
  await page.waitForFunction(
    () => typeof EditorUi !== 'undefined' && document.querySelector('.geDiagramContainer') && document.querySelector('.geSidebarContainer a.geItem'),
    null, { timeout: 90000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape').catch(() => {}); // "what's new" and similar popups
}

/** The current diagram page with the in-page API attached. */
export async function editor() {
  if (!current || current.isClosed() || !isDiagramUrl(current.url())) {
    current = await findDiagramPage();
    if (current) await current.bringToFront().catch(() => {}); // the active tab is not throttled
  }
  if (!current) throw new Error('No diagram is open: call vp_open {type} for a new one or vp_open {url} for an existing one.');
  const ready = await current.evaluate((v) => !!(window.__vpmcp && window.__vpmcp.version === v && window.__vpmcp.g), PAGE_VERSION).catch(() => false);
  if (!ready) {
    await waitEditor(current);
    await current.evaluate(PAGE_API);
    let ok = await current.evaluate(() => window.__vpmcp.init());
    if (!ok) { // fall back to real mouse movement over the canvas
      const box = await current.locator('.geDiagramContainer').boundingBox();
      await current.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await current.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5);
      ok = await current.evaluate(() => window.__vpmcp.init());
    }
    if (!ok) throw new Error('Could not attach to the VP editor (VP internals changed?). Reload the tab and retry.');
  }
  await current.evaluate(() => { window.__vpmcpTouched = Date.now(); });
  return current;
}

export async function newDiagram(type) {
  const ctx = await getContext();
  const url = `${await diagramBase()}#diagram:proj=0&type=${encodeURIComponent(type)}&width=11&height=8.5&unit=inch`;
  if (!current || current.isClosed()) current = await findDiagramPage();
  const page = current && !current.isClosed() ? current : await ctx.newPage();
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  current = page;
  await editor();
  await settle(page);
  return editor();
}

export async function open(url) {
  if (!/online\.visual-paradigm\.com/.test(url)) throw new Error('url must be a Visual Paradigm Online diagram link');
  const ctx = await getContext();
  if (!current || current.isClosed()) current = await findDiagramPage();
  const page = current && !current.isClosed() ? current : await ctx.newPage();
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  current = page;
  await editor();
  await settle(page);
  return editor();
}

/**
 * Save to the VP cloud. Untitled diagram: "Save as" with `name` (default "Untitled diagram").
 * Saved diagram: Ctrl+S; with a different `name`, "Save as" creates a copy with that name.
 */
export async function save(page, name) {
  const st = await page.evaluate(() => window.__vpmcp.status());
  if (!st.signedIn) throw new Error('Not signed in to VP Online (session expired?): ask the user to log in once in the MCP Chrome window, then retry vp_save. The diagram stays open meanwhile.');
  await page.keyboard.press('Escape');
  await page.locator('.geDiagramContainer').click({ position: { x: 5, y: 5 }, timeout: 1500 }).catch(() => {});
  await page.keyboard.press('Escape');
  const copy = st.saved && name && name !== st.title;
  if (copy) await page.evaluate(() => window.__vpmcp.runAction('saveAs'));
  else await page.keyboard.press('Control+s');
  // the "Save as" dialog lives in a shadow root: use piercing locators
  const input = page.getByLabel('File name').first();
  const dialog = await input.waitFor({ state: 'visible', timeout: st.saved && !copy ? 2500 : 8000 }).then(() => true).catch(() => false);
  if (dialog) {
    await input.fill(name || (st.title && st.title !== 'Untitled' ? st.title : 'Untitled diagram'));
    const btn = page.getByRole('button', { name: /^save$/i }).last();
    // "Save as" on a stored diagram only enables SAVE once a storage medium is picked
    if (!(await btn.isEnabled())) await page.getByText('Visual Paradigm Workspace', { exact: true }).first().click();
    await btn.click({ timeout: 10000 });
  } else if (!st.saved) {
    throw new Error('The save dialog did not appear. Check the MCP Chrome window (are you logged in to VP Online?).');
  }
  const want = name || null;
  await page.waitForFunction((want) => /[#&]id=\d+/.test(location.hash) && !/^Untitled \|/.test(document.title)
    && (!want || document.title.startsWith(want)), want, { timeout: 30000 })
    .catch(() => { throw new Error('Save did not complete. Check the MCP Chrome window: you must be logged in to VP Online to save.'); });
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__vpmcp.status());
}

/**
 * PNG/JPEG of the diagram cropped to its content (or to one element with `ref`).
 * Zoom: fit to the visible canvas, never above `scale` (default 1).
 */
export async function screenshot(page, { file, ref, scale = 1, quality = 70 } = {}) {
  const clip = await page.evaluate(({ ref, scale }) => {
    const api = window.__vpmcp, g = api.g;
    g.clearSelection();
    try { window.getSelection().removeAllRanges(); } catch { }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const st = document.createElement('style');
    st.id = 'vpmcp-shot';
    st.textContent = '.geToolbarContainer,.vpDiagramInnerFloatingBar,.bindingModeBar,.geContextBarContainer,.geHint,.vpPageResource{visibility:hidden!important}';
    document.head.appendChild(st);
    let cells = null;
    if (ref) cells = [api.resolve(ref)];
    const c = g.container;
    const boundsAt = () => (cells ? g.view.getBounds(cells) : g.getGraphBounds());
    let b = boundsAt();
    if (!b || b.width === 0) return null;
    const s0 = g.view.scale;
    const fitScale = Math.min((c.clientWidth - 40) / (b.width / s0), (c.clientHeight - 40) / (b.height / s0));
    g.zoomTo(Math.max(0.1, Math.min(scale, fitScale)));
    b = boundsAt();
    c.scrollLeft = Math.max(0, b.x - 20); c.scrollTop = Math.max(0, b.y - 20);
    b = boundsAt();
    const r = c.getBoundingClientRect();
    // visible canvas only: the client area excludes the scrollbars
    const right = r.left + c.clientLeft + c.clientWidth, bottom = r.top + c.clientTop + c.clientHeight;
    const x = Math.max(r.left, r.left + b.x - c.scrollLeft - 12), y = Math.max(r.top, r.top + b.y - c.scrollTop - 12);
    return {
      x, y,
      width: Math.min(right - x, b.width + 24 + Math.min(0, r.left + b.x - c.scrollLeft - 12 - r.left)),
      height: Math.min(bottom - y, b.height + 24 + Math.min(0, r.top + b.y - c.scrollTop - 12 - r.top)),
    };
  }, { ref, scale });
  try {
    if (!clip) throw new Error('The diagram is empty: nothing to capture.');
    await page.waitForTimeout(200);
    const opts = { clip, scale: 'css' };
    if (file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      await page.screenshot({ ...opts, path: file, type: /\.jpe?g$/i.test(file) ? 'jpeg' : 'png' });
      return null;
    }
    return (await page.screenshot({ ...opts, type: 'jpeg', quality })).toString('base64');
  } finally {
    await page.evaluate(() => document.getElementById('vpmcp-shot')?.remove()).catch(() => {});
  }
}
