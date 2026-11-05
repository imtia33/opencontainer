import { NextRequest, NextResponse } from 'next/server';

/**
 * GitHub tarball proxy — server-side import path for the IDE.
 *
 * Why this exists (S9 fix): the browser cannot fetch codeload.github.com
 * directly (CORS locks `access-control-allow-origin` to
 * render.githubusercontent.com), and api.github.com is rate-limited to
 * 60 req/h per IP — shared preview egress exhausts it instantly, which
 * made every "import from GitHub" fail. Fetching from the Next.js server
 * has neither restriction, and codeload's `HEAD` ref follows the default
 * branch WITHOUT touching the rate-limited REST API.
 *
 * GET /api/gh-import?url=https://github.com/owner/repo[&branch=main]
 *   → 200 application/x-gzip (the tarball bytes)
 *   → 4xx/5xx application/json { error } on failure
 */

export const dynamic = 'force-dynamic';

const URL_RE =
  /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? '';
  const branch = (req.nextUrl.searchParams.get('branch') ?? '').trim() || 'HEAD';
  const m = raw.trim().match(URL_RE);
  if (!m) {
    return NextResponse.json(
      { error: 'Not a GitHub repository (expected owner/repo or a github.com URL)' },
      { status: 400 },
    );
  }
  const [, owner, repo] = m;

  // Ref sanity: HEAD, a branch/tag name, or a SHA — never a path.
  const safeBranch = branch.replace(/[^A-Za-z0-9._-]/g, '');
  if (!safeBranch) {
    return NextResponse.json({ error: 'Invalid branch/ref' }, { status: 400 });
  }

  const upstream = await fetch(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(safeBranch)}`,
    { redirect: 'follow' },
  ).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: `GitHub unreachable for ${owner}/${repo}` }, { status: 502 });
  }
  if (!upstream.ok) {
    if (upstream.status === 404) {
      return NextResponse.json(
        {
          error:
            `Repository or ref not found: ${owner}/${repo} ` +
            `(${branch === 'HEAD' ? 'default branch' : branch}) — private repos are not supported`,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: `GitHub returned HTTP ${upstream.status} for ${owner}/${repo}` },
      { status: 502 },
    );
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: `Empty tarball for ${owner}/${repo}` }, { status: 502 });
  }
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': 'application/x-gzip',
      'content-length': String(buf.byteLength),
      'x-oc-repo': `${owner}/${repo}`,
      'x-oc-ref': safeBranch,
      'cache-control': 'no-store',
    },
  });
}
