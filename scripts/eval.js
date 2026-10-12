// Dev helper: node scripts/eval.js <file.js | -e "code">  -> evaluates in the diagram page.
import fs from 'node:fs';
import { findDiagramPage, anyPage } from '../lib/browser.js';

const arg = process.argv[2];
const code = arg === '-e' ? process.argv[3] : fs.readFileSync(arg, 'utf8');
const page = (await findDiagramPage()) || (await anyPage());
const res = await page.evaluate(`(async () => { ${code} })()`);
console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
process.exit(0); // Chrome keeps running

