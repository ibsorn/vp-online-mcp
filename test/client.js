// Manual tool calls from the command line (spawns the MCP server over stdio).
//   node test/client.js <tool> '<json args>' [<tool> '<json args>' ...]
//   node test/client.js vp_build @examples/class.json      args read from a file
//   node test/client.js vp_eval @js:snippet.js              file body sent as {code}
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'cli', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server.js', import.meta.url))] }));
const calls = process.argv.slice(2);
for (let i = 0; i < calls.length; i += 2) {
  const t0 = Date.now();
  let a = calls[i + 1] || '{}';
  if (a.startsWith('@js:')) a = JSON.stringify({ code: fs.readFileSync(a.slice(4), 'utf8') });
  else if (a.startsWith('@')) a = fs.readFileSync(a.slice(1), 'utf8');
  const r = await client.callTool({ name: calls[i], arguments: JSON.parse(a) }, undefined, { timeout: 600000 });
  for (const c of r.content) console.log(`[${calls[i]} ${Date.now() - t0}ms]`, c.type === 'text' ? c.text : `<${c.type} ${c.data.length}b>`);
}
await client.close();
