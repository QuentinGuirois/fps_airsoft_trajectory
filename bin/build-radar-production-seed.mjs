import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [sourceArgument, outputArgument, expectedHash] = process.argv.slice(2);
if (
  !sourceArgument
  || !outputArgument
  || !/^[a-f0-9]{64}$/.test(expectedHash || '')
) {
  throw new Error('Usage: node bin/build-radar-production-seed.mjs SOURCE OUTPUT SHA256');
}

const sourcePath = resolve(sourceArgument);
const outputPath = resolve(outputArgument);
const source = await readFile(sourcePath, 'utf8');
const actualHash = createHash('sha256').update(source).digest('hex');
if (actualHash !== expectedHash) {
  throw new Error(`Empreinte Radar inattendue : ${actualHash}.`);
}

const marker = 'FAT_RADAR_PRODUCTION_SEED_20260724';
if (source.includes(marker)) {
  throw new Error('Le marqueur PHP est présent dans le JSON Radar.');
}

// PHP retire le saut de ligne placé juste avant le marqueur nowdoc. Le saut
// supplémentaire conserve donc exactement celui qui termine le JSON source.
const wrapped = `<?php\nreturn <<<'${marker}'\n${source}\n${marker};\n`;
const contentStart = wrapped.indexOf('\n', wrapped.indexOf(marker)) + 1;
const contentEnd = wrapped.lastIndexOf(`\n${marker};`);
const phpLoadedValue = wrapped.slice(contentStart, contentEnd);
if (phpLoadedValue !== source) {
  throw new Error('L’encapsulation PHP modifierait le contenu du lot Radar.');
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wrapped);
console.log(`Lot Radar encapsulé : ${actualHash}.`);
