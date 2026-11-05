/**
 * OpenContainer — Runtime blob packer.
 *
 * Packs the vendored Node.js sources into ONE gzip'd binary blob (.ocrt.gz)
 * so the kernel worker boots with a single HTTP request instead of 455.
 *
 * Blob layout (little-endian):
 *   bytes 0..3    magic "OCRT"
 *   bytes 4..5    format version (u16) = 1
 *   bytes 6..7    flags (u16)           = 0
 *   bytes 8..11   index byte length (u32, UTF-8 JSON)
 *   bytes 12..    index JSON: [{p: path, o: byte offset, l: byte length}, ...]
 *   then          body: concatenated UTF-8 module sources (offsets relative to body start)
 *
 * amaro/ (TS strip-types, 3.8 MB — mostly embedded WASM) is packed into a
 * separate lazily-fetched blob so it never slows first boot.
 *
 * The upstream npm CLI (vendored unmodified at repo-root vendor/npm-<ver>,
 * see its .provenance.json) is packed as a third lazily-fetched blob so the
 * kernel can run the real `npm` without paying for it at boot. Every file in
 * the tree is packed (any extension) except .provenance.json (our bookkeeping
 * file) and binary files — the OCRT container is UTF-8 text only, so binaries
 * (detected by NUL-byte / invalid-UTF-8 scan) are excluded and reported.
 *
 * Output (content-addressed by sha256 prefix):
 *   public/opencontainer/runtime/node-<ver>-core-<hash8>.ocrt.gz
 *   public/opencontainer/runtime/node-<ver>-amaro-<hash8>.ocrt.gz
 *   public/opencontainer/runtime/npm-<npmver>-<hash8>.ocrt.gz
 *   public/opencontainer/runtime/index.json   (tiny pointer file)
 *
 * Run: bun run scripts/pack-runtime.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dir, '..');
const VENDOR = path.join(ROOT, 'src/packages/opencontainer/vendor/node-v26.13.0');
const NPM_VENDOR = path.join(ROOT, 'vendor/npm-12.2.1');
const OUT_DIR = path.join(ROOT, 'public/opencontainer/runtime');

interface Entry { p: string; o: number; l: number }

function pack(files: string[], vendorDir: string): { blob: Buffer; index: Entry[] } {
  const sources: Buffer[] = [];
  const index: Entry[] = [];
  let offset = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(vendorDir, f));
    index.push({ p: f, o: offset, l: buf.length });
    offset += buf.length;
    sources.push(buf);
  }
  const indexJson = Buffer.from(JSON.stringify(index), 'utf8');
  const header = Buffer.alloc(12);
  header.write('OCRT', 0, 'ascii');
  header.writeUInt16LE(1, 4); // format version
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt32LE(indexJson.length, 8);
  const blob = Buffer.concat([header, indexJson, ...sources]);
  return { blob, index };
}

/**
 * Collect EVERY file under the vendored npm tree (any extension — it is an
 * unmodified upstream tarball extraction) except:
 *   - `.provenance.json` — our own bookkeeping file, not part of upstream npm
 *   - binary files — the OCRT container concatenates UTF-8 file bodies only,
 *     so NUL-byte / invalid-UTF-8 files are excluded and reported.
 * Paths are repo-relative to the npm vendor dir, POSIX separators, sorted so
 * the blob is byte-for-byte deterministic for a given tree.
 */
function collectNpmFiles(
  vendorDir: string,
): { files: string[]; excluded: { p: string; reason: string }[] } {
  const files: string[] = [];
  const excluded: { p: string; reason: string }[] = [];
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (relPath === '.provenance.json') continue; // ours, not upstream npm
        const buf = fs.readFileSync(path.join(dir, entry.name));
        if (buf.includes(0)) {
          excluded.push({ p: relPath, reason: 'binary (NUL byte) — OCRT is UTF-8 text only' });
          continue;
        }
        try {
          utf8.decode(buf);
        } catch {
          excluded.push({ p: relPath, reason: 'invalid UTF-8 — OCRT is UTF-8 text only' });
          continue;
        }
        files.push(relPath);
      }
    }
  };
  walk(vendorDir, '');
  files.sort();
  return { files, excluded };
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(VENDOR, 'manifest.json'), 'utf8'),
  );
  const nodeVersion: string = manifest.nodeVersion;
  const allFiles: string[] = manifest.files;

  const coreFiles = allFiles.filter((f) => !f.startsWith('amaro/'));
  const amaroFiles = allFiles.filter((f) => f.startsWith('amaro/'));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const write = (
    name: 'core' | 'amaro' | 'npm',
    files: string[],
    vendorDir: string = VENDOR,
    filePrefix?: string,
  ): { file: string; sha256: string; rawBytes: number; gzBytes: number; modules: number } => {
    const t0 = Bun.nanoseconds();
    const { blob } = pack(files, vendorDir);
    const hash = sha(blob);
    const gz = gzipSync(blob, { level: 9 });
    const file = `${filePrefix ?? `node-${nodeVersion}-${name}`}-${hash}.ocrt.gz`;
    fs.writeFileSync(path.join(OUT_DIR, file), gz);
    const ms = ((Bun.nanoseconds() - t0) / 1e6).toFixed(0);
    console.log(
      `[opencontainer] ${name}: ${files.length} modules, ` +
        `${(blob.length / 1024 / 1024).toFixed(2)} MB raw → ${(gz.length / 1024 / 1024).toFixed(2)} MB gz (${ms} ms)`,
    );
    return {
      file,
      sha256: hash,
      rawBytes: blob.length,
      gzBytes: gz.length,
      modules: files.length,
    };
  };

  const core = write('core', coreFiles);
  const amaro = write('amaro', amaroFiles);

  // Third blob: the REAL upstream npm CLI tree vendored at repo-root
  // vendor/npm-<version> (unmodified — see .provenance.json inside it).
  const npmVersion: string = JSON.parse(
    fs.readFileSync(path.join(NPM_VENDOR, 'package.json'), 'utf8'),
  ).version;
  const { files: npmFiles, excluded: npmExcluded } = collectNpmFiles(NPM_VENDOR);
  for (const ex of npmExcluded) {
    console.warn(`[opencontainer] npm: excluding ${ex.p} (${ex.reason})`);
  }
  const npm = write('npm', npmFiles, NPM_VENDOR, `npm-${npmVersion}`);

  const index = {
    nodeVersion,
    generatedAt: new Date().toISOString(),
    core,
    amaro,
    npm,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify(index, null, 2),
  );
  // S3.1: also emit a typed module so the main-thread runtime can EMBED the
  // index at app-build time (one fewer network fetch per kernel worker; the
  // index and the blobs are generated together, so they cannot drift).
  const { generatedAt, ...indexFields } = index;
  fs.writeFileSync(
    path.join(ROOT, 'src/packages/opencontainer/runtime-index.ts'),
    '// AUTO-GENERATED by scripts/pack-runtime.ts — do not edit by hand.\n' +
    `// Regenerated together with public/opencontainer/runtime/* so it is always in sync.\n` +
    `export const RUNTIME_INDEX = ${JSON.stringify(indexFields, null, 2)} as const;\n`,
  );
  console.log(
    `[opencontainer] runtime index written (${core.modules + amaro.modules + npm.modules} modules total)`,
  );
}

main();
