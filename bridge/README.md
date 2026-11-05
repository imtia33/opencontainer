# Host-side bridges

The OpenContainer kernel runs entirely in the browser — but two pieces of
infrastructure must live on the **host server** that serves the embedding
page. They are included here as reference implementations (Next.js App
Router route handlers) that you can port to any server runtime
(Node http / Express / Bun serve / etc.). They are deliberately tiny.

## `oc-net.route.ts` — npm registry CORS bridge

**Why it exists:** guest npm's networking (`make-fetch-happen` →
`@npmcli/agent` → node http/https) runs on worker `fetch()`. Direct browser
fetch to `registry.npmjs.org` fails CORS on npm's preflighted POSTs (e.g.
`/-/npm/v1/security/advisories/bulk` during `npm audit`). The guest's
fetch-backed HTTP client
(`src/packages/opencontainer/kernel/http-fetch-client.ts`) therefore
rewrites registry URLs onto this same-origin hop.

**Security posture (keep it if you port it):**

- Destination allowlist is **hard-coded**: `registry.npmjs.org` +
  `registry.npmjs.com`, https only — there is no knob to point it anywhere
  else, so SSRF is impossible by construction.
- Guest npm is **anonymous** through the bridge: `authorization` and
  `cookie` headers are never forwarded; only content-negotiation headers,
  read-only conditional-GET validators, and npm's own `npm-*` advisory
  headers pass through.
- 10 MB body cap, 15 s upstream timeout, `cache-control: no-store`, no
  redirect-following beyond what the server fetch does transparently.

**Mounting (Next.js):** copy to `src/app/api/oc-net/route.ts`.

## `gh-import.route.ts` — GitHub tarball import proxy

**Why it exists:** the IDE's "import from GitHub" needs the repo tarball.
`codeload.github.com` is CORS-locked to `render.githubusercontent.com`, and
`api.github.com` is rate-limited (60/h per IP, shared across the egress).
This proxy does a `HEAD` on codeload for the default branch ref, streams
the tarball through, and 404s honestly for missing/private repos.

**Security posture:** read-only, GET/HEAD only, codeload.github.com only,
no credentials forwarded, no client-controlled redirect targets.

**Mounting (Next.js):** copy to `src/app/api/gh-import/route.ts`.

## Porting notes

Both handlers use only `fetch` + `NextRequest`/`NextResponse`. In a plain
Node server, replace the `NextResponse` wrappers with standard
`Response` objects — the logic is otherwise dependency-free.
