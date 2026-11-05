/**
 * Diagnose: does node -e writeFileSync actually write, and where does it land?
 */
(() => {
  const R = (window.__ocDiag = { steps: [], done: false });
  const log = (name, ok, detail = '') => {
    R.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
    console.log(`${ok ? '✓' : '✗'} ${name} — ${String(detail).slice(0, 200)}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SQ = String.fromCharCode(39);
  const DQ = String.fromCharCode(34);

  void (async () => {
    const rt = window.__ocRuntime;
    const stdio = [];
    rt.events.onStdio = (fd, chunk) => { stdio.push(String(chunk)); };
    try {
      // 1. plain eval marker
      stdio.length = 0;
      await rt.spawn('node -e ' + SQ + 'console.log(' + DQ + 'MARKER123' + DQ + ')' + SQ);
      log('eval marker printed', stdio.join('').includes('MARKER123'), JSON.stringify(stdio.join('').slice(0, 200)));

      // 2. writeFileSync probe + read it back in the SAME process
      stdio.length = 0;
      await rt.spawn('node -e ' + SQ +
        'require(' + DQ + 'fs' + DQ + ').writeFileSync(' + DQ + 'probe.txt' + DQ + ',' + DQ + 'hello-probe' + DQ + ');' +
        'console.log(' + DQ + 'WROTE=' + DQ + ' + require(' + DQ + 'fs' + DQ + ').readFileSync(' + DQ + 'probe.txt' + DQ + ',' + DQ + 'utf8' + DQ + '))' + SQ);
      log('same-process write+read', stdio.join('').includes('WROTE=hello-probe'), JSON.stringify(stdio.join('').slice(0, 300)));

      // 3. fresh process reads probe.txt
      stdio.length = 0;
      await rt.spawn('node -e ' + SQ +
        'console.log(' + DQ + 'FRESH=' + DQ + ' + require(' + DQ + 'fs' + DQ + ').readFileSync(' + DQ + 'probe.txt' + DQ + ',' + DQ + 'utf8' + DQ + '))' + SQ);
      log('fresh-process read', stdio.join('').includes('FRESH=hello-probe'), JSON.stringify(stdio.join('').slice(0, 300)));

      // 4. keeper readdir sees probe.txt?
      const ls = await rt.readdir('/home/project');
      log('keeper readdir has probe.txt', ls.some((e) => e.name === 'probe.txt'), ls.map((e) => e.name).join(','));

      // 5. host snapshot has it? (spawn node probe.txt would need snapshotHas)
      stdio.length = 0;
      await rt.spawn('node probe.txt');
      log('node probe.txt (snapshotHas path)', stdio.join('').includes('hello-probe'), JSON.stringify(stdio.join('').slice(0, 200)));

      // 6. cwd of an eval process?
      stdio.length = 0;
      await rt.spawn('node -e ' + SQ + 'console.log(' + DQ + 'CWD=' + DQ + ' + process.cwd())' + SQ);
      log('eval cwd', stdio.join('').includes('CWD=/home/project'), JSON.stringify(stdio.join('').slice(0, 200)));
    } catch (e) {
      R.steps.push({ name: 'fatal', ok: false, detail: String((e && e.stack) || e).slice(0, 500) });
    }
    R.done = true;
    console.log('DIAG-DONE');
  })();
})();
