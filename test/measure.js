// Prints the size of the tool definitions (what every conversation pays) per tool.
//   node test/measure.js              sizes per tool + total
//   node test/measure.js vp_build     also the full JSON definition of the named tools
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'measure', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server.js', import.meta.url))] }));
const { tools } = await client.listTools();
const instr = client.getInstructions?.() || '';
let total = 0;
for (const t of tools) { const n = JSON.stringify(t).length; total += n; console.log(String(n).padStart(6), t.name); }
console.log(String(instr.length).padStart(6), '(server instructions)');
console.log(`TOTAL ${total + instr.length} chars ~ ${Math.round((total + instr.length) / 3.8)} tokens, ${tools.length} tools`);
for (const t of tools.filter((t) => process.argv.slice(2).includes(t.name))) console.log(`\n${JSON.stringify(t)}`);
await client.close();
