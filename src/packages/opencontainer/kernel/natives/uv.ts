import type { Binding } from './index';

const UV_ERRNO_TO_NAME: Record<number, string> = {
  [-1]: 'EPERM', [-2]: 'ENOENT', [-3]: 'ESRCH', [-4]: 'EINTR', [-5]: 'EIO',
  [-6]: 'ENXIO', [-7]: 'E2BIG', [-8]: 'ENOEXEC', [-9]: 'EBADF', [-10]: 'ECHILD',
  [-11]: 'EAGAIN', [-12]: 'ENOMEM', [-13]: 'EACCES', [-14]: 'EFAULT',
  [-15]: 'ENOTBLK', [-16]: 'EBUSY', [-17]: 'EEXIST', [-18]: 'EXDEV',
  [-19]: 'ENODEV', [-20]: 'ENOTDIR', [-21]: 'EISDIR', [-22]: 'EINVAL',
  [-23]: 'ENFILE', [-24]: 'EMFILE', [-25]: 'ENOTTY', [-26]: 'ETXTBSY',
  [-27]: 'EFBIG', [-28]: 'ENOSPC', [-29]: 'ESPIPE', [-30]: 'EROFS',
  [-31]: 'EMLINK', [-32]: 'EPIPE', [-33]: 'EDOM', [-34]: 'ERANGE',
  [-40]: 'ELOOP', [-61]: 'ENODATA', [-84]: 'ECHARSET', [-98]: 'EADDRINUSE',
  [-99]: 'EADDRNOTAVAIL', [-97]: 'EAFNOSUPPORT', [-103]: 'ECONNABORTED',
  [-104]: 'ECONNRESET', [-111]: 'ECONNREFUSED', [-110]: 'ETIMEDOUT',
  [-113]: 'EHOSTUNREACH', [-115]: 'EINPROGRESS', [-125]: 'ECANCELED',
};

/** internalBinding('uv') — libuv constants + helpers. */
export function makeUvBinding(): Binding {
  return {
    UV_EINVAL: -22,
    UV_ENOENT: -2,
    UV_ENOSPC: -28,
    UV_EOF: -4095,
    // Full errno surface (internal/errors.js errno map + fs consumers).
    UV_E2BIG: -7, UV_EACCES: -13, UV_EADDRINUSE: -98, UV_EADDRNOTAVAIL: -99,
    UV_EAFNOSUPPORT: -97, UV_EAGAIN: -11, UV_EALREADY: -114, UV_EBADF: -9,
    UV_EBUSY: -16, UV_ECANCELED: -125, UV_ECHARSET: -84, UV_ECONNABORTED: -103,
    UV_ECONNREFUSED: -111, UV_ECONNRESET: -104, UV_EDESTADDRREQ: -89,
    UV_EEXIST: -17, UV_EFAULT: -14, UV_EFBIG: -27, UV_EHOSTDOWN: -112,
    UV_EHOSTUNREACH: -113, UV_EINTR: -4, UV_EISCONN: -106, UV_EISDIR: -21,
    UV_ELOOP: -40, UV_EMFILE: -24, UV_EMSGSIZE: -90, UV_ENAMETOOLONG: -36,
    UV_ENETDOWN: -100, UV_ENETUNREACH: -101, UV_ENFILE: -23, UV_ENOBUFS: -105,
    UV_ENODEV: -19, UV_ENOEXEC: -8, UV_ENOLCK: -37, UV_ENOLINK: -67,
    UV_ENOMEM: -12, UV_ENOMSG: -42, UV_ENOPROTOOPT: -92, UV_ENOSPC: -28,
    UV_ENOSYS: -38, UV_ENOTCONN: -107, UV_ENOTDIR: -20, UV_ENOTEMPTY: -39,
    UV_ENOTSOCK: -88, UV_ENOTSUP: -95, UV_ENOTTY: -25, UV_ENXIO: -6,
    UV_EOPNOTSUPP: -95, UV_EOVERFLOW: -75, UV_EPERM: -1, UV_EPIPE: -32,
    UV_EPROTO: -71, UV_EPROTONOSUPPORT: -93, UV_EPROTOTYPE: -91,
    UV_ERANGE: -34, UV_EROFS: -30, UV_ESHUTDOWN: -108, UV_ESPIPE: -29,
    UV_ESRCH: -3, UV_ETIMEDOUT: -110, UV_ETXTBSY: -26, UV_EXDEV: -18,
    // dirent types (fs_dir + internal/fs/utils).
    UV_DIRENT_UNKNOWN: 0, UV_DIRENT_FILE: 1, UV_DIRENT_DIR: 2,
    UV_DIRENT_LINK: 3, UV_DIRENT_FIFO: 4, UV_DIRENT_SOCKET: 5,
    UV_DIRENT_CHAR: 6, UV_DIRENT_BLOCK: 7,

    errmap: null,

    /** node's internal/errors.js uvErrmapGet: Map<errno, [name, message]>. */
    getErrorMap(): Map<number, [string, string]> {
      const map = new Map<number, [string, string]>();
      for (const [errno, name] of Object.entries(UV_ERRNO_TO_NAME)) {
        map.set(Number(errno), [name, '']);
      }
      return map;
    },

    uvErrnoUcToName(errno: number): string | undefined {
      return UV_ERRNO_TO_NAME[errno];
    },

    errnoToUVErrorCode(errno: number): number { return -errno; },
    uvFormatError(code: number): string { return `libuv error ${code}`; },

    /** used by internal/errors for stacked errors */
    getLastError(): number { return 0; },
    getOSHandleWait(): undefined { return undefined; },
  };
}
