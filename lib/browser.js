// Manages a dedicated Chrome instance (own profile, remote debugging port) that
// survives MCP restarts, so the user only has to log in to VP Online once.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.VP_MCP_PORT || 9333);
export const PROFILE = process.env.VP_MCP_PROFILE || path.join(os.homedir(), '.vp-online-mcp', 'chrome-profile');
export const VP_HOME = 'https://online.visual-paradigm.com/drive/';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function ensureChrome() {
  if (await cdpAlive()) return false;
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1500,950',
    VP_HOME,
  ];
  if (process.env.VP_MCP_HEADLESS === '1') args.unshift('--headless=new');
  const child = spawn(findChrome(), args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpAlive()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chrome did not open the debugging port ${PORT}`);
}

let browser = null;

export async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  await ensureChrome();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

export async function getContext() {
  const b = await getBrowser();
  return b.contexts()[0] || (await b.newContext());
}

export const isDiagramUrl = (u) => /online\.visual-paradigm\.com\/.*diagrams/.test(u) && /#diagram:/.test(u);

/** Returns the diagram editor page used most recently by the MCP (or the last one), or null. */
export async function findDiagramPage() {
  const ctx = await getContext();
  const pages = ctx.pages().filter((p) => isDiagramUrl(p.url()));
  let best = null, bestT = -1;
  for (const p of pages) {
    const t = await p.evaluate(() => window.__vpmcpTouched || 0).catch(() => -1);
    if (t >= bestT) { best = p; bestT = t; }
  }
  return best;
}

export async function anyPage() {
  const ctx = await getContext();
  return ctx.pages()[0] || (await ctx.newPage());
}
