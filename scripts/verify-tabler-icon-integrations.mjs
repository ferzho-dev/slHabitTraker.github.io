import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { requiredTablerVueIcons } from '../src/components/requiredTablerVueIcons.js';

const names = Object.keys(requiredTablerVueIcons);
assert.equal(names.length, 23, `Expected 23 mandatory icons, received ${names.length}`);

for (const name of names) {
  const component = requiredTablerVueIcons[name];
  assert.ok(component, `${name}: Vue component export is missing`);
  const svgFile = new URL(`../node_modules/@tabler/icons/icons/outline/${name}.svg`, import.meta.url);
  const localSvg = await readFile(svgFile, 'utf8');
  assert.match(localSvg, /stroke-width="2"/, `${name}: local Tabler SVG must use stroke width 2`);
  const rendered = await renderToString(createSSRApp({ render: () => h(component, { size: 24, stroke: 2 }) }));
  assert.match(rendered, /<svg\b/, `${name}: Vue component did not render an SVG`);
  assert.match(rendered, /stroke-width="2"/, `${name}: rendered component does not use stroke width 2`);
  assert.match(rendered, /<path\b/, `${name}: rendered SVG has no path data`);
  console.log(`✓ Icon${name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')} · ${name}`);
}

console.log(`Verified ${names.length} official Vue icon components and local SVGs.`);
