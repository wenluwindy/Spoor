#!/usr/bin/env node
/**
 * Usage: node scripts/setup-builtin-doubao.mjs ark-your-key
 * Writes .env.local (gitignored). Does not print the full key.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const key = (process.argv[2] ?? process.env.VITE_BUILTIN_DOUBAO_API_KEY ?? '').trim();
if (!key) {
  console.error('Usage: node scripts/setup-builtin-doubao.mjs ark-your-key');
  process.exit(1);
}
if (!key.startsWith('ark-')) {
  console.error('Expected a Volcengine Ark key starting with ark-');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');
writeFileSync(
  envPath,
  `# Hosted Doubao for all users (baked into dist at build time). DO NOT COMMIT.\nVITE_BUILTIN_DOUBAO_API_KEY=${key}\n`,
  'utf8',
);
console.log(`Wrote ${envPath}`);
console.log('Next: npm run build');
