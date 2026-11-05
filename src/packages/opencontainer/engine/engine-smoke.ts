/* Smoke test for the OpenContainer engine + prelude (runs in Node). */
import { VirtualFileSystem } from '../fs';
import { ModuleLoader } from './module-loader';
import { EngineProcess, getEngineWASMModule } from './engine';
import { FULL_PRELUDE } from './prelude';

async function runEntry(entry: any, files: Record<string, string> = {}, cwd = '/project'): Promise<{ stdout: string; stderr: string; code: number }> {
  const fs = new VirtualFileSystem();
  fs.mkdir('/project', { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    const full = '/project/' + p.replace(/^\//, '');
    const dir = full.slice(0, full.lastIndexOf('/'));
    fs.mkdir(dir, { recursive: true });
    fs.writeFile(full, c);
  }
  const loader = new ModuleLoader(fs);
  const mod = await getEngineWASMModule();

  let stdout = '';
  let stderr = '';
  let code = -1;

  const netStub = {
    listen: async () => null,
    close: () => {},
    fetch: async () => { throw new Error('no net in test'); },
    wsOpen: () => -1,
    wsSend: () => {},
    wsClose: () => {},
  };

  const proc = new EngineProcess(
    {
      pid: 1,
      argv: ['node', ...('args' in entry ? [] : [])],
      cwd,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/nodeuser' },
      fs,
      net: netStub as never,
      onStdout: (d) => { stdout += d; },
      onStderr: (d) => { stderr += d; },
      onExit: (c) => { code = c; },
      spawnChild: async () => ({ pid: null }),
      childOps: { stdinWrite: () => {}, kill: () => {}, on: () => {} },
      moduleLoader: loader,
      memoryLimitBytes: 128 * 1024 * 1024,
    },
    mod,
    FULL_PRELUDE
  );

  await proc.start(entry);
  return { stdout, stderr, code };
}

async function main() {
  let failures = 0;
  const check = (name: string, cond: boolean, detail?: string) => {
    if (cond) console.log('PASS', name);
    else { console.log('FAIL', name, detail ?? ''); failures++; }
  };

  // 1. node -v
  const v = await runEntry({ kind: 'version' });
  check('node -v prints honest version', /^v[0-9]/.test(v.stdout.trim()) && v.code === 0, JSON.stringify(v));

  // 2. eval hello
  const e1 = await runEntry({ kind: 'eval', code: "console.log('Hello from engine')" });
  check('node -e hello', e1.stdout.includes('Hello from engine') && e1.code === 0, JSON.stringify(e1));

  // 3. eval error → exit 1
  const e2 = await runEntry({ kind: 'eval', code: 'throw new Error("boom")' });
  check('uncaught error exit 1', e2.code === 1 && e2.stderr.includes('boom'), JSON.stringify(e2));

  // 4. -p expression
  const e3 = await runEntry({ kind: 'print', code: '1 + 2 * 3' });
  check('node -p expression', e3.stdout.trim() === '7', JSON.stringify(e3));

  // 5. script + fs + setTimeout + async
  const script = `
const fs = require('fs');
const path = require('path');
console.log('cwd:', process.cwd());
console.log('platform:', process.platform, 'arch:', process.arch);
console.log('argv:', process.argv.slice(1).join(','));
console.log('env PATH set:', !!process.env.PATH);
fs.writeFileSync('/project/out.txt', 'written');
console.log('read back:', fs.readFileSync('/project/out.txt', 'utf8'));
setTimeout(() => {
  console.log('timer fired');
  process.exit(3);
}, 20);
console.log('sync done');
`;
  const s1 = await runEntry({ kind: 'script', filename: '/project/main.js' }, { 'main.js': script });
  check('script fs+timers', s1.stdout.includes('read back: written') && s1.stdout.includes('timer fired') && s1.code === 3, JSON.stringify(s1));

  // 6. promises / async-await
  const s2 = await runEntry({ kind: 'eval', code: `
(async () => {
  const v = await Promise.resolve(42);
  console.log('awaited', v);
  const p = await new Promise((r) => setTimeout(() => r('nested'), 10));
  console.log('nested', p);
})();
` });
  check('async/await + promise jobs', s2.stdout.includes('awaited 42') && s2.stdout.includes('nested nested') && s2.code === 0, JSON.stringify(s2));

  // 7. ESM module
  const s3 = await runEntry({ kind: 'script', filename: '/project/esm.mjs' }, {
    'esm.mjs': `
import { greet } from './lib.mjs';
import def from './def.mjs';
console.log(greet('ESM'), def);
`,
    'lib.mjs': `export function greet(name) { return 'hello ' + name; }`,
    'def.mjs': `export default 99;`,
  });
  check('ESM imports (named + default)', s3.stdout.includes('hello ESM 99') && s3.code === 0, JSON.stringify(s3));

  // 8. ESM export variants
  const s4 = await runEntry({ kind: 'script', filename: '/project/exp.mjs' }, {
    'exp.mjs': `
export const A = 1;
export let B = 2;
export function fn() { return 'fn'; }
export default class Thing { name() { return 'thing'; } }
`,
    'user.js': ``,
  });
  check('ESM exports parse', s4.code === 0, JSON.stringify(s4));

  // 9. require from node_modules with package.json main
  const s5 = await runEntry({ kind: 'script', filename: '/project/use-dep.js' }, {
    'use-dep.js': `const dep = require('my-dep'); console.log('dep says:', dep.say());`,
    'node_modules/my-dep/package.json': `{"name":"my-dep","main":"index.js"}`,
    'node_modules/my-dep/index.js': `module.exports = { say: () => 'dep works' };`,
  });
  check('require resolves node_modules', s5.stdout.includes('dep works') && s5.code === 0, JSON.stringify(s5));

  // 10. Buffer basics
  const s6 = await runEntry({ kind: 'eval', code: `
const b = Buffer.from('hello');
console.log('len', b.length, 'hex', b.toString('hex'), 'b64', b.toString('base64'));
const b2 = Buffer.concat([Buffer.from('a'), Buffer.from('b')]);
console.log('concat', b2.toString());
console.log('byteLength', Buffer.byteLength('héllo'));
` });
  check('Buffer basics', s6.stdout.includes('len 5') && s6.stdout.includes('b64 aGVsbG8=') && s6.stdout.includes('concat ab') && s6.code === 0, JSON.stringify(s6));

  // 11. EventEmitter
  const s7 = await runEntry({ kind: 'eval', code: `
const EventEmitter = require('events');
const ee = new EventEmitter();
ee.on('x', (v) => console.log('got', v));
ee.once('y', () => console.log('once'));
ee.emit('x', 1); ee.emit('x', 2); ee.emit('y'); ee.emit('y');
` });
  check('EventEmitter', s7.stdout.includes('got 1') && s7.stdout.includes('got 2') && s7.stdout.split('once').length === 2 && s7.code === 0, JSON.stringify(s7));

  // 12. path
  const s8 = await runEntry({ kind: 'eval', code: `
const path = require('path');
console.log(path.join('/a', 'b', '../c'));
console.log(path.resolve('/project', './x.js'));
console.log(path.basename('/a/b/c.txt'), path.extname('/a/b/c.txt'), path.dirname('/a/b/c.txt'));
` });
  check('path module', s8.stdout.includes('/a/c') && s8.stdout.includes('/project/x.js') && s8.stdout.includes('c.txt .txt /a/b'), JSON.stringify(s8));

  // 13. infinite loop kill
  const fsx = new VirtualFileSystem();
  fsx.mkdir('/project', { recursive: true });
  const loaderx = new ModuleLoader(fsx);
  const modx = await getEngineWASMModule();
  let out = '';
  const procx = new EngineProcess({
    pid: 9, argv: ['node'], cwd: '/project', env: {}, fs: fsx,
    net: { listen: async () => null, close: () => {}, fetch: async () => { throw new Error('x'); }, wsOpen: () => -1, wsSend: () => {}, wsClose: () => {} } as never,
    onStdout: (d) => { out += d; }, onStderr: () => {}, onExit: () => {},
    spawnChild: async () => ({ pid: null }), childOps: { stdinWrite: () => {}, kill: () => {}, on: () => {} },
    moduleLoader: loaderx,
  }, modx, FULL_PRELUDE);
  const startPromise = procx.start({ kind: 'eval', code: 'while (true) {}' });
  setTimeout(() => procx.kill(), 100);
  await startPromise;
  check('kill interrupts infinite loop', procx.isExited);

  // 14. util.format / console formatting
  const s9 = await runEntry({ kind: 'eval', code: `console.log('%s scored %d', 'node', 100); console.log({ a: 1, nested: { b: [1, 2] } });` });
  check('util.format', s9.stdout.includes('node scored 100') && s9.stdout.includes('nested') && s9.code === 0, JSON.stringify(s9));

  // 15. process.on('exit')
  const s10 = await runEntry({ kind: 'eval', code: `
process.on('exit', (c) => console.log('exiting with', c));
console.log('bye');
` });
  check('process exit event', s10.stdout.includes('exiting with 0') && s10.code === 0, JSON.stringify(s10));

  console.log(failures === 0 ? '\nALL ENGINE SMOKE TESTS PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE TEST CRASH:', e);
  process.exit(1);
});
