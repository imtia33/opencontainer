import type { Binding } from './index';

/** internalBinding('os') — host info (honest: browser platform). */
export function makeOsBinding(): Binding {
  return {
    getOSInformation(): [string, string] {
      return ['browser', ''];
    },
    getHomeDir(): string { return '/home/node'; },
    getHomeDirectory(): string { return '/home/node'; },
    getPasswdUid(): number { return 0; },
    getUserInfoByUid(): { username: string; uid: number; gid: number; homedir: string; shell: string } {
      return { username: 'node', uid: 0, gid: 0, homedir: '/home/node', shell: '/bin/jsh' };
    },
    getUserInfo: () => ({ username: 'node', uid: 0, gid: 0, homedir: '/home/node', shell: '/bin/jsh' }),
    getFreeMem: () => 1 << 30,
    getTotalMem: () => 4 * (1 << 30),
    getLoadAvg: () => [0, 0, 0],
    getUptime: () => 0,
    getPriority: () => 0,
    setPriority() { throw new Error('os.setPriority is not supported in OpenContainer'); },
    getCPUs: () => [{ model: 'browser-jit', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
    getInterfaceAddresses: () => ({}),
    getHostname: () => 'opencontainer',
    getAvailableParallelism: () => 1, // single-threaded execution model (like single-core container)
    getEndianness: () => 'LE',
    isBigEndian: () => false,
    dlopen: () => { throw new Error('process.dlopen not supported'); },
  };
}
