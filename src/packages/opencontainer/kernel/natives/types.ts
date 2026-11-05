import type { Binding } from './index';

/** internalBinding('types') — node_types.cc equivalents in pure JS. */
export function makeTypesBinding(): Binding {
  // SharedArrayBuffer exists ONLY in cross-origin-isolated pages (COOP+COEP).
  // Referencing the bare global in a plain page throws ReferenceError — guard
  // it once so non-isolated hosts still boot (SAB features report false).
  const HAS_SAB = typeof SharedArrayBuffer !== 'undefined';
  return {
    isAsyncFunction(fn: any): boolean {
      return typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction';
    },
    isArgumentsObject(v: any): boolean {
      // Arguments objects are no longer distinguishable post-ES2022 sloppy-mode removal
      return false;
    },
    isBigIntObject(v: any): boolean { return v instanceof BigInt; },
    isBooleanObject(v: any): boolean { return v instanceof Boolean; },
    isBoolean(v: any): boolean { return typeof v === 'boolean'; },
    isDate(v: any): boolean { return v instanceof Date; },
    isNativeError(v: any): boolean {
      if (typeof v !== 'object' || v === null) return false;
      let cur = v;
      while (cur) {
        if (typeof cur === 'function') break;
        cur = Object.getPrototypeOf(cur);
        if (cur?.constructor?.name === 'Error') return true;
      }
      return false;
    },
    isFunction(v: any): boolean { return typeof v === 'function'; },
    isNumberObject(v: any): boolean { return v instanceof Number; },
    isNumber(v: any): boolean { return typeof v === 'number'; },
    isPromise(v: any): boolean { return v instanceof Promise; },
    isRegExp(v: any): boolean { return v instanceof RegExp; },
    isString(v: any): boolean { return typeof v === 'string'; },
    isStringObject(v: any): boolean { return v instanceof String; },
    isSymbolObject(v: any): boolean { return v instanceof Symbol; },
    isSymbol(v: any): boolean { return typeof v === 'symbol'; },
    isPrimitive(v: any): boolean {
      return v === null || (typeof v !== 'object' && typeof v !== 'function');
    },
    isAnyArrayBuffer(v: any): boolean {
      return v instanceof ArrayBuffer || (HAS_SAB && v instanceof SharedArrayBuffer);
    },
    isArrayBuffer(v: any): boolean { return v instanceof ArrayBuffer; },
    isSharedArrayBuffer(v: any): boolean {
      return HAS_SAB && v instanceof SharedArrayBuffer;
    },
    isArrayBufferDetached(v: any): boolean {
      return v instanceof ArrayBuffer && v.byteLength === 0 && (v as any).__detached === true;
    },
    isArrayBufferView(v: any): boolean {
      return ArrayBuffer.isView(v);
    },
    isDataView(v: any): boolean { return v instanceof DataView; },
    isTypedArray(v: any): boolean {
      return ArrayBuffer.isView(v) && !(v instanceof DataView);
    },
    isUint8Array(v: any): boolean { return v instanceof Uint8Array; },
    isUint8ClampedArray(v: any): boolean { return v instanceof Uint8ClampedArray; },
    isInt8Array(v: any): boolean { return v instanceof Int8Array; },
    isUint16Array(v: any): boolean { return v instanceof Uint16Array; },
    isInt16Array(v: any): boolean { return v instanceof Int16Array; },
    isUint32Array(v: any): boolean { return v instanceof Uint32Array; },
    isInt32Array(v: any): boolean { return v instanceof Int32Array; },
    isFloat32Array(v: any): boolean { return v instanceof Float32Array; },
    isFloat64Array(v: any): boolean { return v instanceof Float64Array; },
    isBigInt64Array(v: any): boolean { return v instanceof BigInt64Array; },
    isBigUint64Array(v: any): boolean { return v instanceof BigUint64Array; },
    isKeyObject(v: any): boolean { return false; },
    isCryptoKey(v: any): boolean {
      return typeof CryptoKey !== 'undefined' && v instanceof CryptoKey;
    },
    isWeakMap(v: any): boolean { return v instanceof WeakMap; },
    isMap(v: any): boolean { return v instanceof Map; },
    isSet(v: any): boolean { return v instanceof Set; },
    isWeakSet(v: any): boolean { return v instanceof WeakSet; },
    isMapIterator(v: any): boolean { return false; },
    isSetIterator(v: any): boolean { return false; },
    isWeakCollection(): boolean { return false; },
    isProxy(v: any): boolean { return false; },
    isBoxedPrimitive(v: any): boolean {
      return v instanceof Boolean || v instanceof Number || v instanceof String ||
        v instanceof Symbol || v instanceof BigInt;
    },
    isExternal(v: any): boolean { return false; },
    isModuleNamespaceObject(v: any): boolean {
      if (typeof v !== 'object' || v === null) return false;
      const desc = Object.getOwnPropertyDescriptor(v, Symbol.toStringTag);
      return desc?.value === 'Module';
    },
    isJSReceiver(v: any): boolean { return typeof v === 'object' && v !== null || typeof v === 'function'; },
    isJSProxy(): boolean { return false; },
    isRegExpExecFast(): boolean { return false; },
    isUint32(): boolean { return false; },
    getPromiseDetails(p: any) { return undefined; },
    getProxyDetails(p: any) { return undefined; },
    previewEntries(v: any) { return undefined; },
  };
}
