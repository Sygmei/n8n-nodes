import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const baseRef = process.env.BASE_REF || 'HEAD^';
const headRef = process.env.HEAD_REF || 'HEAD';
const dryRun = process.env.DRY_RUN === 'true';
const emptyRef = /^0{40}$/;
const emptyTreeRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonAtRef(ref, path) {
  try {
    return JSON.parse(git(['show', `${ref}:${path}`]));
  } catch {
    return undefined;
  }
}

function npm(args, options = {}) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: 'inherit',
    ...options,
  });
}

const effectiveBaseRef = emptyRef.test(baseRef) ? emptyTreeRef : baseRef;

const changedFiles = git(['diff', '--name-only', effectiveBaseRef, headRef])
  .split(/\r?\n/)
  .filter(Boolean);

const changedProjects = [...new Set(
  changedFiles.filter((file) => /^packages\/[^/]+\/project\.json$/.test(file)),
)];

if (changedProjects.length === 0) {
  console.log('No node project version changes detected.');
  process.exit(0);
}

const packagesToPublish = [];

for (const projectPath of changedProjects) {
  const previous = readJsonAtRef(effectiveBaseRef, projectPath);
  const current = readJson(projectPath);

  if (!current.version) {
    throw new Error(`${projectPath} must contain a version.`);
  }

  if (previous?.version === current.version) {
    console.log(`${projectPath} changed without a version bump. Skipping publish.`);
    continue;
  }

  const packageRoot = dirname(projectPath);
  const packageJsonPath = join(packageRoot, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`${packageRoot} is missing package.json.`);
  }

  const packageJson = readJson(packageJsonPath);

  if (packageJson.version !== current.version) {
    throw new Error(
      `${projectPath} version (${current.version}) must match ${packageJsonPath} version (${packageJson.version}).`,
    );
  }

  packagesToPublish.push({
    name: packageJson.name,
    version: packageJson.version,
    root: packageRoot,
  });
}

if (packagesToPublish.length === 0) {
  console.log('No publishable version bumps detected.');
  process.exit(0);
}

if (!dryRun) {
  npm(['ci']);
}

for (const packageToPublish of packagesToPublish) {
  console.log(
    `Publishing ${packageToPublish.name}@${packageToPublish.version} from ${packageToPublish.root}`,
  );

  if (dryRun) {
    continue;
  }

  npm(['run', 'check'], { cwd: packageToPublish.root });
  npm(['publish', '--provenance', '--access', 'public'], { cwd: packageToPublish.root });
}
