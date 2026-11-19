import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const BLOCK_SIZE = 512;

function writeOctal(buffer, offset, length, value) {
  const digits = Math.floor(value)
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  buffer.write(digits, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function writeText(buffer, offset, length, text) {
  const value = Buffer.from(text, 'utf8').subarray(0, length - 1);
  value.copy(buffer, offset);
}

function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };

  const parts = name.split('/');
  for (let index = 1; index < parts.length; index++) {
    const prefix = parts.slice(0, index).join('/');
    const rest = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new Error(`Path is too long for a ustar header: ${name}`);
}

function headerFor(entry) {
  const header = Buffer.alloc(BLOCK_SIZE);
  const type = entry.type ?? 'file';
  const typeflag = type === 'dir' ? '5' : type === 'symlink' ? '2' : '0';
  const content = type === 'file' ? Buffer.from(entry.content ?? '') : Buffer.alloc(0);
  const { name, prefix } = splitName(entry.name.replace(/^\/+/, ''));

  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode ?? (type === 'dir' ? 0o755 : 0o644));
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, entry.mtime ?? 0);
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 1, 'ascii');
  writeText(header, 157, 100, entry.linkname ?? '');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  writeText(header, 265, 32, 'root');
  writeText(header, 297, 32, 'root');
  if (prefix) writeText(header, 345, 155, prefix);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;

  return { header, content };
}

/** Creates a deterministic ustar archive from explicit entries. */
export function createTar(entries) {
  const chunks = [];

  for (const entry of entries) {
    const { header, content } = headerFor(entry);
    chunks.push(header, content);
    const padding = (BLOCK_SIZE - (content.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }

  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}

/** Creates the gzip-compressed mtree payload pacman expects in .MTREE. */
export function createMtree(entries, mtime = 0) {
  const lines = ['#mtree', '/set type=file uid=0 gid=0 mode=644'];

  for (const entry of entries) {
    if (entry.name === '.MTREE') continue;

    const type =
      entry.type === 'dir'
        ? 'type=dir '
        : entry.type === 'symlink'
          ? `type=link link=${entry.linkname} `
          : '';
    const mode = (entry.mode ?? (entry.type === 'dir' ? 0o755 : 0o644))
      .toString(8)
      .padStart(4, '0');
    const timestamp = `${mtime}.0`;
    const content = entry.type === 'file' ? Buffer.from(entry.content ?? '') : Buffer.alloc(0);
    const size = entry.type === 'file' ? ` size=${content.length}` : '';
    const digests =
      entry.type === 'file'
        ? ` md5digest=${createHash('md5').update(content).digest('hex')}` +
          ` sha256digest=${createHash('sha256').update(content).digest('hex')}`
        : '';

    lines.push(`./${entry.name} ${type}mode=${mode} time=${timestamp}${size}${digests}`);
  }

  return gzipSync(Buffer.from(`${lines.join('\n')}\n`, 'ascii'), { mtime: 0 });
}
