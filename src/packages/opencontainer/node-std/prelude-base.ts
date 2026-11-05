/**
 * OpenContainer — Node compat prelude: base helpers.
 * Must run before all other prelude parts.
 */
export const PRELUDE_BASE = String.raw`
/* ============================= base helpers ============================= */
(function () {
  'use strict';
  globalThis.__ocModules = globalThis.__ocModules || {};

  globalThis.__ocInherits = function (ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  };

  var OCERR = '__OCERR__';
  globalThis.__ocDecodeHostError = function (e) {
    if (e && typeof e.message === 'string' && e.message.startsWith(OCERR)) {
      try {
        var payload = JSON.parse(e.message.slice(OCERR.length));
        var err = new Error(payload.message);
        err.code = payload.code;
        err.errno = payload.errno;
        err.syscall = payload.syscall;
        err.path = payload.path;
        return err;
      } catch (decodeErr) { /* fall through */ }
    }
    return e;
  };

  globalThis.__ocHostCall = function (fn) {
    try {
      return fn();
    } catch (e) {
      throw globalThis.__ocDecodeHostError(e);
    }
  };
})();
`;
