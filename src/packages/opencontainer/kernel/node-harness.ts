/**
 * OpenContainer — Node/Bun harness for fast kernel iteration.
 *
 * Boots the kernel with a disk-backed sync SourceStore (the vendored tree) and
 * runs `node -e` style code — the same code path the browser worker uses.
 *
 *   bun run src/packages/opencontainer/kernel/node-harness.ts ['code']
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from './boot';
import type { SourceStore } from './module-registry';

const VENDOR = nodePath.resolve(__dirname, '../vendor');

// Host console references captured BEFORE boot (the kernel replaces
// globalThis.console with node's real console module).
const hostLog = console.log.bind(console);
const hostError = console.error.bind(console);

const diskStore: SourceStore = {
  get(path: string): string {
    const full = nodePath.join(VENDOR, path);
    return nodeFs.readFileSync(full, 'utf8');
  },
};

const HARNESS_ARGS = process.argv.slice(2);

const DEFAULT_SMOKE = [
  // acceptance-style smoke: real internals through node -e
  `console.log('version:', process.version, '| platform:', process.platform, '| arch:', process.arch);`,
  `console.log('versions.node:', process.versions.node, '| v8 tag:', process.versions.v8);`,
  `console.log('Buffer b64:', Buffer.from('hello').toString('base64'));`,
  `console.log('Buffer hex+json:', Buffer.from(JSON.stringify({a:1})).toString('hex'));`,
  `console.log('cwd:', process.cwd());`,
  `const fs = require('fs'); fs.writeFileSync('/home/project/note.txt', 'written-by-real-node-fs'); console.log('fs roundtrip:', fs.readFileSync('/home/project/note.txt', 'utf8'));`,
  `const fs2 = require('fs'); try { fs2.readFileSync('/does/not/exist'); } catch (e) { console.log('ENOENT code:', e.code, '| syscall:', e.syscall); }`,
  `console.log('path.join:', require('path').join('/a', 'b', '..', 'c'));`,
  `console.log('inspect:', require('util').inspect({ x: [1, 'two', /three/], y: new Map([['k','v']]) }, { depth: 2, breakLength: 70 }));`,
  `const EventEmitter = require('events'); const ee = new EventEmitter(); ee.on('evt', (v) => console.log('event:', v)); ee.emit('evt', 'from-real-events-module');`,
  `console.log('url:', new URL('https://user@host:8443/p?q=1#h').pathname);`,
  `console.log('os:', require('os').platform(), '| EOL:', JSON.stringify(require('os').EOL));`,
  `process.nextTick(() => console.log('nextTick: fired'));`,
  `setImmediate(() => console.log('setImmediate: fired'));`,
  `setTimeout(() => console.log('setTimeout: fired'));`,
  `Promise.resolve().then(() => console.log('microtask: fired'));`,
  `console.log('querystring:', require('querystring').stringify({ a: 'b c', d: 1 }));`,
  `console.log('assert ok:', (() => { require('assert').strictEqual(1, 1); return 'no throw'; })());`,
  `console.log('timers/promises exists:', typeof require('timers/promises').setTimeout);`,
  `console.log('streams:', typeof require('stream').Readable.prototype.pipe);`,
  `require('fs').mkdirSync('/home/project/deep/dir/tree', { recursive: true }); console.log('mkdir recursive ok:', require('fs').existsSync('/home/project/deep/dir/tree'));`,
].join('\n');

async function main() {
  const kernel = await bootKernel({
    store: diskStore,
    hooks: {
      onExit(code) {
        hostLog(`\n[exit ${code}]`);
      },
      onStdio(fd, chunk) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        (fd === 1 ? hostLog : hostError)(text.endsWith('\n') ? text.slice(0, -1) : text);
      },
      spawn() { throw new Error('spawn not wired in harness'); },
      now: () => Date.now(),
      env: () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node' }),
      initialCwd: '/home/project',
    },
  });

  hostError('--- kernel booted, running node -e (S1 smoke suite) ---');
  // Route kernel uncaught exceptions to the host console for debugging.
  (globalThis as any).__ocUncaught = (err: any, promiseType: any) => {
    hostError(`\n[uncaught${promiseType ? ' (promise)' : ''}]`, err?.stack ?? String(err));
  };
  (globalThis as any).__ocDebugHook = (msg: string) => {
    hostError(`[debug] ${msg}`);
  };
  const arg = HARNESS_ARGS[0] ?? DEFAULT_SMOKE;
  if (arg === '@repl' || arg === '@repl-debug') {
    // Full interactive REPL test: boot node's REAL entry, feed keystrokes.
    hostError('--- starting REAL node REPL (internal/main/repl) ---');
    kernel.require('internal/main/repl');
    // Trace the exit chain (debug): flushHistory → exit → onExit.
    const anyProc: any = kernel.process;
    anyProc.on('exit', (c: number) => hostError(`[trace process.exit event code=${c}]`));
    // Instrument the history manager prototype to find close-chain stalls.
    try {
      const histMod: any = kernel.require('internal/repl/history');
      const proto = histMod.ReplHistory?.prototype ?? Object.getPrototypeOf(histMod.ReplHistory ?? {});
      for (const name of ['flushHistory', 'closeHandle', 'initialize']) {
        const key = Object.getOwnPropertySymbols(proto).find(
          (s: any) => String(s.description ?? '').toLowerCase().includes(name.toLowerCase()),
        );
        if (key) {
          const orig = proto[key];
          proto[key] = function (...a: any[]) {
            hostError(`[trace history.${name} start]`);
            const r = orig.apply(this, a);
            Promise.resolve(r).then(
              () => hostError(`[trace history.${name} done]`),
              (e: any) => hostError(`[trace history.${name} REJECTED] ${e?.message ?? e}`),
            );
            return r;
          };
        }
      }
    } catch (e: any) {
      hostError(`[trace history patch failed] ${e?.message}`);
    }
    const ttyBinding: any = kernel.natives.get('tty_wrap');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await sleep(300);
    if (arg === '@repl-debug') {
      const stdin: any = kernel.process.stdin;
      hostError('--- stdin introspection ---');
      hostError(`ctor: ${stdin?.constructor?.name}`);
      hostError(`readableFlowing: ${stdin?.readableFlowing} | paused: ${stdin?.paused} | ended: ${stdin?.readableEnded} | destroyed: ${stdin?.destroyed}`);
      hostError(`dataListeners: ${stdin?.listenerCount?.('data')} | readableLength: ${stdin?.readableLength}`);
      hostError(`handle: ${stdin?._handle?.constructor?.name} | reading: ${stdin?._handle?.reading} | onread: ${typeof stdin?._handle?.onread} | fd: ${stdin?._handle?.fd}`);
      hostError(`kBuffer-ish: ${!!(stdin as any) && 'readableListening' in stdin ? stdin.readableListening : 'n/a'}`);
      // Kick _read manually to see if the machinery is functional.
      try { stdin._read(0); hostError(`after _read(0): reading=${stdin._handle.reading}`); } catch (e: any) { hostError(`_read(0) threw: ${e?.message}`); }
    }
    const feed = (s: string) => {
      ttyBinding.feedStdin(s);
      // Drain kernel ticks after every host→kernel entry (node drains
      // between loop phases; this is our browser equivalent).
      (globalThis as any).__ocDrainTicks?.();
    };
    hostError('--- feed: 1+1<enter> ---');
    feed('1+1\r');
    await sleep(250);
    hostError('--- feed: process.version<enter> ---');
    feed('process.version\r');
    await sleep(250);
    hostError('--- feed: const {x}=require("util"); x.inspect({a:[1,2]})<enter> ---');
    feed('require("util").inspect({ a: [1, 2] })\r');
    await sleep(250);
    hostError('--- feed: 2**10<enter> ---');
    feed('2**10\r');
    await sleep(250);
    hostError('--- feed: .help<enter> ---');
    feed('.help\r');
    await sleep(250);
    hostError('--- feed: .exit<enter> ---');
    feed('.exit\r');
    await sleep(250);
    // Trace the flush/close chain: the 300ms history debounce must fire.
    const stdinS: any = kernel.process.stdin;
    hostError(`[trace +250ms] stdin paused? ${stdinS?.isPaused?.()} | readableFlowing ${stdinS?.readableFlowing} | proc exiting ${anyProc._exiting}`);
    await sleep(700);
    hostError(`[trace +950ms] process.exit fired? ${anyProc._exiting === true}`);
    await sleep(400);
    return;
  }
  if (arg === '@repl-min') {
    // Minimal REPL exit test: banner → .exit (no prior evals).
    hostError('--- minimal REPL exit test ---');
    // Capture the REPL instance by wrapping repl.start before the entry runs.
    const replMod: any = kernel.require('repl');
    const origStart = replMod.start;
    let replInstance: any = null;
    replMod.start = function (...a: any[]) {
      const inst = origStart.apply(this, a);
      replInstance = inst;
      hostError(`[trace repl.start captured: ${inst?.constructor?.name}]`);
      inst.on('close', () => hostError('[trace repl close event]'));
      inst.on('line', (l: string) => hostError(`[trace repl LINE event: ${JSON.stringify(l)}]`));
      inst.on('flushHistory', () => hostError('[trace repl flushHistory event]'));
      inst.on('exit', () => {
        const hm: any = inst.historyManager;
        const symbols = Object.getOwnPropertySymbols(hm ?? {});
        const bits: string[] = [];
        for (const s of symbols) {
          const d = String(s.description ?? '');
          const v = hm[s];
          if (/isflush|timer|pending|writing/i.test(d)) bits.push(`${d}=${v === null ? 'null' : typeof v === 'object' ? 'obj' : String(v)}`);
        }
        hostError(`[trace repl EXIT event | isFlushing=${hm?.isFlushing} | ${bits.join(' ')}]`);
      });
      return inst;
    };
    kernel.require('internal/main/repl');
    const anyProc2: any = kernel.process;
    anyProc2.on('exit', (c: number) => hostError(`[trace process.exit event code=${c}]`));
    const origProcExit = anyProc2.exit;
    anyProc2.exit = function (c?: number) {
      hostError(`[trace process.exit(${c}) called]`);
      try {
        const r = origProcExit.call(this, c);
        hostError('[trace process.exit RETURNED]');
        return r;
      } catch (e: any) {
        hostError(`[trace process.exit THREW] ${e?.stack ?? e}`);
        throw e;
      }
    };
    // Instrument readline Interface.close to see how far close() gets.
    const rl: any = kernel.require('readline');
    const proto = rl.Interface?.prototype ?? rl.createInterface?.({})?.constructor?.prototype;
    if (proto?.close) {
      const origClose = proto.close;
      proto.close = function (...a: any[]) {
        hostError('[trace Interface.close start]');
        try {
          const r = origClose.apply(this, a);
          hostError('[trace Interface.close done]');
          return r;
        } catch (e: any) {
          hostError(`[trace Interface.close THREW] ${e?.stack ?? e}`);
          throw e;
        }
      };
    } else {
      hostError('[trace] could not patch Interface.close');
    }
    const ttyBinding2: any = kernel.natives.get('tty_wrap');
    const sleep2 = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await sleep2(300);
    kernel.startLoopDrainWatcher();
    ttyBinding2.feedStdin('.exit\r');
    (globalThis as any).__ocDrainTicks?.();
    await sleep2(800);
    hostError(`[trace min] _exiting=${anyProc2._exiting}`);
    await sleep2(400);
    return;
  }
  if (arg.startsWith('@main:')) {
    // runMain test: write a demo file via VFS then executeUserEntryPoint.
    const path = arg.slice('@main:'.length);
    kernel.vfs.writeFile('/home/project/main.js', 'console.log("main.js ran:", 40+2);\n');
    hostError(`--- kernel.runMain('${path}') ---`);
    await kernel.runMain(path);
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  if (arg.startsWith('@internal:')) {
    // Kernel-side internal require (the realm loader path node itself uses).
    const id = arg.slice('@internal:'.length);
    hostError(`--- kernel.require('${id}') ---`);
    const mod = kernel.require(id);
    hostError(`[ok] typeof = ${typeof mod}` + (mod && typeof mod === 'object'
      ? ` | keys: ${Object.keys(mod).slice(0, 12).join(',')}`
      : ''));
    await new Promise((r) => setTimeout(r, 150));
    return;
  }
  await kernel.runEval(arg);
  await new Promise((r) => setTimeout(r, 150));
}

main().catch((err) => {
  hostError('\n=== KERNEL BOOT/RUN FAILURE ===');
  hostError(err && err.stack ? err.stack : err);
  hostExit(1);
});

const hostExit = (c: number) => process.exit(c);
