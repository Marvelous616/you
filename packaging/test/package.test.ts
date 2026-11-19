import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'packaging', 'build-package.mjs');

interface TarEntry {
  name: string;
  mode: number;
  size: number;
  type: string;
  content: Buffer;
}

function parseTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const rawName = header.subarray(0, 100).toString('utf8').split('\0')[0];
    const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0];
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const mode = parseInt(header.subarray(100, 108).toString('utf8').split('\0')[0], 8);
    const size = parseInt(header.subarray(124, 136).toString('utf8').split('\0')[0], 8);
    const type = header.subarray(156, 157).toString('ascii');
    const content = archive.subarray(offset + 512, offset + 512 + size);

    entries.push({ name, mode, size, type, content });
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function build(version: string, outputDir: string, extra: string[] = []): string {
  execFileSync(
    process.execPath,
    [SCRIPT, '--version', version, '--no-build', '--source-date', '1700000000',
      '--out', outputDir, ...extra],
    { cwd: ROOT, stdio: 'pipe' }
  );
  return path.join(outputDir, `lifelogger-${version}-1-x86_64.pkg.tar.zst`);
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lifelogger-package-'));
}

describe('Arch package builder', () => {
  it('produces a readable package with the expected metadata', () => {
    const output = tempDir();
    const packagePath = build('0.3.5', output);
    const archive = fs.readFileSync(packagePath);
    const entries = parseTar(zstdDecompressSync(archive));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    expect(byName.has('.PKGINFO')).toBe(true);
    expect(byName.has('.MTREE')).toBe(true);
    expect(byName.has('.INSTALL')).toBe(true);

    const pkginfo = byName.get('.PKGINFO')!.content.toString('utf8');
    expect(pkginfo).toContain('pkgname = lifelogger');
    expect(pkginfo).toContain('pkgver = 0.3.5-1');
    expect(pkginfo).toContain('arch = x86_64');
    expect(pkginfo).toContain('backup = etc/lifelogger.env');
    expect(pkginfo).toContain('install = .INSTALL');
    expect(pkginfo).toContain('depend = nodejs>=24');

    const mtree = gunzipSync(byName.get('.MTREE')!.content).toString('utf8');
    expect(mtree).toContain('#mtree');
    expect(mtree).toContain('./.PKGINFO ');
    expect(mtree).toContain(`sha256digest=${createHash('sha256')
      .update(byName.get('.PKGINFO')!.content).digest('hex')}`);
    expect(mtree).not.toContain('./.MTREE ');
  });

  it('sets executable and protected modes correctly', () => {
    const output = tempDir();
    const entries = parseTar(zstdDecompressSync(fs.readFileSync(build('0.3.5', output))));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    for (const name of ['usr/bin/lifelogger', 'usr/bin/lifelogger-update',
      'usr/lib/lifelogger/backup.sh', 'usr/lib/lifelogger/restore.sh', '.INSTALL']) {
      expect(byName.get(name)!.mode, name).toBe(0o755);
    }
    expect(byName.get('etc/lifelogger.env')!.mode).toBe(0o600);
    expect(byName.get('usr/lib/lifelogger/server.js')!.mode).toBe(0o644);
    expect(byName.get('usr/lib/systemd/system/lifelogger.service')!.mode).toBe(0o644);
  });

  it('ships the server bundle, version file, web app and units', () => {
    const output = tempDir();
    const entries = parseTar(zstdDecompressSync(fs.readFileSync(build('0.3.5', output))));
    const names = new Set(entries.map((entry) => entry.name));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    expect(names.has('usr/lib/lifelogger/server.js')).toBe(true);
    expect(byName.get('usr/lib/lifelogger/server.js')!.size).toBeGreaterThan(100_000);
    expect(byName.get('usr/lib/lifelogger/version')!.content.toString()).toBe('0.3.5\n');
    expect(names.has('usr/lib/lifelogger/web/index.html')).toBe(true);
    expect([...names].some((name) => name.startsWith('usr/lib/lifelogger/web/assets/'))).toBe(true);
    expect(names.has('usr/lib/systemd/system/lifelogger-backup.timer')).toBe(true);
    expect(names.has('usr/lib/sysusers.d/lifelogger.conf')).toBe(true);
    expect(names.has('usr/lib/tmpfiles.d/lifelogger.conf')).toBe(true);
  });

  it('writes a checksum that matches the archive', () => {
    const output = tempDir();
    const packagePath = build('0.4.0', output);
    const checksumFile = fs.readFileSync(`${packagePath}.sha256`, 'utf8');
    const expected = checksumFile.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
    expect(actual).toBe(expected);
    expect(checksumFile).toContain('lifelogger-0.4.0-1-x86_64.pkg.tar.zst');
  });

  it('rejects malformed versions', () => {
    const output = tempDir();
    expect(() => build('v0.3.5-increment-3.5', output)).toThrow();
  });

  it('does not ship secrets or workstation paths', () => {
    const output = tempDir();
    const entries = parseTar(zstdDecompressSync(fs.readFileSync(build('0.3.5', output))));
    const configurationFiles = new Set([
      '.PKGINFO',
      'etc/lifelogger.env',
      'usr/share/doc/lifelogger/README',
      'usr/lib/systemd/system/lifelogger.service',
      'usr/bin/lifelogger',
      'usr/bin/lifelogger-update',
    ]);
    const text = entries
      .filter((entry) => entry.type === '0' && configurationFiles.has(entry.name))
      .map((entry) => entry.content.toString('utf8'))
      .join('\n');

    expect(text).not.toMatch(/C:\\Users\\/);
    expect(text).not.toMatch(/192\.168\./);
    expect(text).not.toMatch(/100\.\d+\.\d+\.\d+/);
    expect(text).not.toMatch(/api[_-]?key[ \t]*=[ \t]*\S+/i);
  });
});
