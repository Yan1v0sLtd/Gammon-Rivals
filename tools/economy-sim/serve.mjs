// Tiny zero-dependency static server for the sim output (local viewing only).
// Run: node tools/economy-sim/serve.mjs   ->  http://localhost:8123/report.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.csv': 'text/csv' };

createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = join(OUT, rel === '/' ? 'report.html' : rel);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8123, () => console.log('economy-sim report at http://localhost:8123/report.html'));
