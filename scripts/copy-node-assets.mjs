import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

const sourceRoot = join(process.cwd(), 'nodes');
const outputRoot = join(process.cwd(), 'dist', 'nodes');
const assetExtensions = new Set(['.json', '.svg']);

function copyAssets(directory) {
  for (const entry of readdirSync(directory)) {
    const source = join(directory, entry);
    const stats = statSync(source);

    if (stats.isDirectory()) {
      copyAssets(source);
      continue;
    }

    if (!assetExtensions.has(extname(entry))) {
      continue;
    }

    const destination = join(outputRoot, relative(sourceRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
}

if (existsSync(sourceRoot)) {
  copyAssets(sourceRoot);
}
