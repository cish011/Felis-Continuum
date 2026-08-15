import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

async function exists(relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    return true;
  } catch {
    failures.push(`Missing required package input: ${relativePath}`);
    return false;
  }
}

async function filesBelow(relativeDirectory) {
  const directory = path.join(projectRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(relativePath));
    else if (entry.isFile()) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

function resolveHtmlReference(reference) {
  const pathname = reference.split(/[?#]/, 1)[0];
  return path.posix.normalize(path.posix.join('dist-web', pathname));
}

const packageJsonPath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
if (packageJson.main !== 'electron/main.cjs') {
  failures.push(`package.json main must be electron/main.cjs (received ${packageJson.main ?? 'nothing'}).`);
}

for (const required of [
  'electron/main.cjs',
  'electron/preload.cjs',
  'dist-web/index.html',
  'build/icon.ico',
  'build/icon.png',
]) {
  await exists(required);
}

const indexPath = path.join(projectRoot, 'dist-web', 'index.html');
let indexHtml = '';
try {
  indexHtml = await readFile(indexPath, 'utf8');
} catch {
  // The missing-file diagnostic above is more useful than a duplicate error.
}

const entryReferences = [...indexHtml.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1]);
if (entryReferences.length < 2) failures.push('dist-web/index.html has no complete JavaScript/CSS entry pair.');
for (const reference of entryReferences) {
  if (/^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith('/')) {
    failures.push(`Packaged HTML contains a non-relative entry URL: ${reference}`);
    continue;
  }
  await exists(resolveHtmlReference(reference));
}

let packagedFiles = [];
try {
  packagedFiles = await filesBelow('dist-web');
} catch {
  // Missing dist-web was already reported.
}

const jsFiles = packagedFiles.filter(file => file.endsWith('.js'));
const cssFiles = packagedFiles.filter(file => file.endsWith('.css'));
const pbrFiles = packagedFiles.filter(file => file.startsWith('dist-web/textures/pbr/') && file.endsWith('.png'));
if (!jsFiles.some(file => /cognition\.worker-[^/]+\.js$/.test(file))) {
  failures.push('The production build does not contain the cognition module worker chunk.');
}
if (!jsFiles.some(file => /rapier-[^/]+\.js$/.test(file))) {
  failures.push('The production build does not contain the Rapier physics chunk.');
}
if (pbrFiles.length < 24) {
  failures.push(`Expected at least 24 PBR texture maps in dist-web; found ${pbrFiles.length}.`);
}

for (const relativePath of ['build/icon.ico', 'build/icon.png']) {
  try {
    const info = await stat(path.join(projectRoot, relativePath));
    if (info.size < 1_024) failures.push(`${relativePath} is unexpectedly small (${info.size} bytes).`);
  } catch {
    // Missing-file diagnostic above already covers this.
  }
}

if (failures.length) {
  console.error('Felis Continuum package-input verification failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Package inputs verified: ${jsFiles.length} JavaScript chunks, ${cssFiles.length} stylesheet, `
    + `${pbrFiles.length} PBR maps, relative file:// entry URLs, desktop entry, preload, and icons.`,
  );
}
