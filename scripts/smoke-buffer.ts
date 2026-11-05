/** scratch smoke: boot kernel, check Buffer + fs surface */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');
const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

async function main() {
  console.error('[host] booting...');
  const kernel = await bootKernel({
    store: diskStore as any,
    argv: ['node', '/home/project/main.js'],
    hooks: {
      onExit(code: number) { console.error('[exit]', code); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        console.error(`[stdio${fd}]`, JSON.stringify(text));
      },
      now: () => Date.now(),
      env: () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node' }),
      initialCwd: '/home/project',
    },
    onStage: (name: string, ms: number) => console.error(`[stage] ${name} +${ms}ms`),
  } as any);
  console.error('[host] booted');
  const { Buffer } = kernel.require('buffer');
  console.error('Buffer?', typeof Buffer);
  const b = Buffer.from('hello');
  console.error('hex', b.toString('hex'));
  console.error('indexOf', b.indexOf('ll'));
  const c = Buffer.alloc(6);
  console.error('copy', Buffer.from('abcdef').copy(c, 1, 2, 4), c.toString('hex'));
  console.error('compare', Buffer.from('ab').compare(Buffer.from('abcd')));
  console.error('btoa', typeof Buffer.btoa, Buffer.btoa ? Buffer.btoa('hello') : 'n/a');
  const fs = kernel.require('fs');
  console.error('fs?', typeof fs.writeFileSync);
  fs.writeFileSync('/tmp/x.txt', 'hello world');
  console.error('roundtrip', fs.readFileSync('/tmp/x.txt').toString());
  const fd = fs.openSync('/tmp/y.txt', 'w');
  fs.writeSync(fd, 'hello', 0);
  fs.writeSync(fd, 'é', null);
  fs.closeSync(fd);
  console.error('writeSync mix', fs.readFileSync('/tmp/y.txt').toString('hex'));
  const binding = (kernel.natives as any).get('buffer');
  console.error('binding', typeof binding.copy, typeof binding.fill, typeof binding.atob);
  console.error('isAscii', binding.isAscii(new Uint8Array([1, 127])), binding.isAscii(new Uint8Array([128])));
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
