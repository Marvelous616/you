#!/usr/bin/env node
/**
 * Builds a native Arch package (.pkg.tar.zst) for Life Logger on any workstation.
 *
 * The app is compiled here (TypeScript, Vite, esbuild), then the archive is
 * assembled without fakeroot: uid/gid 0, explicit modes and a fixed mtime are
 * written straight into the ustar headers. No WSL, Docker or makepkg required.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { createMtree, createTar } from './lib/tar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES_DIR = path.join(ROOT, 'packaging', 'files');
const WEB_DIST = path.join(ROOT, 'apps', 'web', 'dist');
const SERVER_DIST = path.join(ROOT, 'apps', 'server', 'dist', 'index.js');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'packages');

const usage = `
Usage: node packaging/build-package.mjs [options]

  --version X.Y.Z   Package version. Defaults to an exact git tag such as v0.3.5.
  --pkgrel N        Packaging-only release number (default 1).
  --out DIR         Output directory (default dist/packages).
  --source-date N   Fixed mtime in epoch seconds (default: HEAD commit time).
  --arch NAME       Package architecture (default: host architecture).
  --no-build        Reuse existing TypeScript/Vite/esbuild output.
  --help            Show this help.
`;

function parseArgs(argv) {
  const options = {
    version: '',
    pkgrel: '1',
    out: DEFAULT_OUT,
    sourceDate: '',
    arch: '',
    noBuild: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--version':
        options.version = argv[++index] ?? '';
        break;
      case '--pkgrel':
        options.pkgrel = argv[++index] ?? '';
        break;
      case '--out':
        options.out = argv[++index] ?? '';
        break;
      case '--source-date':
        options.sourceDate = argv[++index] ?? '';
        break;
      case '--arch':
        options.arch = argv[++index] ?? '';
        break;
      case '--no-build':
        options.noBuild = true;
        break;
      case '--help':
        console.log(usage);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}\n${usage}`);
    }
  }

  return options;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function resolveVersion(explicit) {
  if (explicit) {
    if (!/^\d+\.\d+\.\d+$/.test(explicit)) {
      throw new Error(`Invalid --version: ${explicit} (expected x.y.z)`);
    }
    return explicit;
  }

  const tag = git(['describe', '--tags', '--exact-match', 'HEAD']);
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error('Cannot determine version: pass --version X.Y.Z or tag HEAD as vX.Y.Z');
  }
  return match[1];
}

function resolveArch(explicit) {
  if (explicit) return explicit;
  if (process.arch === 'x64') return 'x86_64';
  if (process.arch === 'arm64') return 'aarch64';
  throw new Error(`No Arch architecture mapping for Node arch ${process.arch}; pass --arch`);
}

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

function runBuild() {
  const npmCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  const useCli = fs.existsSync(npmCli);
  const command = useCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = useCli ? [npmCli, 'run', 'build'] : ['run', 'build'];
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) throw new Error('npm run build failed');
}

async function bundleServer() {
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'apps', 'server', 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: path.join(ROOT, 'packaging', 'build', 'server.js'),
    // Fastify's CommonJS modules use dynamic require() at runtime. ESM output
    // needs a require() bound to this module so node: builtins still resolve.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
}

function stageFiles(version) {
  const staged = new Map();

  const add = (target, content, mode = 0o644) => {
    const name = target.replace(/^\/+/, '');
    if (staged.has(name)) throw new Error(`Duplicate package path: ${name}`);
    staged.set(name, {
      name,
      type: 'file',
      mode,
      mtime: 0,
      content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    });
  };

  for (const source of walk(FILES_DIR)) {
    const relative = path.relative(FILES_DIR, source).split(path.sep).join('/');
    if (relative === 'INSTALL') {
      add('.INSTALL', fs.readFileSync(source), 0o755);
      continue;
    }

    const targets = {
      'lifelogger': 'usr/bin/lifelogger',
      'lifelogger-update': 'usr/bin/lifelogger-update',
      'backup.sh': 'usr/lib/lifelogger/backup.sh',
      'restore.sh': 'usr/lib/lifelogger/restore.sh',
      'lifelogger.service': 'usr/lib/systemd/system/lifelogger.service',
      'lifelogger-backup.service': 'usr/lib/systemd/system/lifelogger-backup.service',
      'lifelogger-backup.timer': 'usr/lib/systemd/system/lifelogger-backup.timer',
      'lifelogger.sysusers': 'usr/lib/sysusers.d/lifelogger.conf',
      'lifelogger.tmpfiles': 'usr/lib/tmpfiles.d/lifelogger.conf',
      'lifelogger.env': 'etc/lifelogger.env',
      'PACKAGE-README': 'usr/share/doc/lifelogger/README',
    };

    const target = targets[relative];
    if (!target) throw new Error(`No install target declared for packaging/files/${relative}`);
    add(target, fs.readFileSync(source), target === 'etc/lifelogger.env' ? 0o600 : 0o644);
  }

  const scripts = new Set(['usr/bin/lifelogger', 'usr/bin/lifelogger-update',
    'usr/lib/lifelogger/backup.sh', 'usr/lib/lifelogger/restore.sh']);
  for (const name of scripts) staged.get(name).mode = 0o755;

  const serverBundle = path.join(ROOT, 'packaging', 'build', 'server.js');
  add('usr/lib/lifelogger/server.js', fs.readFileSync(serverBundle));
  add('usr/lib/lifelogger/version', `${version}\n`);

  for (const source of walk(WEB_DIST)) {
    const relative = path.relative(WEB_DIST, source).split(path.sep).join('/');
    add(`usr/lib/lifelogger/web/${relative}`, fs.readFileSync(source));
  }

  return staged;
}

function withDirectories(staged) {
  const entries = [...staged.values()];
  const directories = new Set();

  for (const file of entries) {
    const parts = file.name.split('/');
    for (let index = 1; index < parts.length; index++) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }

  for (const name of directories) {
    if (staged.has(name)) throw new Error(`Directory path collides with a file: ${name}`);
    entries.push({ name, type: 'dir', mode: 0o755, mtime: 0, content: Buffer.alloc(0) });
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function buildPkginfo(version, pkgrel, arch, entries, buildDate) {
  const installedSize = entries
    .filter((entry) => entry.type === 'file')
    .reduce((sum, entry) => sum + entry.content.length, 0);

  const lines = [
    '# Generated by packaging/build-package.mjs',
    'pkgname = lifelogger',
    'pkgbase = lifelogger',
    `pkgver = ${version}-${pkgrel}`,
    'pkgdesc = Life Logger personal timeline server',
    'url = https://github.com/Marvelous616/you',
    `builddate = ${buildDate}`,
    'packager = Life Logger build script',
    `size = ${installedSize}`,
    `arch = ${arch}`,
    'install = .INSTALL',
    'depend = nodejs>=24',
    'depend = systemd',
    'depend = sqlite',
    'depend = curl',
    'backup = etc/lifelogger.env',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = resolveVersion(options.version);
  const pkgrel = options.pkgrel;
  const arch = resolveArch(options.arch);

  if (!/^\d+$/.test(pkgrel)) throw new Error(`Invalid --pkgrel: ${pkgrel}`);
  if (!fs.existsSync(FILES_DIR)) throw new Error(`Missing ${FILES_DIR}`);

  if (!options.noBuild) runBuild();
  if (!fs.existsSync(WEB_DIST) || !fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    throw new Error(`Missing built web app at ${WEB_DIST}; run the build first`);
  }
  if (!fs.existsSync(SERVER_DIST)) {
    throw new Error(`Missing compiled server at ${SERVER_DIST}; run the build first`);
  }

  await bundleServer();

  const mtime = Number(options.sourceDate || git(['log', '-1', '--format=%ct']) || 0);
  if (!Number.isInteger(mtime) || mtime < 0) throw new Error(`Invalid source date: ${options.sourceDate}`);

  const staged = stageFiles(version);
  const pkginfo = buildPkginfo(version, pkgrel, arch, [...staged.values()], mtime);
  staged.set('.PKGINFO', {
    name: '.PKGINFO', type: 'file', mode: 0o644, mtime, content: Buffer.from(pkginfo, 'utf8'),
  });

  let entries = withDirectories(staged);
  for (const entry of entries) entry.mtime = mtime;

  const mtree = createMtree(entries, mtime);
  entries.push({ name: '.MTREE', type: 'file', mode: 0o644, mtime, content: mtree });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const packageName = `lifelogger-${version}-${pkgrel}-${arch}.pkg.tar.zst`;
  const outputDir = path.resolve(ROOT, options.out);
  fs.mkdirSync(outputDir, { recursive: true });

  const archive = zstdCompressSync(createTar(entries));
  const packagePath = path.join(outputDir, packageName);
  fs.writeFileSync(packagePath, archive);

  const checksum = createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(path.join(outputDir, `${packageName}.sha256`), `${checksum}  ${packageName}\n`);

  const manifest = entries.map(({ name, type, mode, content }) => ({
    name,
    type,
    mode: mode.toString(8).padStart(4, '0'),
    size: content.length,
  }));
  fs.writeFileSync(
    path.join(outputDir, `lifelogger-${version}-${pkgrel}-${arch}.manifest.json`),
    `${JSON.stringify({ packageName, version, pkgrel, arch, mtime, checksum, files: manifest }, null, 2)}\n`
  );

  console.log(`Built ${packagePath}`);
  console.log(`  files:  ${manifest.length}`);
  console.log(`  size:   ${(archive.length / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`  sha256: ${checksum}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
