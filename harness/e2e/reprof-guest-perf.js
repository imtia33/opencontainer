/* Guest-side perf: packument fetch latency (seq/par) + VFS write/read
 * throughput (2000 files). Rewritten S21 — the previous draft had an
 * unterminated string literal (never parsed) and the prompt race bug. */
window.__ocPerf = null;
void (async () => {
  const t = window.__ocTerm;
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX) };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const waitFor = async (fn, ms, step = 50) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(step); }
    return -1;
  };
  const run = async (cmd, timeout = 180000) => {
    if ((await waitFor(isReady, 30000, 100)) < 0) return 'NO_PROMPT_PRE';
    await sleep(150);
    type(cmd + '\r');
    if ((await waitFor(() => !isReady(), 5000, 5)) < 0) return 'NOT_SUBMITTED';
    if ((await waitFor(isReady, timeout, 50)) < 0) return 'TIMEOUT';
    return 'OK';
  };

  const names = ['express', 'lodash', 'chalk', 'ms', 'debug', 'accepts', 'body-parser', 'bytes',
    'content-disposition', 'cookie', 'cookie-signature', 'depd', 'destroy', 'ee-first',
    'encodeurl', 'escape-html', 'etag', 'finalhandler', 'fresh', 'http-errors',
    'merge-descriptors', 'methods', 'mime-types', 'on-finished', 'parseurl', 'path-to-regexp',
    'proxy-addr', 'qs', 'range-parser', 'raw-body', 'send', 'serve-static', 'setprototypeof',
    'statuses', 'toidentifier', 'type-is', 'unpipe', 'utils-merge', 'vary', 'negotiator',
    'iconv-lite', 'media-typer', 'mime-db', 'mime-score', 'ipaddr.js', 'forwarded'];
  const namesJson = JSON.stringify(names);

  const writeCmd = 'node -e "require(\'fs\').writeFileSync(\'/home/project/perf-names.json\','
    + JSON.stringify(namesJson) + ')"';
  const seqCode = "const https=require('https');const names=JSON.parse(require('fs').readFileSync('/home/project/perf-names.json'));const t0=Date.now();let i=0;(function next(){if(i>=names.length){console.log('SEQ_MS '+(Date.now()-t0)+' for '+names.length);return}const n=names[i++];https.get('https://registry.npmjs.org/'+n,{headers:{accept:'application/vnd.npm.install-v1+json'}},r=>{let b='';r.on('data',c=>b+=c);r.on('end',next);r.on('error',e=>{console.log('ERR '+e.message);next()})}).on('error',e=>{console.log('ERR '+e.message);next()})})()";
  const parCode = "const https=require('https');const names=JSON.parse(require('fs').readFileSync('/home/project/perf-names.json'));const t0=Date.now();let done=0;for(const n of names){https.get('https://registry.npmjs.org/'+n,{headers:{accept:'application/vnd.npm.install-v1+json'}},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{done++;if(done===names.length)console.log('PAR_MS '+(Date.now()-t0)+' for '+names.length)});r.on('error',()=>{done++;if(done===names.length)console.log('PAR_MS '+(Date.now()-t0))})}).on('error',()=>{done++;if(done===names.length)console.log('PAR_MS '+(Date.now()-t0))})})()";
  const vfsCode = "const fs=require('fs');const t0=Date.now();fs.mkdirSync('/home/project/perf-vfs',{recursive:true});for(let i=0;i<2000;i++){fs.writeFileSync('/home/project/perf-vfs/f'+i+'.js','console.log('+i+')\\n')}const w=Date.now()-t0;const t1=Date.now();let total=0;for(let i=0;i<2000;i++){total+=fs.readFileSync('/home/project/perf-vfs/f'+i+'.js').length}console.log('VFS_WRITE_MS '+w+' VFS_READ_MS '+(Date.now()-t1)+' bytes '+total)";

  const res = {};
  res.write = await run(writeCmd, 60000);
  res.seq = await run('node -e ' + JSON.stringify(seqCode), 240000);
  res.par = await run('node -e ' + JSON.stringify(parCode), 240000);
  res.vfs = await run('node -e ' + JSON.stringify(vfsCode), 240000);

  const lines = [];
  const b = t.buffer.active;
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) lines.push(l.translateToString(true)); }
  const grab = (tag) => { const m = lines.join('\n').match(new RegExp(tag + '[^\\r\\n]*')); return m ? m[0] : null; };
  res.SEQ = grab('SEQ_MS');
  res.PAR = grab('PAR_MS');
  res.VFS = grab('VFS_WRITE_MS');
  window.__ocPerf = res;
})().catch((e) => { window.__ocPerf = { driverError: String((e && e.stack) || e) }; });
