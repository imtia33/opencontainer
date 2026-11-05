/**
 * OpenContainer — Node compat prelude: child_process + readline.
 * spawn/exec/execFile bridge to the host process manager; readline works
 * over process.stdin.
 */
export const PRELUDE_CHILD = String.raw`
/* ============================= child_process / readline ============================= */
(function () {
  'use strict';
  var EventEmitter = globalThis.__ocModules.events;
  var Readable = globalThis.__ocModules.Readable;
  var Writable = globalThis.__ocModules.Writable;

  function ChildProcess(pid, command, args) {
    EventEmitter.call(this);
    this.pid = pid;
    this.connected = true;
    this.killed = false;
    this.spawnargs = args;
    this.spawnfile = command;
    this.stdin = new Writable({
      write: function (chunk, enc, cb) {
        if (typeof chunk !== 'string') chunk = globalThis.__ocDecodeString(chunk, 'utf8');
        __host_child_stdin_write(pid, chunk);
        cb();
      },
    });
    this.stdin.end = function (cb) {
      Writable.prototype.end.call(this, cb);
    };
    var stdoutStream = new Readable({});
    var stderrStream = new Readable({});
    stdoutStream._read = function () {};
    stderrStream._read = function () {};
    this.stdout = stdoutStream;
    this.stderr = stderrStream;
    var self = this;
    var stdoutBuf = '';
    var stderrBuf = '';
    __host_child_on(pid, 'stdout', function (data) {
      stdoutBuf += data;
      var buf = Buffer.from(data, 'utf8');
      stdoutStream.push(buf);
    });
    __host_child_on(pid, 'stderr', function (data) {
      stderrBuf += data;
      var buf = Buffer.from(data, 'utf8');
      stderrStream.push(buf);
    });
    __host_child_on(pid, 'exit', function (code) {
      self.killed = true;
      stdoutStream.push(null);
      stderrStream.push(null);
      self.exitCode = typeof code === 'number' ? code : null;
      self.signalCode = null;
      self.emit('exit', self.exitCode, null);
      self.emit('close', self.exitCode, null);
    });
    this.__stdoutText = function () { return stdoutBuf; };
    this.__stderrText = function () { return stderrBuf; };
  }
  globalThis.__ocInherits(ChildProcess, EventEmitter);
  ChildProcess.prototype.kill = function (signal) {
    __host_child_kill(this.pid);
    return true;
  };
  ChildProcess.prototype.unref = function () {};
  ChildProcess.prototype.ref = function () {};
  ChildProcess.prototype.disconnect = function () {};
  ChildProcess.prototype.send = function () { return false; };

  function normalizeSpawnArgs(command, args, options) {
    if (args !== undefined && !Array.isArray(args)) { options = args; args = []; }
    options = options || {};
    return { command: command, args: args || [], options: options };
  }

  var child_process = {};

  child_process.spawn = function (command, args, options) {
    var norm = normalizeSpawnArgs(command, args, options);
    var self = this;
    var proxy = new EventEmitter();
    proxy.stdin = new Writable({
      write: function (chunk, enc, cb) {
        if (typeof chunk !== 'string') chunk = globalThis.__ocDecodeString(chunk, 'utf8');
        proxy.__writeStdin(chunk);
        cb();
      },
    });
    var stdoutStream = new Readable({});
    var stderrStream = new Readable({});
    proxy.stdout = stdoutStream;
    proxy.stderr = stderrStream;
    var spawnOpts = {
      cwd: norm.options.cwd || process.cwd(),
      env: norm.options.env ? norm.options.env : undefined,
      stdio: norm.options.stdio,
    };
    var p = __host_child_spawn(norm.command, JSON.stringify(norm.args), JSON.stringify(spawnOpts));
    var exited = false;
    var stdoutBuf = '';
    var stderrBuf = '';
    p.then(function (pid) {
      proxy.pid = pid;
      proxy.__writeStdin = function (data) { __host_child_stdin_write(pid, data); };
      proxy.kill = function () { __host_child_kill(pid); return true; };
      proxy.unref = function () {};
      proxy.ref = function () {};
      proxy.connected = true;
      __host_child_on(pid, 'stdout', function (data) {
        stdoutBuf += data;
        stdoutStream.push(Buffer.from(data, 'utf8'));
      });
      __host_child_on(pid, 'stderr', function (data) {
        stderrBuf += data;
        stderrStream.push(Buffer.from(data, 'utf8'));
      });
      __host_child_on(pid, 'exit', function (code) {
        exited = true;
        proxy.killed = true;
        stdoutStream.push(null);
        stderrStream.push(null);
        proxy.exitCode = typeof code === 'number' ? code : null;
        proxy.emit('exit', proxy.exitCode, null);
        proxy.emit('close', proxy.exitCode, null);
      });
      proxy.emit('spawn');
    }, function (err) {
      process.nextTick(function () {
        var e = Object.assign(new Error('spawn ' + norm.command + ' ENOENT'), { code: 'ENOENT', errno: -2, syscall: 'spawn', path: norm.command, spawnargs: norm.args });
        proxy.emit('error', e);
        proxy.emit('close', -2, 'ENOENT');
      });
    });
    return proxy;
  };

  child_process.spawnSync = function (command, args, options) {
    var norm = normalizeSpawnArgs(command, args, options);
    // synchronous spawn is not possible with the async engine; emulate via
    // a synchronous host round-trip using the child_await bridge
    throw new Error('child_process.spawnSync is not supported by OpenContainer (async engine); use spawn + await exit');
  };

  function execFileInner(file, args, options, callback) {
    if (typeof args === 'function') { callback = args; args = []; options = null; }
    else if (typeof options === 'function') { callback = options; options = null; }
    if (args !== undefined && !Array.isArray(args)) { options = args; args = []; }
    args = args || [];
    var child = child_process.spawn(file, args, options);
    var stdout = '';
    var stderr = '';
    child.stdout.on('data', function (d) { stdout += globalThis.__ocDecodeString(d, 'utf8'); });
    child.stderr.on('data', function (d) { stderr += globalThis.__ocDecodeString(d, 'utf8'); });
    child.on('error', function (e) { if (callback) callback(e, stdout, stderr); });
    child.on('close', function (code) {
      if (callback) {
        var err = code === 0 ? null : Object.assign(new Error('Command failed: ' + file + ' ' + args.join(' ') + '\n' + stderr), { code: code, stdout: stdout, stderr: stderr });
        callback(err, stdout, stderr);
      }
    });
    return child;
  }

  child_process.execFile = execFileInner;
  child_process.exec = function (command, options, callback) {
    if (typeof options === 'function') { callback = options; options = null; }
    // run via the shell
    return execFileInner('jsh', ['-c', String(command)], options, callback);
  };
  child_process.execSync = function (command, options) {
    throw new Error('child_process.execSync is not supported by OpenContainer (async engine); use exec + callback');
  };
  child_process.execFileSync = function () {
    throw new Error('child_process.execFileSync is not supported by OpenContainer; use execFile + callback');
  };
  child_process.fork = function (modulePath, args, options) {
    options = options || {};
    return child_process.spawn('node', [modulePath].concat(args || []), options);
  };
  /* ============================= readline ============================= */
  var readline = {};
  readline.createInterface = function (options) {
    var input = options && options.input;
    var output = options && options.output;
    var terminal = !!(options && options.terminal);
    var rl = new EventEmitter();
    var lineBuffer = '';
    var paused = false;
    function onData(chunk) {
      if (typeof chunk !== 'string') chunk = globalThis.__ocDecodeString(chunk, 'utf8');
      lineBuffer += chunk;
      var idx;
      while ((idx = lineBuffer.indexOf('\n')) !== -1) {
        var line = lineBuffer.slice(0, idx);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lineBuffer = lineBuffer.slice(idx + 1);
        rl.emit('line', line);
      }
    }
    if (input) {
      input.on('data', onData);
      input.on('end', function () {
        if (lineBuffer) { rl.emit('line', lineBuffer); lineBuffer = ''; }
        rl.emit('close');
      });
      if (typeof input.resume === 'function') input.resume();
    }
    rl.pause = function () { paused = true; if (input && typeof input.pause === 'function') input.pause(); };
    rl.resume = function () { paused = false; if (input && typeof input.resume === 'function') input.resume(); };
    rl.close = function () { rl.emit('close'); };
    rl.setPrompt = function (p) { rl._prompt = p; };
    rl.prompt = function () { if (output) output.write(rl._prompt || '> '); };
    rl.write = function (data) { onData(data); };
    rl.question = function (query, cb) {
      if (output && query) output.write(query);
      rl.once('line', function (line) { cb(line); });
    };
    rl._prompt = options && options.prompt;
    return rl;
  };
  readline.clearScreenDown = function () {};
  readline.cursorTo = function () {};
  readline.moveCursor = function () {};
  readline.emitKeypressEvents = function () {};
  readline.Interface = readline.createInterface;
  readline.promises = {
    createInterface: function (options) {
      var rl = readline.createInterface(options);
      var question = function (query) {
        return new Promise(function (resolve) { rl.question(query, resolve); });
      };
      rl.question = question;
      return rl;
    },
  };

  globalThis.__ocModules.child_process = child_process;
  globalThis.__ocModules.readline = readline;
})();
`;
