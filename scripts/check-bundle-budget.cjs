const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  }));
  return nested.flat();
}

async function main() {
  const files = await filesUnder(path.resolve('dist'));
  const totals = { js: 0, css: 0 };
  for (const file of files) {
    const extension = path.extname(file).slice(1);
    if (!(extension in totals)) continue;
    totals[extension] += gzipSync(await readFile(file)).byteLength;
  }
  const limits = { js: 100 * 1024, css: 10 * 1024 };
  console.log(`Bundle gzip: JS ${(totals.js / 1024).toFixed(1)}KB, CSS ${(totals.css / 1024).toFixed(1)}KB`);
  for (const kind of Object.keys(limits)) {
    if (totals[kind] > limits[kind]) throw new Error(`${kind.toUpperCase()} gzip 超出预算：${totals[kind]} > ${limits[kind]}`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
