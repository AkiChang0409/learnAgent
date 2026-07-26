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
  let largestJs = { file: '', bytes: 0 };
  for (const file of files) {
    const extension = path.extname(file).slice(1);
    if (!(extension in totals)) continue;
    const bytes = gzipSync(await readFile(file)).byteLength;
    totals[extension] += bytes;
    if (extension === 'js' && bytes > largestJs.bytes) largestJs = { file, bytes };
  }
  // The WYSIWYG editor is intentionally lazy-loaded. Keep each JS chunk bounded so
  // the original app shell stays lean, while allowing the optional editor runtime.
  const limits = { js: 250 * 1024, css: 10 * 1024, jsChunk: 150 * 1024 };
  console.log(`Bundle gzip: JS ${(totals.js / 1024).toFixed(1)}KB, CSS ${(totals.css / 1024).toFixed(1)}KB`);
  for (const kind of ['js', 'css']) {
    if (totals[kind] > limits[kind]) throw new Error(`${kind.toUpperCase()} gzip 超出预算：${totals[kind]} > ${limits[kind]}`);
  }
  if (largestJs.bytes > limits.jsChunk) {
    throw new Error(`单个 JS chunk gzip 超出预算：${largestJs.bytes} > ${limits.jsChunk} (${path.basename(largestJs.file)})`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
