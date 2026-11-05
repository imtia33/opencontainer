import type { Binding, NativesContext } from './index';

/** internalBinding('fs_event_wrap') — FSWatcher backend over vfs.watch.
 *  node names the JS-visible class FSEvent (watchers.js destructures it). */
export function makeFsEventBinding(ctx: NativesContext): Binding {
  const watchers = new Map<number, { close(): void }>();
  let nextId = 1;

  const FSEvent = class FSEvent {
    onchange: ((status: number, event: string, filename: string) => void) | null = null;
    _id = 0;

    constructor(path?: string, _req?: any, _persistent?: boolean) {
      if (path !== undefined) this.watch(String(path));
    }

    watch(path: string): void {
      const id = nextId++;
      const hostWatcher = ctx.vfs.watch(path, (event) => {
        // node's fs.js listens on the JS object's onchange
        this.onchange?.(0, event.type, event.filename);
      });
      watchers.set(id, hostWatcher);
      this._id = id;
    }

    start(path: string, _persistent: boolean): void {
      this.watch(String(path));
    }

    close(): void {
      const w = watchers.get(this._id);
      w?.close();
      watchers.delete(this._id);
    }
    ref() {}
    unref() {}
  };

  return {
    FSEvent,
    FSWatcher: FSEvent, // legacy alias (older consumers)
  };
}
