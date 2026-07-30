#!/usr/bin/env node
/**
 * Usage: node scripts/setup-builtin-mimo.mjs tp-your-key
 * Writes .env.local (gitignored). Does not print the full key.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const key = (process.argv[2] ?? process.env.VITE_BUILTIN_MIMO_API_KEY ?? '').trim();
if (!key) {
  console.error('Usage: node scripts/setup-builtin-mimo.mjs tp-your-key');
  process.exit(1);
}
if (!key.startsWith('tp-')) {
  console.error('Expected a Token Plan key starting with tp-');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');
writeFileSync(
  envPath,
  `# Hosted MiMo for all users (baked into dist at build time). DO NOT COMMIT.\nVITE_BUILTIN_MIMO_API_KEY=${key}\n`,
  'utf8',
);
console.log(`Wrote ${envPath}`);
console.log('Next: npm run build');
