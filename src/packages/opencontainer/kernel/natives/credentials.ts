import type { Binding, NativesContext } from './index';

/** internalBinding('credentials') — root-priv checks + env safety. */
export function makeCredentialsBinding(ctx: NativesContext): Binding {
  return {
    isRootUserId: false,
    safeGetenv(name: string): string | undefined {
      // node restricts safeGetenv to NODE_* variables when untrusted code may read env
      if (name.startsWith('NODE_')) return ctx.hooks.env()[name];
      return undefined;
    },
    getTempDir() { return '/tmp'; },
    getEmbedderOptions() { return { shouldNotRegisterESMLoader: false, globalServicing: false, shouldExitOnUncaughtException: false, noGlobalSearchPaths: false, compileSnapshotAsMainModule: false, hasInspector: false }; },
    getCIDR() { return null; },
  };
}
