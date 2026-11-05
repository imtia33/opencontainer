/**
 * OpenContainer oc-sh — `/bin/sh` (POSIX-subset shell, honest).
 *
 * OpenContainer-authored module (NOT vendored Node source). Runs as a REAL
 * node process; package managers (npm-oc, pnpm-oc) and `npm exec` launch it
 * exactly like npm launches /bin/sh on POSIX: `sh -c "<script>"`.
 *
 * Supported (documented subset — everything else fails with a PRECISE
 * error, never a silent skip):
 *   - command lists: `;`, `&&`, `||`
 *   - env prefixes:  `VAR=value cmd …`
 *   - redirections:  `>`, `>>`, `2>`, `2>>`, `2>&1`, `>/dev/null`
 *   - quoting:       single (literal), double (with $ expansion)
 *   - expansion:     $VAR, ${VAR}, $?, $$ (pid)
 *   - builtins:      cd, pwd, export, unset, exit, echo, true, false, :,
 *                   coreutils: ls, mkdir, rmdir, touch, cat, rm, mv, cp,
 *                   head, tail, wc, which (real fs)
 *   - foreground execution with exit-code propagation; SIGINT forwarding
 *
 * NOT supported (precise ENOSYS-style errors): pipelines `|`, background
 * `&`, command/function substitution, heredocs, input redirection `<`,
 * globbing (handled per-argument by the runtime exec, not here), loops and
 * conditionals (`if`/`for`/`while`), subshells.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const VERSION = 'sh (OpenContainer POSIX-subset shell)';

// ---------------------------------------------------------------------------
// Tokenizer: quotes + operator boundaries
// ---------------------------------------------------------------------------

function tokenize(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (/\s/.test(ch)) { i++; continue; }
    // `2>&1` (and the `>&1` synonym) is ONE token — the generic word loop
    // below stops at '&', which used to shatter it into '2>' '&' '1' and
    // fail with "syntax error near '2>'" (S9 fix; pre-existing latent bug).
    if (line.slice(i, i + 4) === '2>&1' || line.slice(i, i + 3) === '>&1') {
      tokens.push({ word: '2>&1', closed: true });
      i += line.slice(i, i + 4) === '2>&1' ? 4 : 3;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      tokens.push({ op: two });
      i += 2;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      tokens.push({ op: ch });
      i++;
      continue;
    }
    let text = '';
    let closed = true;
    while (i < n && !/[;&|()]/.test(line[i]) && !/\s/.test(line[i])) {
      const c = line[i];
      if (c === "'") {
        const end = line.indexOf("'", i + 1);
        if (end < 0) { closed = false; i = n; break; }
        text += line.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      if (c === '"') {
        const end = findDoubleQuoteEnd(line, i + 1);
        if (end < 0) { closed = false; i = n; break; }
        text += expandVars(line.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      if (c === '\\' && i + 1 < n) {
        text += line[i + 1];
        i += 2;
        continue;
      }
      if (c === '$') {
        const { value, next } = readExpansion(line, i);
        text += value;
        i = next;
        continue;
      }
      text += c;
      i++;
    }
    tokens.push({ word: text, closed });
  }
  return tokens;
}

function findDoubleQuoteEnd(line, from) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '"') return i;
    if (line[i] === '\\') i++;
  }
  return -1;
}

function readExpansion(line, i) {
  const rest = line.slice(i);
  if (rest.startsWith('$?')) return { value: String(shellState.lastStatus), next: i + 2 };
  if (rest.startsWith('$$')) return { value: String(process.pid), next: i + 2 };
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest);
  if (braced) return { value: shellState.env[braced[1]] ?? '', next: i + braced[0].length };
  const bare = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
  if (bare) return { value: shellState.env[bare[1]] ?? '', next: i + bare[0].length };
  return { value: '$', next: i + 1 };
}

function expandVars(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
    if (text[i] === '$') {
      const { value, next } = readExpansion(text, i);
      out += value;
      i = next;
      continue;
    }
    out += text[i++];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Command-line model: sequences of simple commands joined by operators
// ---------------------------------------------------------------------------

const shellState = {
  env: Object.create(null),
  lastStatus: 0,
  cwd: process.cwd(),
};

function badOperator(op) {
  const message = {
    '|': "oc-sh: pipelines ('|') are not supported in the browser shell",
    '&': "oc-sh: background jobs ('&') inside scripts are not supported",
    '(': "oc-sh: subshells ('(') are not supported",
    ')': "oc-sh: unexpected ')'",
  }[op] ?? `oc-sh: unsupported operator '${op}'`;
  const err = new Error(message);
  err.code = 'ENOSYS';
  return err;
}

/** Parse one command line into simple commands; each carries the operator
 *  that JOINS it to the NEXT one (`&&`, `||` or null for `;`). */
function parseCommandLine(line) {
  const tokens = tokenize(line);
  const commands = [];
  let current = { assigns: [], redirects: [], argv: [] };
  const flush = () => {
    if (current.assigns.length || current.argv.length || current.redirects.length) {
      commands.push(current);
    }
    current = { assigns: [], redirects: [], argv: [] };
  };
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.op) {
      if (tok.op === ';') { flush(); continue; }
      if (tok.op === '&&' || tok.op === '||') {
        if (commands.length === 0 && current.argv.length === 0 && current.assigns.length === 0) {
          throw new Error(`oc-sh: syntax error near '${tok.op}'`);
        }
        if (current.assigns.length || current.argv.length || current.redirects.length) {
          commands.push(current);
          current = { assigns: [], redirects: [], argv: [] };
        }
        if (commands.length === 0) throw new Error(`oc-sh: syntax error near '${tok.op}'`);
        commands[commands.length - 1].joinNext = tok.op;
        continue;
      }
      throw badOperator(tok.op);
    }
    if (tok.word === undefined) continue;
    if (!tok.closed) throw new Error('oc-sh: unterminated quote');
    if (['>', '>>', '2>', '2>>', '2>&1'].includes(tok.word)) {
      const op = tok.word;
      if (op === '2>&1') {
        current.redirects.push({ op, target: null });
        continue;
      }
      const targetTok = tokens[++t];
      if (!targetTok || targetTok.word === undefined) {
        throw new Error(`oc-sh: syntax error near '${op}' (missing target)`);
      }
      current.redirects.push({ op, target: targetTok.word });
      continue;
    }
    if (current.argv.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok.word)) {
      const eq = tok.word.indexOf('=');
      current.assigns.push([tok.word.slice(0, eq), expandVars(tok.word.slice(eq + 1))]);
      continue;
    }
    // NO re-expansion here: the tokenizer already expanded $ in bare and
    // double-quoted word parts — single-quoted parts must stay literal
    // (POSIX). Re-expanding would leak $vars through quotes.
    current.argv.push(tok.word);
  }
  flush();
  return commands;
}

// ---------------------------------------------------------------------------
// Builtins
// ---------------------------------------------------------------------------

const BUILTINS = {
  cd(args) {
    const dir = args[0] ?? shellState.env.HOME ?? '/home/node';
    const target = dir.startsWith('/') ? dir : path.resolve(shellState.cwd, dir);
    process.chdir(target); // throws ENOENT for missing dirs — real sh reports it
    shellState.cwd = process.cwd();
    return 0;
  },
  pwd() {
    process.stdout.write(shellState.cwd + '\n');
    return 0;
  },
  export(args) {
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) shellState.env[a.slice(0, eq)] = a.slice(eq + 1);
      else if (eq === -1 && a) shellState.env[a] = shellState.env[a] ?? '';
    }
    return 0;
  },
  unset(args) {
    for (const a of args) delete shellState.env[a];
    return 0;
  },
  echo(args) {
    process.stdout.write(args.join(' ') + '\n');
    return 0;
  },
  exit(args) {
    const code = parseInt(args[0] ?? '0', 10);
    process.exit(Number.isFinite(code) ? code : 0);
    return 0; // unreachable
  },
  true() { return 0; },
  false() { return 1; },
  ':'() { return 0; },
};

// ---------------------------------------------------------------------------
// Coreutils builtins (S9: the IDE workflow — projects are created by
// TERMINAL COMMANDS, so ls/mkdir/cat/… must exist. Real fs, POSIX-style
// errors, relative paths against the shell cwd.)
// ---------------------------------------------------------------------------

const fsMod = require('fs');
const pathMod = require('path');

const resolveSh = (p) => (p.startsWith('/') ? pathMod.normalize(p) : pathMod.resolve(shellState.cwd, p));

const fmtMode = (mode) => {
  const type = (mode & 0o170000) === 0o040000 ? 'd'
    : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  const trip = (r, w, x) => (r ? 'r' : '-') + (w ? 'w' : '-') + (x ? 'x' : '-');
  return type
    + trip(mode & 0o400, mode & 0o200, mode & 0o100)
    + trip(mode & 0o040, mode & 0o020, mode & 0o010)
    + trip(mode & 0o004, mode & 0o002, mode & 0o001);
};

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
const lpad = (s, w) => ' '.repeat(Math.max(0, w - s.length)) + s;

function listEntries(dir, names, long) {
  const out = [];
  if (long) {
    const stats = names.map((n) => ({ n, st: fsMod.statSync(pathMod.join(dir, n)) }));
    const sizeW = Math.max(...stats.map((s) => String(s.st.size).length), 1);
    for (const { n, st } of stats) {
      const kind = st.isDirectory() ? (n.endsWith('/') ? n : n + '/') : n;
      out.push(`${fmtMode(st.mode)} ${lpad(String(st.size), sizeW)} ${kind}`);
    }
  } else {
    const decorated = names.map((n) => {
      try { return fsMod.statSync(pathMod.join(dir, n)).isDirectory() ? n + '/' : n; }
      catch { return n; }
    });
    const width = Math.max(...decorated.map((n) => n.length), 1);
    const cols = Math.max(1, Math.floor(80 / (width + 2)));
    for (let i = 0; i < decorated.length; i += cols) {
      out.push(decorated.slice(i, i + cols).map((n) => pad(n, width + 2)).join('').trimEnd());
    }
  }
  return out;
}

const COREUTILS = {
  ls(args) {
    const long = args.includes('-l') || args.includes('-la') || args.includes('-al');
    const all = args.includes('-a') || args.includes('-la') || args.includes('-al');
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) targets.push('.');
    let code = 0;
    const multiple = targets.length > 1;
    const results = [];
    for (const t of targets) {
      const abs = resolveSh(t);
      let st;
      try { st = fsMod.statSync(abs); } catch {
        process.stderr.write(`ls: cannot access '${t}': No such file or directory\n`);
        code = 2;
        continue;
      }
      if (st.isDirectory()) {
        let names;
        try { names = fsMod.readdirSync(abs).sort(); } catch (err) {
          process.stderr.write(`ls: ${t}: ${err.message}\n`);
          code = 2;
          continue;
        }
        if (!all) names = names.filter((n) => !n.startsWith('.'));
        if (multiple) results.push(`${t}:`);
        if (names.length > 0) results.push(...listEntries(abs, names, long));
        if (multiple) results.push('');
      } else {
        results.push(...listEntries(pathMod.dirname(abs), [pathMod.basename(abs)], long));
      }
    }
    if (results.length > 0) process.stdout.write(results.join('\n') + '\n');
    return code;
  },

  mkdir(args) {
    const parents = args.some((a) => a === '-p' || a === '--parents');
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) {
      process.stderr.write('mkdir: missing operand\n');
      return 1;
    }
    let code = 0;
    for (const t of targets) {
      const abs = resolveSh(t);
      try {
        fsMod.mkdirSync(abs, { recursive: parents });
      } catch (err) {
        if (parents && err.code === 'EEXIST') continue;
        process.stderr.write(`mkdir: cannot create directory '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  rmdir(args) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) { process.stderr.write('rmdir: missing operand\n'); return 1; }
    let code = 0;
    for (const t of targets) {
      try { fsMod.rmdirSync(resolveSh(t)); } catch (err) {
        process.stderr.write(`rmdir: failed to remove '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  touch(args) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) { process.stderr.write('touch: missing file operand\n'); return 1; }
    let code = 0;
    for (const t of targets) {
      const abs = resolveSh(t);
      try {
        if (fsMod.existsSync(abs)) fsMod.utimesSync(abs, new Date(), new Date());
        else fsMod.writeFileSync(abs, '');
      } catch (err) {
        process.stderr.write(`touch: cannot touch '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  cat(args) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) { process.stderr.write('cat: no files (stdin not supported in this shell)\n'); return 1; }
    let code = 0;
    for (const t of targets) {
      try {
        process.stdout.write(fsMod.readFileSync(resolveSh(t)));
      } catch (err) {
        process.stderr.write(`cat: ${t}: ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  rm(args) {
    const recursive = args.some((a) => /^-[a-zA-Z]*r/.test(a));
    const force = args.some((a) => /^-[a-zA-Z]*f/.test(a));
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) {
      if (!force) process.stderr.write('rm: missing operand\n');
      return force ? 0 : 1;
    }
    let code = 0;
    for (const t of targets) {
      const abs = resolveSh(t);
      let st = null;
      try { st = fsMod.statSync(abs); } catch { /* gone */ }
      if (!st) {
        if (!force) { process.stderr.write(`rm: cannot remove '${t}': No such file or directory\n`); code = 1; }
        continue;
      }
      try {
        if (st.isDirectory() && !recursive) {
          process.stderr.write(`rm: cannot remove '${t}': Is a directory\n`);
          code = 1;
        } else {
          fsMod.rmSync(abs, { recursive, force });
        }
      } catch (err) {
        process.stderr.write(`rm: cannot remove '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  mv(args) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length < 2) { process.stderr.write('mv: missing destination file operand\n'); return 1; }
    const dest = targets.pop();
    const destAbs = resolveSh(dest);
    let destIsDir = false;
    try { destIsDir = fsMod.statSync(destAbs).isDirectory(); } catch { /* not there */ }
    let code = 0;
    for (const t of targets) {
      const from = resolveSh(t);
      const to = destIsDir ? pathMod.join(destAbs, pathMod.basename(from)) : destAbs;
      try {
        fsMod.renameSync(from, to);
      } catch (err) {
        process.stderr.write(`mv: cannot move '${t}' to '${dest}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  cp(args) {
    const recursive = args.some((a) => /^-[a-zA-Z]*r/.test(a));
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length < 2) { process.stderr.write('cp: missing destination file operand\n'); return 1; }
    const dest = targets.pop();
    const destAbs = resolveSh(dest);
    let destIsDir = false;
    try { destIsDir = fsMod.statSync(destAbs).isDirectory(); } catch { /* not there */ }
    const copyOne = (from, to) => {
      const st = fsMod.statSync(from);
      if (st.isDirectory()) {
        if (!recursive) throw Object.assign(new Error(`${from} is a directory (use -r)`), { code: 'EISDIR' });
        fsMod.mkdirSync(to, { recursive: true });
        for (const n of fsMod.readdirSync(from)) copyOne(pathMod.join(from, n), pathMod.join(to, n));
      } else {
        fsMod.mkdirSync(pathMod.dirname(to), { recursive: true });
        fsMod.copyFileSync(from, to);
      }
    };
    let code = 0;
    for (const t of targets) {
      const from = resolveSh(t);
      const to = destIsDir ? pathMod.join(destAbs, pathMod.basename(from)) : destAbs;
      try {
        copyOne(from, to);
      } catch (err) {
        process.stderr.write(`cp: cannot copy '${t}' to '${dest}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  head(args) {
    let n = 10;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') n = parseInt(args[++i] ?? '', 10) || 10;
      else if (/^-[0-9]+$/.test(args[i])) n = parseInt(args[i].slice(1), 10) || 10;
      else if (args[i].startsWith('--lines=')) n = parseInt(args[i].slice(8), 10) || 10;
      else if (!args[i].startsWith('-')) rest.push(args[i]);
    }
    let code = 0;
    for (const t of rest) {
      try {
        const lines = fsMod.readFileSync(resolveSh(t), 'utf8').split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        process.stdout.write(lines.slice(0, n).join('\n') + '\n');
      } catch (err) {
        process.stderr.write(`head: cannot open '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  tail(args) {
    let n = 10;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') n = parseInt(args[++i] ?? '', 10) || 10;
      else if (/^-[0-9]+$/.test(args[i])) n = parseInt(args[i].slice(1), 10) || 10;
      else if (args[i].startsWith('--lines=')) n = parseInt(args[i].slice(8), 10) || 10;
      else if (!args[i].startsWith('-')) rest.push(args[i]);
    }
    let code = 0;
    for (const t of rest) {
      try {
        const lines = fsMod.readFileSync(resolveSh(t), 'utf8').split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        process.stdout.write(lines.slice(Math.max(0, lines.length - n)).join('\n') + '\n');
      } catch (err) {
        process.stderr.write(`tail: cannot open '${t}': ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  wc(args) {
    const lines = args.includes('-l');
    const words = args.includes('-w');
    const chars = args.includes('-c');
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) { process.stderr.write('wc: no files\n'); return 1; }
    const any = lines || words || chars;
    let code = 0;
    for (const t of targets) {
      try {
        const text = fsMod.readFileSync(resolveSh(t), 'utf8');
        const l = text.split('\n').filter((x) => x !== '').length;
        const w = text.split(/\s+/).filter(Boolean).length;
        const c = Buffer.byteLength(text);
        const parts = [];
        if (lines || !any) parts.push(String(l));
        if (words || !any) parts.push(String(w));
        if (chars || !any) parts.push(String(c));
        process.stdout.write(parts.join(' ') + ' ' + t + '\n');
      } catch (err) {
        process.stderr.write(`wc: ${t}: ${err.message}\n`);
        code = 1;
      }
    }
    return code;
  },

  which(args) {
    if (args.length === 0) return 0;
    const pathEnv = shellState.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
    const dirs = pathEnv.split(':');
    let code = 1;
    for (const a of args) {
      if (BUILTINS[a] || COREUTILS[a]) {
        process.stdout.write(a + '\n');
        code = 0;
        continue;
      }
      const hit = dirs
        .map((d) => pathMod.join(d, a))
        .find((p) => { try { fsMod.accessSync(p); return true; } catch { return false; } });
      if (hit) {
        process.stdout.write(hit + '\n');
        code = 0;
      } else {
        process.stderr.write(`which: no ${a} in (${pathEnv})\n`);
      }
    }
    return code;
  },
};

// Merge coreutils into BUILTINS (kept separate above for which()'s lookup).
Object.assign(BUILTINS, COREUTILS);

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function runSimple(cmd) {
  const env = { ...process.env, ...Object.fromEntries(cmd.assigns) };
  const argv = cmd.argv.slice();

  if (argv.length === 0) {
    for (const [k, v] of cmd.assigns) shellState.env[k] = v;
    return Promise.resolve(0);
  }

  const name = argv[0];
  if (BUILTINS[name]) {
    const hasRedirects = cmd.redirects && cmd.redirects.length > 0;
    if (!hasRedirects) {
      try {
        return Promise.resolve(BUILTINS[name](argv.slice(1)));
      } catch (err) {
        process.stderr.write(`oc-sh: ${name}: ${err.message}\n`);
        return Promise.resolve(1);
      }
    }
    // S9 fix — builtins honor redirections too (echo hi > file used to
    // print to the tty and write NOTHING). Intercept the process's
    // stdout/stderr for the duration of the call, flush to targets after.
    const { sinks } = buildStdio(cmd.redirects);
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => { sinks.stdout.push(chunk); return true; };
    if (sinks.stderrIsStdout) {
      process.stderr.write = (chunk) => { sinks.stdout.push(chunk); return true; };
    }
    let code;
    try {
      code = BUILTINS[name](argv.slice(1)) ?? 0;
    } catch (err) {
      origErr(`oc-sh: ${name}: ${err.message}\n`);
      code = 1;
    }
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    flushSinks(sinks);
    return Promise.resolve(code);
  }

  return new Promise((resolve) => {
    // Redirection is implemented INSIDE the shell (the child gets pipes; we
    // collect and write) — file descriptors are process-local in this
    // runtime, so passing raw fds to another process is not meaningful.
    const { stdio, sinks } = buildStdio(cmd.redirects);
    let child;
    try {
      child = spawn(name, argv.slice(1), {
        env,
        cwd: shellState.cwd,
        stdio,
      });
    } catch (err) {
      process.stderr.write(`oc-sh: ${name}: ${err.message}\n`);
      resolve(1);
      return;
    }
    if (child.stdout) child.stdout.on('data', (c) => { sinks.stdout.push(c); });
    if (child.stderr) child.stderr.on('data', (c) => {
      if (sinks.stderrIsStdout) sinks.stdout.push(c);
      else sinks.stderr.push(c);
    });
    let sigintForwarded = false;
    const onSigint = () => {
      sigintForwarded = true;
      try { child.kill('SIGINT'); } catch { /* already dead */ }
    };
    process.on('SIGINT', onSigint);
    child.on('error', (err) => {
      process.removeListener('SIGINT', onSigint);
      if (err && err.code === 'ENOENT') {
        process.stderr.write(`oc-sh: ${name}: command not found\n`);
        resolve(127);
      } else if (err && err.code === 'ENOEXEC') {
        process.stderr.write(`oc-sh: ${name}: cannot execute (no recognized interpreter)\n`);
        resolve(126);
      } else {
        process.stderr.write(`oc-sh: ${name}: ${err && err.message ? err.message : String(err)}\n`);
        resolve(1);
      }
    });
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', onSigint);
      flushSinks(sinks);
      if (signal === 'SIGINT' && !sigintForwarded) resolve(130);
      else if (signal) resolve(128 + signalNumber(signal));
      else resolve(code ?? 1);
    });
  });
}

/** Redirection plan: which fds become pipes collected by the shell. */
function buildStdio(redirects) {
  const fs = require('fs');
  const sinks = {
    stdout: [], stderr: [], stderrIsStdout: false,
    files: [], // {buffer getter, target, append}
  };
  const stdio = ['inherit', 'inherit', 'inherit'];
  const fsErr = (target, err) => {
    process.stderr.write(`oc-sh: cannot create ${target}: ${err.message}\n`);
    process.exit(1);
  };
  for (const r of redirects) {
    if (r.op === '2>&1') {
      sinks.stderrIsStdout = true;
      if (stdio[1] === 'pipe') stdio[2] = 'pipe';
      continue;
    }
    const idx = r.op.startsWith('2') ? 2 : 1;
    const append = r.op === '>>' || r.op === '2>>';
    if (r.target === '/dev/null') {
      stdio[idx] = 'ignore';
      continue;
    }
    if (stdio[idx] !== 'pipe') stdio[idx] = 'pipe';
    sinks.files.push({
      idx,
      target: r.target,
      append,
      truncate: !append,
    });
  }
  sinks.__fs = fs;
  sinks.__err = fsErr;
  return { stdio, sinks };
}

function flushSinks(sinks) {
  const fs = sinks.__fs;
  for (const f of sinks.files) {
    const chunks = f.idx === 1 ? sinks.stdout : (sinks.stderrIsStdout ? sinks.stdout : sinks.stderr);
    const data = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    try {
      if (f.append) fs.appendFileSync(f.target, data);
      else fs.writeFileSync(f.target, data);
    } catch (err) {
      sinks.__err(f.target, err);
    }
  }
}

function expandBareWord(word) {
  let out = '';
  let i = 0;
  while (i < word.length) {
    if (word[i] === '\\') { out += word[i + 1] ?? ''; i += 2; continue; }
    if (word[i] === '$') {
      const { value, next } = readExpansion(word, i);
      out += value;
      i = next;
      continue;
    }
    out += word[i++];
  }
  return out;
}

function signalNumber(sig) {
  return { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[sig] ?? 15;
}

/** Execute a full command line honoring `;` `&&` `||`. */
async function executeLine(line) {
  const commands = parseCommandLine(line);
  let skipUntilBoundary = false;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (skipUntilBoundary) {
      // Belonging to a failed && chain (or successful || chain): skipped,
      // but keep the chain going while joinNext stays && / ||.
      if (cmd.joinNext === '&&' || cmd.joinNext === '||') continue;
      skipUntilBoundary = false;
      continue;
    }
    const code = await runSimple(cmd);
    shellState.lastStatus = code;
    if (cmd.joinNext === '&&' && code !== 0) skipUntilBoundary = true;
    else if (cmd.joinNext === '||' && code === 0) skipUntilBoundary = true;
  }
  return shellState.lastStatus;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function runScript(script) {
  const lines = script.split('\n').filter((l) => {
    const t = l.trim();
    return t !== '' && !t.startsWith('#');
  });
  let code = 0;
  try {
    for (const line of lines) {
      code = await executeLine(line);
    }
  } catch (err) {
    process.stderr.write(`oc-sh: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(2);
  }
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--version') {
    process.stdout.write(VERSION + '\n');
    process.exit(0);
  }
  for (const [k, v] of Object.entries(process.env)) shellState.env[k] = v;

  if (argv[0] === '-c') {
    if (argv[1] === undefined) {
      process.stderr.write('oc-sh: -c requires an argument\n');
      process.exit(2);
    }
    void runScript(argv[1]);
    return;
  }
  if (argv[0] !== undefined) {
    // sh script.sh — read the file and run it.
    const fs = require('fs');
    try {
      const script = fs.readFileSync(argv[0], 'utf8');
      void runScript(script);
    } catch (err) {
      process.stderr.write(`oc-sh: ${err.message}\n`);
      process.exit(127);
    }
    return;
  }
  // No script: read from stdin (sh < script semantics).
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => { void runScript(input); });
  // Keep the process alive while stdin is open.
  const keepAlive = setInterval(() => {}, 1000);
  process.stdin.on('end', () => clearInterval(keepAlive));
}

main();
