import type { Binding } from './index';

/** internalBinding('url_pattern') — the browser's URLPattern when available. */
export function makeUrlPatternBinding(): Binding {
  return {
    URLPattern: (globalThis as any).URLPattern ?? class URLPattern {
      constructor(...args: any[]) {
        throw new Error('URLPattern is not supported in this browser');
      }
    },
  };
}

const OMITTED = 4294967295;
const SCHEME_TYPES: Record<string, number> = {
  'http:': 0, 'https:': 2, 'ws:': 3, 'ftp:': 4, 'wss:': 5, 'file:': 6,
};

function computeComponents(href: string, u: URL): number[] {
  const c = new Array(9).fill(OMITTED);
  c[0] = href.indexOf(':') + 1; // protocol_end (includes ':')
  const afterAuth = c[0] + 2;   // skip '//'
  // userinfo
  let hostStart = afterAuth;
  const at = href.indexOf('@', afterAuth);
  const slash = href.indexOf('/', afterAuth);
  const q = href.indexOf('?', afterAuth);
  const h = href.indexOf('#', afterAuth);
  const limits = [slash, q, h].filter((i) => i !== -1);
  const authEnd = limits.length ? Math.min(...limits) : href.length;
  if (at !== -1 && at < authEnd) {
    c[1] = at + 1; // username_end (end of userinfo)
    hostStart = at + 1;
  } else {
    c[1] = afterAuth;
  }
  c[2] = hostStart; // host_start
  // host_end: before port ':' or authority end
  const colon = href.indexOf(':', hostStart);
  const hostEnd = (colon !== -1 && colon < authEnd) ? colon : authEnd;
  c[3] = hostEnd;
  if (u.port) {
    c[4] = Number(u.port);
  } else {
    c[4] = OMITTED;
  }
  // pathname
  if (u.pathname) {
    c[5] = href.indexOf(u.pathname, Math.max(hostEnd, hostStart));
    if (c[5] === -1) c[5] = OMITTED;
  } else {
    c[5] = hostEnd;
  }
  const searchIdx = href.indexOf('?');
  c[6] = searchIdx === -1 ? OMITTED : searchIdx;
  const hashIdx = href.indexOf('#');
  c[7] = hashIdx === -1 ? OMITTED : hashIdx;
  c[8] = SCHEME_TYPES[u.protocol] ?? 1; // NOT_SPECIAL
  return c;
}

/** internalBinding('url') — WHATWG URL natives on the browser's URL. */
export function makeUrlBinding(): Binding {
  const urlComponents: number[] = new Array(9).fill(0);

  return {
    URL: URL,
    urlComponents,

    parse(input: string, base?: string, raiseException?: any): string | undefined {
      try {
        const u = base !== undefined && base !== null && base !== false
          ? new URL(input, String(base))
          : new URL(input);
        const href = u.href;
        const c = computeComponents(href, u);
        for (let i = 0; i < 9; i++) urlComponents[i] = c[i];
        return href;
      } catch (e) {
        if ((globalThis as any).__ocUrlDebug) {
          (globalThis as any).__ocUrlDebug({
            input: typeof input === 'string' ? input.slice(0, 120) : String(input),
            baseType: typeof base,
            base: typeof base === 'object' && base !== null
              ? `URL-ctor:${base?.constructor?.name} toString:${(() => { try { return String(base).slice(0, 120); } catch (err: any) { return 'THREW:' + err.message; } })()}`
              : String(base),
            err: e?.message,
          });
        }
        if (raiseException === true) throw e;
        return undefined;
      }
    },
    /**
     * node's C++ bindingUrl.update: apply a component mutation to a href and
     * return the re-serialized href ('' when the result would be invalid).
     * Also refreshes the shared urlComponents array — lib/internal/url.js's
     * setURLContextFromBinding() reads it right after every update.
     * Action codes mirror lib/internal/url.js updateActions.
     */
    update(href: string, action: number, value: string): string {
      try {
        const u = new URL(href);
        switch (action) {
          case 0: u.protocol = value; break;   // kProtocol
          case 1: u.host = value; break;       // kHost
          case 2: u.hostname = value; break;   // kHostname
          case 3: u.port = value; break;       // kPort
          case 4: u.username = value; break;   // kUsername
          case 5: u.password = value; break;   // kPassword
          case 6: u.pathname = value; break;   // kPathname
          case 7: u.search = value; break;     // kSearch
          case 8: u.hash = value; break;       // kHash
          case 9: {                            // kHref (must be absolute)
            const u2 = new URL(value);
            const c2 = computeComponents(u2.href, u2);
            for (let i = 0; i < 9; i++) urlComponents[i] = c2[i];
            return u2.href;
          }
        }
        const c = computeComponents(u.href, u);
        for (let i = 0; i < 9; i++) urlComponents[i] = c[i];
        return u.href;
      } catch {
        return '';
      }
    },
    /**
     * node's bindingUrl.format: re-serialize a href honoring the
     * fragment/unicode/search/auth flags (node_url.cc Format).
     * unicode → approximation: the browser serializer keeps punycode ASCII.
     */
    format(href: string, fragment: boolean, _unicode: boolean, search: boolean, auth: boolean): string {
      try {
        const u = new URL(href);
        if (!fragment) u.hash = '';
        if (!search) u.search = '';
        if (!auth) { u.username = ''; u.password = ''; }
        return u.href;
      } catch {
        return href;
      }
    },
    /** node's bindingUrl.getOrigin: serialized origin ('null' for opaque). */
    getOrigin(url: any): string {
      try {
        return new URL(url?.href ?? String(url)).origin || 'null';
      } catch {
        return 'null';
      }
    },
    canParse(input: string, base?: string): boolean {
      try {
        if (base !== undefined) new URL(input, base);
        else new URL(input);
        return true;
      } catch { return false; }
    },
    domainToASCII(domain: string): string | null {
      try { return new URL(`http://${domain}`).hostname; } catch { return null; }
    },
    domainToUnicode(domain: string): string | null {
      // Browsers normalize to unicode when displaying; approximate via URL
      try { return new URL(`http://${domain}`).hostname; } catch { return null; }
    },
    encodeAuth: (u: any) => u,
    hrefAsBlob: undefined,
    blobFromDataUrl: undefined,
    URLSearchParams: URLSearchParams,
    pathToFileURL(path: string, _isWindows?: boolean, _base?: string): string {
      // C++ contract: returns the parsed HREF STRING (never a URL object!) —
      // the internal/url.js URLContext stores it as #context.href; an object
      // there breaks every later ToPrimitive (`${base}` → "No default value").
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const u = new URL(`file://${encoded.startsWith('/') ? encoded : '/' + encoded}`);
      const c = computeComponents(u.href, u);
      for (let i = 0; i < 9; i++) urlComponents[i] = c[i];
      return u.href;
    },
    fileURLToPath(url: string | URL): string {
      const u = typeof url === 'string' ? new URL(url) : url;
      if (u.protocol !== 'file:') throw new Error('ERR_INVALID_URL_SCHEME: must be file');
      return decodeURIComponent(u.pathname);
    },
    URLPattern: (globalThis as any).URLPattern ?? class URLPattern {
      constructor(...args: any[]) {
        throw new Error('URLPattern is not supported in this browser');
      }
    },

    // NOTE: there was previously a SECOND `parse(url)` key at the end of this
    // object (returning `{ href }`) — object literals deduplicate by LAST
    // occurrence, so that stale debug shim silently shadowed the real
    // `parse(input, base, raiseException)` contract above and broke node's
    // internal URL constructor (esm exports resolution). Removed.
  };
}
