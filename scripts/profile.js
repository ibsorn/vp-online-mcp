// Dev helper: CPU-profile a snippet in the editor tab and print the hottest functions.
//   node scripts/profile.js <file.js | -e "code">
import fs from 'node:fs';
import { findDiagramPage } from '../lib/browser.js';

const arg = process.argv[2];
const code = arg === '-e' ? process.argv[3] : fs.readFileSync(arg, 'utf8');
const page = await findDiagramPage();
if (!page) throw new Error('no diagram tab open');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const res = await page.evaluate(`(async () => { ${code} })()`);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
// inclusive time: walk parents
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
profile.samples.forEach((id, i) => { const seen = new Set(); for (let n = id; n != null; n = parent.get(n)) { const f = byId.get(n).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`; if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0)); } });
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)}ms ${k}`).join('\n');
console.log('result:', JSON.stringify(res));
console.log('\nSELF\n' + top(self, 25));
console.log('\nINCLUSIVE\n' + top(incl, 40));
process.exit(0);
