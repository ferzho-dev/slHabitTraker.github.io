import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'node_modules/@tabler/icons');
const outputRoot = path.join(root, 'public/tabler-icons');
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'icons.json'), 'utf8'));
const outline = JSON.parse(await readFile(path.join(packageRoot, 'tabler-nodes-outline.json'), 'utf8'));

const compactCatalog = Object.entries(metadata).map(([name, icon]) => [name, icon.tags ?? []]);
await mkdir(path.join(outputRoot, 'nodes'), { recursive: true });
await writeFile(path.join(outputRoot, 'catalog.json'), JSON.stringify(compactCatalog));

const shards = new Map();
for (const [name, nodes] of Object.entries(outline)) {
  const first = name[0]?.toLowerCase() ?? 'other';
  const key = /^[a-z0-9]$/.test(first) ? first : 'other';
  if (!shards.has(key)) shards.set(key, {});
  shards.get(key)[name] = nodes;
}

const nodeRoot = path.join(outputRoot, 'nodes');
const validFiles = new Set();
for (const [key, nodes] of shards) {
  const filename = `${key}.json`;
  validFiles.add(filename);
  await writeFile(path.join(nodeRoot, filename), JSON.stringify(nodes));
}
for (const filename of await readdir(nodeRoot)) {
  if (filename.endsWith('.json') && !validFiles.has(filename)) await rm(path.join(nodeRoot, filename));
}

console.log(`Generated Tabler catalog (${compactCatalog.length} entries) and ${shards.size} lazy SVG data shards.`);
