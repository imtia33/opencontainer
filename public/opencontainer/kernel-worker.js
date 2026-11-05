var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// node_modules/fflate/esm/browser.js
var exports_browser = {};
__export(exports_browser, {
  zlibSync: () => zlibSync,
  zlib: () => zlib,
  zipSync: () => zipSync,
  zip: () => zip,
  unzlibSync: () => unzlibSync,
  unzlib: () => unzlib,
  unzipSync: () => unzipSync,
  unzip: () => unzip,
  strToU8: () => strToU8,
  strFromU8: () => strFromU8,
  inflateSync: () => inflateSync,
  inflate: () => inflate,
  gzipSync: () => gzipSync,
  gzip: () => gzip,
  gunzipSync: () => gunzipSync,
  gunzip: () => gunzip,
  deflateSync: () => deflateSync,
  deflate: () => deflate,
  decompressSync: () => decompressSync,
  decompress: () => decompress,
  compressSync: () => gzipSync,
  compress: () => gzip,
  Zlib: () => Zlib,
  ZipPassThrough: () => ZipPassThrough,
  ZipDeflate: () => ZipDeflate,
  Zip: () => Zip,
  Unzlib: () => Unzlib,
  UnzipPassThrough: () => UnzipPassThrough,
  UnzipInflate: () => UnzipInflate,
  Unzip: () => Unzip,
  Inflate: () => Inflate,
  Gzip: () => Gzip,
  Gunzip: () => Gunzip,
  FlateErrorCode: () => FlateErrorCode,
  EncodeUTF8: () => EncodeUTF8,
  Deflate: () => Deflate,
  Decompress: () => Decompress,
  DecodeUTF8: () => DecodeUTF8,
  Compress: () => Gzip,
  AsyncZlib: () => AsyncZlib,
  AsyncZipDeflate: () => AsyncZipDeflate,
  AsyncUnzlib: () => AsyncUnzlib,
  AsyncUnzipInflate: () => AsyncUnzipInflate,
  AsyncInflate: () => AsyncInflate,
  AsyncGzip: () => AsyncGzip,
  AsyncGunzip: () => AsyncGunzip,
  AsyncDeflate: () => AsyncDeflate,
  AsyncDecompress: () => AsyncDecompress,
  AsyncCompress: () => AsyncGzip
});
function StrmOpt(opts, cb) {
  if (typeof opts == "function")
    cb = opts, opts = {};
  this.ondata = cb;
  return opts;
}
function deflate(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bDflt
  ], function(ev) {
    return pbf(deflateSync(ev.data[0], ev.data[1]));
  }, 0, cb);
}
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
function inflate(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bInflt
  ], function(ev) {
    return pbf(inflateSync(ev.data[0], gopt(ev.data[1])));
  }, 1, cb);
}
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
function gzip(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bDflt,
    gze,
    function() {
      return [gzipSync];
    }
  ], function(ev) {
    return pbf(gzipSync(ev.data[0], ev.data[1]));
  }, 2, cb);
}
function gzipSync(data, opts) {
  if (!opts)
    opts = {};
  var c = crc(), l = data.length;
  c.p(data);
  var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
  return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
}
function gunzip(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bInflt,
    guze,
    function() {
      return [gunzipSync];
    }
  ], function(ev) {
    return pbf(gunzipSync(ev.data[0], ev.data[1]));
  }, 3, cb);
}
function gunzipSync(data, opts) {
  var st = gzs(data);
  if (st + 8 > data.length)
    err(6, "invalid gzip data");
  return inflt(data.subarray(st, -8), { i: 2 }, opts && opts.out || new u8(gzl(data)), opts && opts.dictionary);
}
function zlib(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bDflt,
    zle,
    function() {
      return [zlibSync];
    }
  ], function(ev) {
    return pbf(zlibSync(ev.data[0], ev.data[1]));
  }, 4, cb);
}
function zlibSync(data, opts) {
  if (!opts)
    opts = {};
  var a = adler();
  a.p(data);
  var d = dopt(data, opts, opts.dictionary ? 6 : 2, 4);
  return zlh(d, opts), wbytes(d, d.length - 4, a.d()), d;
}
function unzlib(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return cbify(data, opts, [
    bInflt,
    zule,
    function() {
      return [unzlibSync];
    }
  ], function(ev) {
    return pbf(unzlibSync(ev.data[0], gopt(ev.data[1])));
  }, 5, cb);
}
function unzlibSync(data, opts) {
  return inflt(data.subarray(zls(data, opts && opts.dictionary), -4), { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
function decompress(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  return data[0] == 31 && data[1] == 139 && data[2] == 8 ? gunzip(data, opts, cb) : (data[0] & 15) != 8 || data[0] >> 4 > 7 || (data[0] << 8 | data[1]) % 31 ? inflate(data, opts, cb) : unzlib(data, opts, cb);
}
function decompressSync(data, opts) {
  return data[0] == 31 && data[1] == 139 && data[2] == 8 ? gunzipSync(data, opts) : (data[0] & 15) != 8 || data[0] >> 4 > 7 || (data[0] << 8 | data[1]) % 31 ? inflateSync(data, opts) : unzlibSync(data, opts);
}
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i2 = 0;i2 < str.length; ++i2)
      ar_1[i2] = str.charCodeAt(i2);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i2 = 0;i2 < l; ++i2) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i2 << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i2);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0;i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
function zip(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  var r = {};
  fltn(data, "", r, opts);
  var k = Object.keys(r);
  var lft = k.length, o = 0, tot = 0;
  var slft = lft, files = new Array(lft);
  var term = [];
  var tAll = function() {
    for (var i3 = 0;i3 < term.length; ++i3)
      term[i3]();
  };
  var cbd = function(a, b) {
    mt(function() {
      cb(a, b);
    });
  };
  mt(function() {
    cbd = cb;
  });
  var cbf = function() {
    var out = new u8(tot + 22), oe = o, cdl = tot - o;
    tot = 0;
    for (var i3 = 0;i3 < slft; ++i3) {
      var f = files[i3];
      try {
        var l = f.c.length;
        wzh(out, tot, f, f.f, f.u, l);
        var badd = 30 + f.f.length + exfl(f.extra);
        var loc = tot + badd;
        out.set(f.c, loc);
        wzh(out, o, f, f.f, f.u, l, tot, f.m), o += 16 + badd + (f.m ? f.m.length : 0), tot = loc + l;
      } catch (e) {
        return cbd(e, null);
      }
    }
    wzf(out, o, files.length, cdl, oe);
    cbd(null, out);
  };
  if (!lft)
    cbf();
  var _loop_1 = function(i3) {
    var fn = k[i3];
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var c = crc(), size = file.length;
    c.p(file);
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    var compression = p.level == 0 ? 0 : 8;
    var cbl = function(e, d) {
      if (e) {
        tAll();
        cbd(e, null);
      } else {
        var l = d.length;
        files[i3] = mrg(p, {
          size,
          crc: c.d(),
          c: d,
          f,
          m,
          u: s != fn.length || m && com.length != ms,
          compression
        });
        o += 30 + s + exl + l;
        tot += 76 + 2 * (s + exl) + (ms || 0) + l;
        if (!--lft)
          cbf();
      }
    };
    if (s > 65535)
      cbl(err(11, 0, 1), null);
    if (!compression)
      cbl(null, file);
    else if (size < 160000) {
      try {
        cbl(null, deflateSync(file, p));
      } catch (e) {
        cbl(e, null);
      }
    } else
      term.push(deflate(file, p, cbl));
  };
  for (var i2 = 0;i2 < slft; ++i2) {
    _loop_1(i2);
  }
  return tAll;
}
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i2 = 0;i2 < files.length; ++i2) {
    var f = files[i2];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}
function unzip(data, opts, cb) {
  if (!cb)
    cb = opts, opts = {};
  if (typeof cb != "function")
    err(7);
  var term = [];
  var tAll = function() {
    for (var i3 = 0;i3 < term.length; ++i3)
      term[i3]();
  };
  var files = {};
  var cbd = function(a, b) {
    mt(function() {
      cb(a, b);
    });
  };
  mt(function() {
    cbd = cb;
  });
  var e = data.length - 22;
  for (;b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558) {
      cbd(err(13, 0, 1), null);
      return tAll;
    }
  }
  var lft = b2(data, e + 8);
  if (lft) {
    var c = lft;
    var o = b4(data, e + 16);
    var z = b4(data, e - 20) == 117853008;
    if (z) {
      var ze = b4(data, e - 12);
      z = b4(data, ze) == 101075792;
      if (z) {
        c = lft = b4(data, ze + 32);
        o = b4(data, ze + 48);
      }
    }
    var fltr = opts && opts.filter;
    var _loop_3 = function(i3) {
      var _a2 = zh(data, o, z), c_1 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
      o = no;
      var cbl = function(e2, d) {
        if (e2) {
          tAll();
          cbd(e2, null);
        } else {
          if (d)
            files[fn] = d;
          if (!--lft)
            cbd(null, files);
        }
      };
      if (!fltr || fltr({
        name: fn,
        size: sc,
        originalSize: su,
        compression: c_1
      })) {
        if (!c_1)
          cbl(null, slc(data, b, b + sc));
        else if (c_1 == 8) {
          var infl = data.subarray(b, b + sc);
          if (su < 524288 || sc > 0.8 * su) {
            try {
              cbl(null, inflateSync(infl, { out: new u8(su) }));
            } catch (e2) {
              cbl(e2, null);
            }
          } else
            term.push(inflate(infl, { size: su }, cbl));
        } else
          cbl(err(14, "unknown compression type " + c_1, 1), null);
      } else
        cbl(null, null);
    };
    for (var i2 = 0;i2 < c; ++i2) {
      _loop_3(i2);
    }
  } else
    cbd(null, {});
  return tAll;
}
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (;b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = b4(data, e - 20) == 117853008;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0;i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}
var ch2, wk = function(c, id, msg, transfer, cb) {
  var w = new Worker(ch2[id] || (ch2[id] = URL.createObjectURL(new Blob([
    c + ';addEventListener("error",function(e){e=e.error;postMessage({$e$:[e.message,e.code,e.stack]})})'
  ], { type: "text/javascript" }))));
  w.onmessage = function(e) {
    var d = e.data, ed = d.$e$;
    if (ed) {
      var err = new Error(ed[0]);
      err["code"] = ed[1];
      err.stack = ed[2];
      cb(err, null);
    } else
      cb(null, d);
  };
  w.postMessage(msg, transfer);
  return w;
}, u8, u16, i32, fleb, fdeb, clim, freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0;i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1;i < 30; ++i) {
    for (var j = b[i];j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
}, _a, fl, revfl, _b, fd, revfd, rev, x, i, hMap = function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (;i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1;i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1;v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
}, flt, i, i, i, i, fdt, i, flm, flrm, fdm, fdrm, max = function(a) {
  var m = a[0];
  for (var i2 = 1;i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
}, bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
}, bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
}, shft = function(p) {
  return (p + 7) / 8 | 0;
}, slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
}, FlateErrorCode, ec, err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
}, inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0;i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0;i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (;; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym2 = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym2 < 256)
        buf[bt++] = sym2;
      else if (sym2 == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym2 - 254;
        if (sym2 > 264) {
          var i2 = sym2 - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (;bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (;bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
}, wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
}, wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
}, hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0;i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1;i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (;i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (;i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
}, ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
}, lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1;i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (;cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (;cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
}, clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0;i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
}, wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0;i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
}, wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0;i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0;i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (;nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0;i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0;it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0;i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0;i2 < li; ++i2) {
    var sym2 = syms[i2];
    if (sym2 > 255) {
      var len = sym2 >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym2 >> 23 & 31), p += fleb[len];
      var dst = sym2 & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym2 >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym2]), p += ll[sym2];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
}, deo, et, dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25000);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (;i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7000 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0;j < 286; ++j)
            lf[j] = 0;
          for (var j = 0;j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (;nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0;j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi);i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0;i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
}, crct, crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i2 = 0;i2 < d.length; ++i2)
        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
}, adler = function() {
  var a = 1, b = 0;
  return {
    p: function(d) {
      var n = a, m = b;
      var l = d.length | 0;
      for (var i2 = 0;i2 != l; ) {
        var e = Math.min(i2 + 2655, l);
        for (;i2 < e; ++i2)
          m += n += d[i2];
        n = (n & 65535) + 15 * (n >> 16), m = (m & 65535) + 15 * (m >> 16);
      }
      a = n, b = m;
    },
    d: function() {
      a %= 65521, b %= 65521;
      return (a & 255) << 24 | (a & 65280) << 8 | (b & 255) << 8 | b >> 8;
    }
  };
}, dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
}, mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
}, wcln = function(fn, fnStr, td) {
  var dt = fn();
  var st = fn.toString();
  var ks = st.slice(st.indexOf("[") + 1, st.lastIndexOf("]")).replace(/\s+/g, "").split(",");
  for (var i2 = 0;i2 < dt.length; ++i2) {
    var v = dt[i2], k = ks[i2];
    if (typeof v == "function") {
      fnStr += ";" + k + "=";
      var st_1 = v.toString();
      if (v.prototype) {
        if (st_1.indexOf("[native code]") != -1) {
          var spInd = st_1.indexOf(" ", 8) + 1;
          fnStr += st_1.slice(spInd, st_1.indexOf("(", spInd));
        } else {
          fnStr += st_1;
          for (var t in v.prototype)
            fnStr += ";" + k + ".prototype." + t + "=" + v.prototype[t].toString();
        }
      } else
        fnStr += st_1;
    } else
      td[k] = v;
  }
  return fnStr;
}, ch, cbfs = function(v) {
  var tl = [];
  for (var k in v) {
    if (v[k].buffer) {
      tl.push((v[k] = new v[k].constructor(v[k])).buffer);
    }
  }
  return tl;
}, wrkr = function(fns, init, id, cb) {
  if (!ch[id]) {
    var fnStr = "", td_1 = {}, m = fns.length - 1;
    for (var i2 = 0;i2 < m; ++i2)
      fnStr = wcln(fns[i2], fnStr, td_1);
    ch[id] = { c: wcln(fns[m], fnStr, td_1), e: td_1 };
  }
  var td = mrg({}, ch[id].e);
  return wk(ch[id].c + ";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage=" + init.toString() + "}", id, td, cbfs(td), cb);
}, bInflt = function() {
  return [u8, u16, i32, fleb, fdeb, clim, fl, fd, flrm, fdrm, rev, ec, hMap, max, bits, bits16, shft, slc, err, inflt, inflateSync, pbf, gopt];
}, bDflt = function() {
  return [u8, u16, i32, fleb, fdeb, clim, revfl, revfd, flm, flt, fdm, fdt, rev, deo, et, hMap, wbits, wbits16, hTree, ln, lc, clen, wfblk, wblk, shft, slc, dflt, dopt, deflateSync, pbf];
}, gze = function() {
  return [gzh, gzhl, wbytes, crc, crct];
}, guze = function() {
  return [gzs, gzl];
}, zle = function() {
  return [zlh, wbytes, adler];
}, zule = function() {
  return [zls];
}, pbf = function(msg) {
  return postMessage(msg, [msg.buffer]);
}, gopt = function(o) {
  return o && {
    out: o.size && new u8(o.size),
    dictionary: o.dictionary
  };
}, cbify = function(dat, opts, fns, init, id, cb) {
  var w = wrkr(fns, init, id, function(err2, dat2) {
    w.terminate();
    cb(err2, dat2);
  });
  w.postMessage([dat, opts], opts.consume ? [dat.buffer] : []);
  return function() {
    w.terminate();
  };
}, astrm = function(strm) {
  strm.ondata = function(dat, final) {
    return postMessage([dat, final], [dat.buffer]);
  };
  return function(ev) {
    if (ev.data[0]) {
      strm.push(ev.data[0], ev.data[1]);
      postMessage([ev.data[0].length]);
    } else
      strm.flush(ev.data[1]);
  };
}, astrmify = function(fns, strm, opts, init, id, flush2, ext) {
  var t;
  var w = wrkr(fns, init, id, function(err2, dat) {
    if (err2)
      w.terminate(), strm.ondata.call(strm, err2);
    else if (!Array.isArray(dat))
      ext(dat);
    else if (dat.length == 1) {
      strm.queuedSize -= dat[0];
      if (strm.ondrain)
        strm.ondrain(dat[0]);
    } else {
      if (dat[1])
        w.terminate();
      strm.ondata.call(strm, err2, dat[0], dat[1]);
    }
  });
  w.postMessage(opts);
  strm.queuedSize = 0;
  strm.push = function(d, f) {
    if (!strm.ondata)
      err(5);
    if (t)
      strm.ondata(err(4, 0, 1), null, !!f);
    strm.queuedSize += d.length;
    w.postMessage([d, t = f], d.buffer instanceof ArrayBuffer ? [d.buffer] : []);
  };
  strm.terminate = function() {
    w.terminate();
  };
  if (flush2) {
    strm.flush = function(sync) {
      w.postMessage([0, sync]);
    };
  }
}, b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
}, b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
}, b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
}, wbytes = function(d, b, v) {
  for (;v; ++b)
    d[b] = v, v >>>= 8;
}, gzh = function(c, o) {
  var fn = o.filename;
  c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3;
  if (o.mtime != 0)
    wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1000));
  if (fn) {
    c[3] = 8;
    for (var i2 = 0;i2 <= fn.length; ++i2)
      c[i2 + 10] = fn.charCodeAt(i2);
  }
}, gzs = function(d) {
  if (d[0] != 31 || d[1] != 139 || d[2] != 8)
    err(6, "invalid gzip data");
  var flg = d[3];
  var st = 10;
  if (flg & 4)
    st += (d[10] | d[11] << 8) + 2;
  for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1);zs > 0; zs -= !d[st++])
    ;
  return st + (flg & 2);
}, gzl = function(d) {
  var l = d.length;
  return (d[l - 4] | d[l - 3] << 8 | d[l - 2] << 16 | d[l - 1] << 24) >>> 0;
}, gzhl = function(o) {
  return 10 + (o.filename ? o.filename.length + 1 : 0);
}, zlh = function(c, o) {
  var lv = o.level, fl2 = lv == 0 ? 0 : lv < 6 ? 1 : lv == 9 ? 3 : 2;
  c[0] = 120, c[1] = fl2 << 6 | (o.dictionary && 32);
  c[1] |= 31 - (c[0] << 8 | c[1]) % 31;
  if (o.dictionary) {
    var h = adler();
    h.p(o.dictionary);
    wbytes(c, 2, h.d());
  }
}, zls = function(d, dict) {
  if ((d[0] & 15) != 8 || d[0] >> 4 > 7 || (d[0] << 8 | d[1]) % 31)
    err(6, "invalid zlib data");
  if ((d[1] >> 5 & 1) == +!dict)
    err(6, "invalid zlib data: " + (d[1] & 32 ? "need" : "unexpected") + " dictionary");
  return (d[1] >> 3 & 4) + 2;
}, Deflate, AsyncDeflate, Inflate, AsyncInflate, Gzip, AsyncGzip, Gunzip, AsyncGunzip, Zlib, AsyncZlib, Unzlib, AsyncUnzlib, Decompress, AsyncDecompress, fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
}, te, td, tds = 0, dutf8 = function(d) {
  for (var r = "", i2 = 0;; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
}, DecodeUTF8, EncodeUTF8, dbf = function(l) {
  return l == 1 ? 3 : l < 6 ? 2 : l == 9 ? 1 : 0;
}, slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
}, zh = function(d, b, z) {
  var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
  var _a2 = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + efl + b2(d, b + 32), off];
}, z64hs = function(d, b, l, z, sc, su, off) {
  var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
  var nf = nsc + nsu + noff;
  if (z && nf) {
    for (;b + 4 < e; b += 4 + b2(d, b + 2)) {
      if (b2(d, b) == 1) {
        return [
          nsc ? b8(d, b + 4 + 8 * nsu) : sc,
          nsu ? b8(d, b + 4) : su,
          noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
          1
        ];
      }
    }
    if (z < 2)
      err(13);
  }
  return [sc, su, off, 0];
}, exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
}, wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
}, wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
}, ZipPassThrough, ZipDeflate, AsyncZipDeflate, Zip, UnzipPassThrough, UnzipInflate, AsyncUnzipInflate, Unzip, mt;
var init_browser = __esm(() => {
  ch2 = {};
  u8 = Uint8Array;
  u16 = Uint16Array;
  i32 = Int32Array;
  fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
  fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
  clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  _a = freb(fleb, 2);
  fl = _a.b;
  revfl = _a.r;
  fl[28] = 258, revfl[258] = 28;
  _b = freb(fdeb, 0);
  fd = _b.b;
  revfd = _b.r;
  rev = new u16(32768);
  for (i = 0;i < 32768; ++i) {
    x = (i & 43690) >> 1 | (i & 21845) << 1;
    x = (x & 52428) >> 2 | (x & 13107) << 2;
    x = (x & 61680) >> 4 | (x & 3855) << 4;
    rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
  }
  flt = new u8(288);
  for (i = 0;i < 144; ++i)
    flt[i] = 8;
  for (i = 144;i < 256; ++i)
    flt[i] = 9;
  for (i = 256;i < 280; ++i)
    flt[i] = 7;
  for (i = 280;i < 288; ++i)
    flt[i] = 8;
  fdt = new u8(32);
  for (i = 0;i < 32; ++i)
    fdt[i] = 5;
  flm = /* @__PURE__ */ hMap(flt, 9, 0);
  flrm = /* @__PURE__ */ hMap(flt, 9, 1);
  fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
  fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
  FlateErrorCode = {
    UnexpectedEOF: 0,
    InvalidBlockType: 1,
    InvalidLengthLiteral: 2,
    InvalidDistance: 3,
    StreamFinished: 4,
    NoStreamHandler: 5,
    InvalidHeader: 6,
    NoCallback: 7,
    InvalidUTF8: 8,
    ExtraFieldTooLong: 9,
    InvalidDate: 10,
    FilenameTooLong: 11,
    StreamFinishing: 12,
    InvalidZipData: 13,
    UnknownCompressionMethod: 14
  };
  ec = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
  ];
  deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  et = /* @__PURE__ */ new u8(0);
  crct = /* @__PURE__ */ function() {
    var t = new Int32Array(256);
    for (var i2 = 0;i2 < 256; ++i2) {
      var c = i2, k = 9;
      while (--k)
        c = (c & 1 && -306674912) ^ c >>> 1;
      t[i2] = c;
    }
    return t;
  }();
  ch = [];
  Deflate = /* @__PURE__ */ function() {
    function Deflate2(opts, cb) {
      if (typeof opts == "function")
        cb = opts, opts = {};
      this.ondata = cb;
      this.o = opts || {};
      this.s = { l: 0, i: 32768, w: 32768, z: 32768 };
      this.b = new u8(98304);
      if (this.o.dictionary) {
        var dict = this.o.dictionary.subarray(-32768);
        this.b.set(dict, 32768 - dict.length);
        this.s.i = 32768 - dict.length;
      }
    }
    Deflate2.prototype.p = function(c, f) {
      this.ondata(dopt(c, this.o, 0, 0, this.s), f);
    };
    Deflate2.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      if (this.s.l)
        err(4);
      var endLen = chunk.length + this.s.z;
      if (endLen > this.b.length) {
        if (endLen > 2 * this.b.length - 32768) {
          var newBuf = new u8(endLen & -32768);
          newBuf.set(this.b.subarray(0, this.s.z));
          this.b = newBuf;
        }
        var split = this.b.length - this.s.z;
        this.b.set(chunk.subarray(0, split), this.s.z);
        this.s.z = this.b.length;
        this.p(this.b, false);
        this.b.set(this.b.subarray(-32768));
        this.b.set(chunk.subarray(split), 32768);
        this.s.z = chunk.length - split + 32768;
        this.s.i = 32766, this.s.w = 32768;
      } else {
        this.b.set(chunk, this.s.z);
        this.s.z += chunk.length;
      }
      this.s.l = final & 1;
      if (this.s.z > this.s.w + 8191 || final) {
        this.p(this.b, final || false);
        this.s.w = this.s.i, this.s.i -= 2;
      }
      if (final) {
        this.s = this.o = {};
        this.b = et;
      }
    };
    Deflate2.prototype.flush = function(sync) {
      if (!this.ondata)
        err(5);
      if (this.s.l)
        err(4);
      this.p(this.b, false);
      this.s.w = this.s.i, this.s.i -= 2;
      if (sync) {
        var c = new u8(6);
        c[0] = this.s.r >> 3;
        var ep = wfblk(c, this.s.r, et);
        this.s.r = 0;
        this.ondata(c.subarray(0, ep >> 3), false);
      }
    };
    return Deflate2;
  }();
  AsyncDeflate = /* @__PURE__ */ function() {
    function AsyncDeflate2(opts, cb) {
      astrmify([
        bDflt,
        function() {
          return [astrm, Deflate];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Deflate(ev.data);
        onmessage = astrm(strm);
      }, 6, 1);
    }
    return AsyncDeflate2;
  }();
  Inflate = /* @__PURE__ */ function() {
    function Inflate2(opts, cb) {
      if (typeof opts == "function")
        cb = opts, opts = {};
      this.ondata = cb;
      var dict = opts && opts.dictionary && opts.dictionary.subarray(-32768);
      this.s = { i: 0, b: dict ? dict.length : 0 };
      this.o = new u8(32768);
      this.p = new u8(0);
      if (dict)
        this.o.set(dict);
    }
    Inflate2.prototype.e = function(c) {
      if (!this.ondata)
        err(5);
      if (this.d)
        err(4);
      if (!this.p.length)
        this.p = c;
      else if (c.length) {
        var n = new u8(this.p.length + c.length);
        n.set(this.p), n.set(c, this.p.length), this.p = n;
      }
    };
    Inflate2.prototype.c = function(final) {
      this.s.i = +(this.d = final || false);
      var bts = this.s.b;
      var dt = inflt(this.p, this.s, this.o);
      this.ondata(slc(dt, bts, this.s.b), this.d);
      this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
      this.p = slc(this.p, this.s.p / 8 | 0), this.s.p &= 7;
    };
    Inflate2.prototype.push = function(chunk, final) {
      this.e(chunk), this.c(final);
    };
    return Inflate2;
  }();
  AsyncInflate = /* @__PURE__ */ function() {
    function AsyncInflate2(opts, cb) {
      astrmify([
        bInflt,
        function() {
          return [astrm, Inflate];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Inflate(ev.data);
        onmessage = astrm(strm);
      }, 7, 0);
    }
    return AsyncInflate2;
  }();
  Gzip = /* @__PURE__ */ function() {
    function Gzip2(opts, cb) {
      this.c = crc();
      this.l = 0;
      this.v = 1;
      Deflate.call(this, opts, cb);
    }
    Gzip2.prototype.push = function(chunk, final) {
      this.c.p(chunk);
      this.l += chunk.length;
      Deflate.prototype.push.call(this, chunk, final);
    };
    Gzip2.prototype.p = function(c, f) {
      var raw = dopt(c, this.o, this.v && gzhl(this.o), f && 8, this.s);
      if (this.v)
        gzh(raw, this.o), this.v = 0;
      if (f)
        wbytes(raw, raw.length - 8, this.c.d()), wbytes(raw, raw.length - 4, this.l);
      this.ondata(raw, f);
    };
    Gzip2.prototype.flush = function(sync) {
      Deflate.prototype.flush.call(this, sync);
    };
    return Gzip2;
  }();
  AsyncGzip = /* @__PURE__ */ function() {
    function AsyncGzip2(opts, cb) {
      astrmify([
        bDflt,
        gze,
        function() {
          return [astrm, Deflate, Gzip];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Gzip(ev.data);
        onmessage = astrm(strm);
      }, 8, 1);
    }
    return AsyncGzip2;
  }();
  Gunzip = /* @__PURE__ */ function() {
    function Gunzip2(opts, cb) {
      this.v = 1;
      this.r = 0;
      Inflate.call(this, opts, cb);
    }
    Gunzip2.prototype.push = function(chunk, final) {
      Inflate.prototype.e.call(this, chunk);
      this.r += chunk.length;
      if (this.v) {
        var p = this.p.subarray(this.v - 1);
        var s = p.length > 3 ? gzs(p) : 4;
        if (s > p.length) {
          if (!final)
            return;
        } else if (this.v > 1 && this.onmember) {
          this.onmember(this.r - p.length);
        }
        this.p = p.subarray(s), this.v = 0;
      }
      Inflate.prototype.c.call(this, 0);
      if (this.s.f && !this.s.l) {
        this.v = shft(this.s.p) + 9;
        this.s = { i: 0 };
        this.o = new u8(0);
        this.push(new u8(0), final);
      } else if (final) {
        Inflate.prototype.c.call(this, final);
      }
    };
    return Gunzip2;
  }();
  AsyncGunzip = /* @__PURE__ */ function() {
    function AsyncGunzip2(opts, cb) {
      var _this = this;
      astrmify([
        bInflt,
        guze,
        function() {
          return [astrm, Inflate, Gunzip];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Gunzip(ev.data);
        strm.onmember = function(offset) {
          return postMessage(offset);
        };
        onmessage = astrm(strm);
      }, 9, 0, function(offset) {
        return _this.onmember && _this.onmember(offset);
      });
    }
    return AsyncGunzip2;
  }();
  Zlib = /* @__PURE__ */ function() {
    function Zlib2(opts, cb) {
      this.c = adler();
      this.v = 1;
      Deflate.call(this, opts, cb);
    }
    Zlib2.prototype.push = function(chunk, final) {
      this.c.p(chunk);
      Deflate.prototype.push.call(this, chunk, final);
    };
    Zlib2.prototype.p = function(c, f) {
      var raw = dopt(c, this.o, this.v && (this.o.dictionary ? 6 : 2), f && 4, this.s);
      if (this.v)
        zlh(raw, this.o), this.v = 0;
      if (f)
        wbytes(raw, raw.length - 4, this.c.d());
      this.ondata(raw, f);
    };
    Zlib2.prototype.flush = function(sync) {
      Deflate.prototype.flush.call(this, sync);
    };
    return Zlib2;
  }();
  AsyncZlib = /* @__PURE__ */ function() {
    function AsyncZlib2(opts, cb) {
      astrmify([
        bDflt,
        zle,
        function() {
          return [astrm, Deflate, Zlib];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Zlib(ev.data);
        onmessage = astrm(strm);
      }, 10, 1);
    }
    return AsyncZlib2;
  }();
  Unzlib = /* @__PURE__ */ function() {
    function Unzlib2(opts, cb) {
      Inflate.call(this, opts, cb);
      this.v = opts && opts.dictionary ? 2 : 1;
    }
    Unzlib2.prototype.push = function(chunk, final) {
      Inflate.prototype.e.call(this, chunk);
      if (this.v) {
        if (this.p.length < 6 && !final)
          return;
        this.p = this.p.subarray(zls(this.p, this.v - 1)), this.v = 0;
      }
      if (final) {
        if (this.p.length < 4)
          err(6, "invalid zlib data");
        this.p = this.p.subarray(0, -4);
      }
      Inflate.prototype.c.call(this, final);
    };
    return Unzlib2;
  }();
  AsyncUnzlib = /* @__PURE__ */ function() {
    function AsyncUnzlib2(opts, cb) {
      astrmify([
        bInflt,
        zule,
        function() {
          return [astrm, Inflate, Unzlib];
        }
      ], this, StrmOpt.call(this, opts, cb), function(ev) {
        var strm = new Unzlib(ev.data);
        onmessage = astrm(strm);
      }, 11, 0);
    }
    return AsyncUnzlib2;
  }();
  Decompress = /* @__PURE__ */ function() {
    function Decompress2(opts, cb) {
      this.o = StrmOpt.call(this, opts, cb) || {};
      this.G = Gunzip;
      this.I = Inflate;
      this.Z = Unzlib;
    }
    Decompress2.prototype.i = function() {
      var _this = this;
      this.s.ondata = function(dat, final) {
        _this.ondata(dat, final);
      };
    };
    Decompress2.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      if (!this.s) {
        if (this.p && this.p.length) {
          var n = new u8(this.p.length + chunk.length);
          n.set(this.p), n.set(chunk, this.p.length);
        } else
          this.p = chunk;
        if (this.p.length > 2) {
          this.s = this.p[0] == 31 && this.p[1] == 139 && this.p[2] == 8 ? new this.G(this.o) : (this.p[0] & 15) != 8 || this.p[0] >> 4 > 7 || (this.p[0] << 8 | this.p[1]) % 31 ? new this.I(this.o) : new this.Z(this.o);
          this.i();
          this.s.push(this.p, final);
          this.p = null;
        }
      } else
        this.s.push(chunk, final);
    };
    return Decompress2;
  }();
  AsyncDecompress = /* @__PURE__ */ function() {
    function AsyncDecompress2(opts, cb) {
      Decompress.call(this, opts, cb);
      this.queuedSize = 0;
      this.G = AsyncGunzip;
      this.I = AsyncInflate;
      this.Z = AsyncUnzlib;
    }
    AsyncDecompress2.prototype.i = function() {
      var _this = this;
      this.s.ondata = function(err2, dat, final) {
        _this.ondata(err2, dat, final);
      };
      this.s.ondrain = function(size) {
        _this.queuedSize -= size;
        if (_this.ondrain)
          _this.ondrain(size);
      };
    };
    AsyncDecompress2.prototype.push = function(chunk, final) {
      this.queuedSize += chunk.length;
      Decompress.prototype.push.call(this, chunk, final);
    };
    return AsyncDecompress2;
  }();
  te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder;
  td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder;
  try {
    td.decode(et, { stream: true });
    tds = 1;
  } catch (e) {}
  DecodeUTF8 = /* @__PURE__ */ function() {
    function DecodeUTF82(cb) {
      this.ondata = cb;
      if (tds)
        this.t = new TextDecoder;
      else
        this.p = et;
    }
    DecodeUTF82.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      final = !!final;
      if (this.t) {
        this.ondata(this.t.decode(chunk, { stream: true }), final);
        if (final) {
          if (this.t.decode().length)
            err(8);
          this.t = null;
        }
        return;
      }
      if (!this.p)
        err(4);
      var dat = new u8(this.p.length + chunk.length);
      dat.set(this.p);
      dat.set(chunk, this.p.length);
      var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
      if (final) {
        if (r.length)
          err(8);
        this.p = null;
      } else
        this.p = r;
      this.ondata(s, final);
    };
    return DecodeUTF82;
  }();
  EncodeUTF8 = /* @__PURE__ */ function() {
    function EncodeUTF82(cb) {
      this.ondata = cb;
    }
    EncodeUTF82.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      if (this.d)
        err(4);
      this.ondata(strToU8(chunk), this.d = final || false);
    };
    return EncodeUTF82;
  }();
  ZipPassThrough = /* @__PURE__ */ function() {
    function ZipPassThrough2(filename) {
      this.filename = filename;
      this.c = crc();
      this.size = 0;
      this.compression = 0;
    }
    ZipPassThrough2.prototype.process = function(chunk, final) {
      this.ondata(null, chunk, final);
    };
    ZipPassThrough2.prototype.push = function(chunk, final) {
      if (!this.ondata)
        err(5);
      this.c.p(chunk);
      this.size += chunk.length;
      if (final)
        this.crc = this.c.d();
      this.process(chunk, final || false);
    };
    return ZipPassThrough2;
  }();
  ZipDeflate = /* @__PURE__ */ function() {
    function ZipDeflate2(filename, opts) {
      var _this = this;
      if (!opts)
        opts = {};
      ZipPassThrough.call(this, filename);
      this.d = new Deflate(opts, function(dat, final) {
        _this.ondata(null, dat, final);
      });
      this.compression = 8;
      this.flag = dbf(opts.level);
    }
    ZipDeflate2.prototype.process = function(chunk, final) {
      try {
        this.d.push(chunk, final);
      } catch (e) {
        this.ondata(e, null, final);
      }
    };
    ZipDeflate2.prototype.push = function(chunk, final) {
      ZipPassThrough.prototype.push.call(this, chunk, final);
    };
    return ZipDeflate2;
  }();
  AsyncZipDeflate = /* @__PURE__ */ function() {
    function AsyncZipDeflate2(filename, opts) {
      var _this = this;
      if (!opts)
        opts = {};
      ZipPassThrough.call(this, filename);
      this.d = new AsyncDeflate(opts, function(err2, dat, final) {
        _this.ondata(err2, dat, final);
      });
      this.compression = 8;
      this.flag = dbf(opts.level);
      this.terminate = this.d.terminate;
    }
    AsyncZipDeflate2.prototype.process = function(chunk, final) {
      this.d.push(chunk, final);
    };
    AsyncZipDeflate2.prototype.push = function(chunk, final) {
      ZipPassThrough.prototype.push.call(this, chunk, final);
    };
    return AsyncZipDeflate2;
  }();
  Zip = /* @__PURE__ */ function() {
    function Zip2(cb) {
      this.ondata = cb;
      this.u = [];
      this.d = 1;
    }
    Zip2.prototype.add = function(file) {
      var _this = this;
      if (!this.ondata)
        err(5);
      if (this.d & 2)
        this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, false);
      else {
        var f = strToU8(file.filename), fl_1 = f.length;
        var com = file.comment, o = com && strToU8(com);
        var u = fl_1 != file.filename.length || o && com.length != o.length;
        var hl_1 = fl_1 + exfl(file.extra) + 30;
        if (fl_1 > 65535)
          this.ondata(err(11, 0, 1), null, false);
        var header = new u8(hl_1);
        wzh(header, 0, file, f, u, -1);
        var chks_1 = [header];
        var pAll_1 = function() {
          for (var _i = 0, chks_2 = chks_1;_i < chks_2.length; _i++) {
            var chk = chks_2[_i];
            _this.ondata(null, chk, false);
          }
          chks_1 = [];
        };
        var tr_1 = this.d;
        this.d = 0;
        var ind_1 = this.u.length;
        var uf_1 = mrg(file, {
          f,
          u,
          o,
          t: function() {
            if (file.terminate)
              file.terminate();
          },
          r: function() {
            pAll_1();
            if (tr_1) {
              var nxt = _this.u[ind_1 + 1];
              if (nxt)
                nxt.r();
              else
                _this.d = 1;
            }
            tr_1 = 1;
          }
        });
        var cl_1 = 0;
        file.ondata = function(err2, dat, final) {
          if (err2) {
            _this.ondata(err2, dat, final);
            _this.terminate();
          } else {
            cl_1 += dat.length;
            chks_1.push(dat);
            if (final) {
              var dd = new u8(16);
              wbytes(dd, 0, 134695760);
              wbytes(dd, 4, file.crc);
              wbytes(dd, 8, cl_1);
              wbytes(dd, 12, file.size);
              chks_1.push(dd);
              uf_1.c = cl_1, uf_1.b = hl_1 + cl_1 + 16, uf_1.crc = file.crc, uf_1.size = file.size;
              if (tr_1)
                uf_1.r();
              tr_1 = 1;
            } else if (tr_1)
              pAll_1();
          }
        };
        this.u.push(uf_1);
      }
    };
    Zip2.prototype.end = function() {
      var _this = this;
      if (this.d & 2) {
        this.ondata(err(4 + (this.d & 1) * 8, 0, 1), null, true);
        return;
      }
      if (this.d)
        this.e();
      else
        this.u.push({
          r: function() {
            if (!(_this.d & 1))
              return;
            _this.u.splice(-1, 1);
            _this.e();
          },
          t: function() {}
        });
      this.d = 3;
    };
    Zip2.prototype.e = function() {
      var bt = 0, l = 0, tl = 0;
      for (var _i = 0, _a2 = this.u;_i < _a2.length; _i++) {
        var f = _a2[_i];
        tl += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0);
      }
      var out = new u8(tl + 22);
      for (var _b2 = 0, _c = this.u;_b2 < _c.length; _b2++) {
        var f = _c[_b2];
        wzh(out, bt, f, f.f, f.u, -f.c - 2, l, f.o);
        bt += 46 + f.f.length + exfl(f.extra) + (f.o ? f.o.length : 0), l += f.b;
      }
      wzf(out, bt, this.u.length, tl, l);
      this.ondata(null, out, true);
      this.d = 2;
    };
    Zip2.prototype.terminate = function() {
      for (var _i = 0, _a2 = this.u;_i < _a2.length; _i++) {
        var f = _a2[_i];
        f.t();
      }
      this.d = 2;
    };
    return Zip2;
  }();
  UnzipPassThrough = /* @__PURE__ */ function() {
    function UnzipPassThrough2() {}
    UnzipPassThrough2.prototype.push = function(chunk, final) {
      this.ondata(null, chunk, final);
    };
    UnzipPassThrough2.compression = 0;
    return UnzipPassThrough2;
  }();
  UnzipInflate = /* @__PURE__ */ function() {
    function UnzipInflate2() {
      var _this = this;
      this.i = new Inflate(function(dat, final) {
        _this.ondata(null, dat, final);
      });
    }
    UnzipInflate2.prototype.push = function(chunk, final) {
      try {
        this.i.push(chunk, final);
      } catch (e) {
        this.ondata(e, null, final);
      }
    };
    UnzipInflate2.compression = 8;
    return UnzipInflate2;
  }();
  AsyncUnzipInflate = /* @__PURE__ */ function() {
    function AsyncUnzipInflate2(_, sz) {
      var _this = this;
      if (sz < 320000) {
        this.i = new Inflate(function(dat, final) {
          _this.ondata(null, dat, final);
        });
      } else {
        this.i = new AsyncInflate(function(err2, dat, final) {
          _this.ondata(err2, dat, final);
        });
        this.terminate = this.i.terminate;
      }
    }
    AsyncUnzipInflate2.prototype.push = function(chunk, final) {
      if (this.i.terminate)
        chunk = slc(chunk, 0);
      this.i.push(chunk, final);
    };
    AsyncUnzipInflate2.compression = 8;
    return AsyncUnzipInflate2;
  }();
  Unzip = /* @__PURE__ */ function() {
    function Unzip2(cb) {
      this.onfile = cb;
      this.k = [];
      this.o = {
        0: UnzipPassThrough
      };
      this.p = et;
    }
    Unzip2.prototype.push = function(chunk, final) {
      var _this = this;
      if (!this.onfile)
        err(5);
      if (!this.p)
        err(4);
      if (this.c > 0) {
        var len = Math.min(this.c, chunk.length);
        var toAdd = chunk.subarray(0, len);
        this.c -= len;
        if (this.d)
          this.d.push(toAdd, !this.c);
        else
          this.k[0].push(toAdd);
        chunk = chunk.subarray(len);
        if (chunk.length)
          return this.push(chunk, final);
      } else {
        var f = 0, i2 = 0, is = undefined, buf = undefined;
        if (!this.p.length)
          buf = chunk;
        else if (!chunk.length)
          buf = this.p;
        else {
          buf = new u8(this.p.length + chunk.length);
          buf.set(this.p), buf.set(chunk, this.p.length);
        }
        var l = buf.length, oc = this.c, add = oc && this.d;
        var _loop_2 = function() {
          var sig = b4(buf, i2);
          if (sig == 67324752) {
            f = 1, is = i2;
            this_1.d = null;
            this_1.c = 0;
            var bf = b2(buf, i2 + 6), cmp_1 = b2(buf, i2 + 8), u = bf & 2048, dd = bf & 8, fnl = b2(buf, i2 + 26), es = b2(buf, i2 + 28);
            if (l > i2 + 30 + fnl + es) {
              var chks_3 = [];
              this_1.k.unshift(chks_3);
              f = 2;
              var lsc = b4(buf, i2 + 18), lsu = b4(buf, i2 + 22);
              var fn_1 = strFromU8(buf.subarray(i2 + 30, i2 += 30 + fnl), !u);
              var _a2 = z64hs(buf, i2, es, 2, lsc, lsu, 0), sc_1 = _a2[0], su_1 = _a2[1], z64 = _a2[3];
              if (dd)
                sc_1 = -1 - z64;
              i2 += es;
              this_1.c = sc_1;
              var d_1;
              var file_1 = {
                name: fn_1,
                compression: cmp_1,
                start: function() {
                  if (!file_1.ondata)
                    err(5);
                  if (!sc_1)
                    file_1.ondata(null, et, true);
                  else {
                    var ctr = _this.o[cmp_1];
                    if (!ctr)
                      file_1.ondata(err(14, "unknown compression type " + cmp_1, 1), null, false);
                    d_1 = sc_1 < 0 ? new ctr(fn_1) : new ctr(fn_1, sc_1, su_1);
                    d_1.ondata = function(err2, dat3, final2) {
                      file_1.ondata(err2, dat3, final2);
                    };
                    for (var _i = 0, chks_4 = chks_3;_i < chks_4.length; _i++) {
                      var dat2 = chks_4[_i];
                      d_1.push(dat2, false);
                    }
                    if (_this.k[0] == chks_3 && _this.c)
                      _this.d = d_1;
                    else
                      d_1.push(et, true);
                  }
                },
                terminate: function() {
                  if (d_1 && d_1.terminate)
                    d_1.terminate();
                }
              };
              if (sc_1 >= 0)
                file_1.size = sc_1, file_1.originalSize = su_1;
              this_1.onfile(file_1);
            }
            return "break";
          } else if (oc) {
            if (sig == 134695760) {
              is = i2 += 12 + (oc == -2 && 8), f = 3, this_1.c = 0;
              return "break";
            } else if (sig == 33639248) {
              is = i2 -= 4, f = 3, this_1.c = 0;
              return "break";
            }
          }
        };
        var this_1 = this;
        for (;i2 < l - 4; ++i2) {
          var state_1 = _loop_2();
          if (state_1 === "break")
            break;
        }
        this.p = et;
        if (oc < 0) {
          var dat = f ? buf.subarray(0, is - 12 - (oc == -2 && 8) - (b4(buf, is - 16) == 134695760 && 4)) : buf.subarray(0, i2);
          if (add)
            add.push(dat, !!f);
          else
            this.k[+(f == 2)].push(dat);
        }
        if (f & 2)
          return this.push(buf.subarray(i2), final);
        this.p = buf.subarray(i2);
      }
      if (final) {
        if (this.c)
          err(13);
        this.p = null;
      }
    };
    Unzip2.prototype.register = function(decoder) {
      this.o[decoder.compression] = decoder;
    };
    return Unzip2;
  }();
  mt = typeof queueMicrotask == "function" ? queueMicrotask : typeof setTimeout == "function" ? setTimeout : function(fn) {
    fn();
  };
});

// src/packages/opencontainer/kernel/vfs.ts
var S_IFMT = 61440;
var S_IFREG = 32768;
var S_IFDIR = 16384;
var S_IFLNK = 40960;
var nextIno = 1;

class VfsError extends Error {
  code;
  errno;
  syscall;
  path;
  constructor(code, errno, syscall, path, message) {
    super(message ?? `${code}: ${syscall}, ${path}`);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
    if (code === "ENOENT") {
      const g = globalThis;
      if (g.__ocVfsEnoentLog) {
        try {
          g.__ocVfsEnoentLog.push({
            syscall,
            path,
            stack: String(new Error().stack ?? "").split(`
`).slice(2, 7).join(" | ")
          });
          if (g.__ocVfsEnoentLog.length > 200)
            g.__ocVfsEnoentLog.shift();
        } catch {}
      }
    }
  }
}
function errnoOf(code) {
  const table = {
    EPERM: 1,
    ENOENT: 2,
    ESRCH: 3,
    EINTR: 4,
    EIO: 5,
    ENXIO: 6,
    E2BIG: 7,
    ENOEXEC: 8,
    EBADF: 9,
    ECHILD: 10,
    EAGAIN: 11,
    ENOMEM: 12,
    EACCES: 13,
    EFAULT: 14,
    EBUSY: 16,
    EEXIST: 17,
    EXDEV: 18,
    ENODEV: 19,
    ENOTDIR: 20,
    EISDIR: 21,
    EINVAL: 22,
    ENFILE: 23,
    EMFILE: 24,
    ENOTTY: 25,
    EFBIG: 27,
    ENOSPC: 28,
    ESPIPE: 29,
    EROFS: 30,
    EMLINK: 31,
    EPIPE: 32,
    ENAMETOOLONG: 36,
    ENOSYS: 38,
    ENOTEMPTY: 39,
    ELOOP: 40,
    ENODATA: 61,
    ENOTSOCK: 88,
    EDESTADDRREQ: 89,
    EMSGSIZE: 90,
    EPROTOTYPE: 91,
    ENOPROTOOPT: 92,
    EPROTONOSUPPORT: 93,
    EOPNOTSUPP: 95,
    EAFNOSUPPORT: 97,
    EADDRINUSE: 98,
    EADDRNOTAVAIL: 99,
    ENETDOWN: 100,
    ENETUNREACH: 101,
    ECONNABORTED: 103,
    ECONNRESET: 104,
    ENOBUFS: 105,
    EISCONN: 106,
    ENOTCONN: 107,
    ETIMEDOUT: 110,
    ECONNREFUSED: 111,
    EHOSTUNREACH: 113,
    EINPROGRESS: 115
  };
  return table[code] ?? -1;
}

class Vfs {
  now;
  root;
  watchersByDir = new Map;
  persist;
  cwdProvider;
  constructor(now = () => Date.now()) {
    this.now = now;
    this.root = this.makeNode("/", null, S_IFDIR | 493);
  }
  makeNode(name, parent, mode, data) {
    const t = this.now();
    return {
      name,
      parent,
      mode,
      data,
      mtimeMs: t,
      atimeMs: t,
      ctimeMs: t,
      birthtimeMs: t,
      ino: nextIno++,
      watchers: new Set
    };
  }
  normalize(p) {
    if (p === "") {
      throw new VfsError("ERR_INVALID_ARG_VALUE", 22, "normalize", p, 'The "path" argument must not be empty');
    }
    if (!p.startsWith("/")) {
      const base = this.cwdProvider?.() ?? "/";
      p = `${base.replace(/\/+$/, "")}/${p}`;
    }
    const isDir = p.endsWith("/");
    const out = [];
    for (const seg of p.split("/")) {
      if (!seg || seg === ".")
        continue;
      if (seg === "..") {
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return "/" + out.join("/") + (isDir && out.length ? "/" : "");
  }
  lookup(p, followLast = true) {
    const norm = this.normalize(p);
    if (norm === "/")
      return this.root;
    let cur = this.root;
    for (const seg of norm.split("/").filter(Boolean)) {
      if ((cur.mode & S_IFMT) === S_IFLNK && followLast !== false) {
        const t = cur.target ?? "/";
        cur = this.lookup(this.joinPaths(this.pathOf(cur.parent ?? this.root), t)) ?? cur;
      }
      if ((cur.mode & S_IFMT) !== S_IFDIR)
        return null;
      const child = this.childrenOf(cur).find((c) => c.name === seg);
      if (!child)
        return null;
      if ((child.mode & S_IFMT) === S_IFLNK && followLast) {
        const target = this.joinPaths(this.pathOf(child.parent ?? this.root), child.target ?? "/");
        const resolved = this.lookup(target);
        if (!resolved)
          return null;
        cur = resolved;
      } else {
        cur = child;
      }
    }
    return cur;
  }
  childrenOf(dir) {
    return dir._children ?? [];
  }
  attach(parent, child) {
    parent._children = parent._children ?? [];
    parent._children.push(child);
  }
  detach(parent, child) {
    const kids = parent._children;
    if (!kids)
      return;
    const i = kids.indexOf(child);
    if (i >= 0)
      kids.splice(i, 1);
  }
  pathOf(node) {
    if (!node.parent)
      return "/";
    const segs = [];
    let cur = node;
    while (cur && cur.parent) {
      segs.unshift(cur.name);
      cur = cur.parent;
    }
    return "/" + segs.join("/");
  }
  joinPaths(a, b) {
    if (b.startsWith("/"))
      return this.normalize(b);
    return this.normalize(a.replace(/\/+$/, "") + "/" + b);
  }
  stat(p, followSymlinks = true) {
    const node = this.lookup(p, followSymlinks);
    if (!node)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "stat", p);
    return this.statOf(node);
  }
  lstat(p) {
    const node = this.lookup(p, false);
    if (!node)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "lstat", p);
    return this.statOf(node);
  }
  statOf(node) {
    const isDir = (node.mode & S_IFMT) === S_IFDIR;
    return {
      dev: 1,
      ino: node.ino,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: isDir ? 0 : node.data?.byteLength ?? 0,
      blksize: 4096,
      blocks: Math.ceil((node.data?.byteLength ?? 0) / 512),
      atimeMs: node.atimeMs,
      mtimeMs: node.mtimeMs,
      ctimeMs: node.ctimeMs,
      birthtimeMs: node.birthtimeMs
    };
  }
  exists(p) {
    try {
      this.stat(p);
      return true;
    } catch {
      return false;
    }
  }
  isDirectory(p) {
    try {
      return (this.stat(p).mode & S_IFMT) === S_IFDIR;
    } catch {
      return false;
    }
  }
  mkdir(p, recursive = false, mode = 511) {
    const norm = this.normalize(p);
    if (norm === "/") {
      if (recursive)
        return null;
      throw new VfsError("EEXIST", errnoOf("EEXIST"), "mkdir", p);
    }
    const existing = this.lookup(norm);
    if (existing) {
      if (recursive && (existing.mode & S_IFMT) === S_IFDIR)
        return null;
      throw new VfsError("EEXIST", errnoOf("EEXIST"), "mkdir", p);
    }
    if (!recursive) {
      const parent = this.lookup(this.dirname(norm));
      if (!parent || (parent.mode & S_IFMT) !== S_IFDIR) {
        throw new VfsError("ENOENT", errnoOf("ENOENT"), "mkdir", p);
      }
    }
    const segs = norm.split("/").filter(Boolean);
    let cur = this.root;
    let createdAny = false;
    for (let i = 0;i < segs.length; i++) {
      const name = segs[i];
      let child = this.childrenOf(cur).find((c) => c.name === name);
      if (!child) {
        if (i === segs.length - 1 && this.lookup(this.joinPaths(this.pathOf(cur), name))) {
          throw new VfsError("EEXIST", errnoOf("EEXIST"), "mkdir", p);
        }
        child = this.makeNode(name, cur, S_IFDIR | mode & 511);
        this.attach(cur, child);
        this.fireRename(this.pathOf(cur));
        createdAny = true;
      } else if ((child.mode & S_IFMT) === S_IFLNK) {
        child = this.lookup(this.joinPaths(this.pathOf(cur), child.target ?? "/")) ?? child;
      }
      if ((child.mode & S_IFMT) !== S_IFDIR) {
        throw new VfsError("ENOTDIR", errnoOf("ENOTDIR"), "mkdir", p);
      }
      cur = child;
    }
    if (createdAny)
      this.persist?.({ type: "mkdir", path: norm });
    return norm;
  }
  dirname(p) {
    const norm = this.normalize(p);
    if (norm === "/")
      return "/";
    const segs = norm.split("/").filter(Boolean);
    segs.pop();
    return segs.length ? "/" + segs.join("/") : "/";
  }
  basename(p) {
    const segs = this.normalize(p).split("/").filter(Boolean);
    return segs.length ? segs[segs.length - 1] : "/";
  }
  readFile(p) {
    const node = this.mustFile(p, "readFile");
    return node.data ? node.data.slice() : new Uint8Array(0);
  }
  readTextFile(p) {
    return new TextDecoder().decode(this.readFile(p));
  }
  writeFile(p, data, mode = 438) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const norm = this.normalize(p);
    const parentNode = this.lookup(this.dirname(norm));
    if (!parentNode || (parentNode.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "open", p);
    }
    let node = this.childrenOf(parentNode).find((c) => c.name === this.basename(norm));
    if (node && (node.mode & S_IFMT) === S_IFDIR) {
      throw new VfsError("EISDIR", errnoOf("EISDIR"), "open", p);
    }
    if (node && (node.mode & S_IFMT) === S_IFLNK) {
      const target = this.joinPaths(this.dirname(norm), node.target ?? "/");
      this.writeFile(target, bytes);
      return;
    }
    const t = this.now();
    if (!node) {
      node = this.makeNode(this.basename(norm), parentNode, S_IFREG | mode & 511, bytes.slice());
      this.attach(parentNode, node);
      this.fireRename(this.dirname(norm));
    } else {
      node.data = bytes.slice();
      node.mtimeMs = node.ctimeMs = t;
      this.fireChange(norm);
    }
    this.persist?.({ type: "write", path: norm, data: bytes });
  }
  appendFile(p, data) {
    const existing = this.exists(p) ? this.readFile(p) : new Uint8Array(0);
    const add = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const merged = new Uint8Array(existing.byteLength + add.byteLength);
    merged.set(existing);
    merged.set(add, existing.byteLength);
    this.writeFile(p, merged);
  }
  readdir(p) {
    const node = this.mustDir(p, "readdir");
    return this.childrenOf(node).filter((c) => (c.mode & S_IFMT) !== 0).map((c) => c.name);
  }
  dirents(p) {
    const node = this.mustDir(p, "readdir");
    return this.childrenOf(node).map((c) => ({
      name: c.name,
      type: c.mode & S_IFMT
    }));
  }
  rm(p, opts = {}) {
    const norm = this.normalize(p);
    const node = this.lookup(norm, false);
    if (!node) {
      if (opts.force)
        return;
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "rm", p);
    }
    const isDir = (node.mode & S_IFMT) === S_IFDIR;
    if (isDir && !opts.recursive && this.childrenOf(node).length > 0) {
      throw new VfsError("ENOTEMPTY", errnoOf("ENOTEMPTY"), "rm", p);
    }
    const parent = node.parent ?? this.root;
    this.detach(parent, node);
    this.fireRename(this.pathOf(parent));
    this.persist?.({ type: "unlink", path: norm });
  }
  rename(oldPath, newPath) {
    const a = this.normalize(oldPath), b = this.normalize(newPath);
    const node = this.lookup(a, false);
    if (!node)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "rename", oldPath);
    const parentB = this.lookup(this.dirname(b));
    if (!parentB || (parentB.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "rename", newPath);
    }
    const existing = this.childrenOf(parentB).find((c) => c.name === this.basename(b));
    if (existing && existing !== node) {
      const existingIsDir = (existing.mode & S_IFMT) === S_IFDIR;
      const nodeIsDir = (node.mode & S_IFMT) === S_IFDIR;
      if (existingIsDir && nodeIsDir) {
        if (this.childrenOf(existing).length) {
          throw new VfsError("ENOTEMPTY", errnoOf("ENOTEMPTY"), "rename", newPath);
        }
        this.detach(parentB, existing);
      } else if (existingIsDir && !nodeIsDir) {
        throw new VfsError("EISDIR", errnoOf("EISDIR"), "rename", newPath);
      } else if (!existingIsDir && nodeIsDir) {
        throw new VfsError("ENOTDIR", errnoOf("ENOTDIR"), "rename", newPath);
      } else {
        this.detach(parentB, existing);
      }
    }
    const oldParent = node.parent ?? this.root;
    this.detach(oldParent, node);
    node.name = this.basename(b);
    node.parent = parentB;
    this.attach(parentB, node);
    this.fireRename(this.pathOf(oldParent));
    this.fireRename(this.dirname(b));
    this.persist?.({ type: "rename", from: a, to: b });
    if ((node.mode & S_IFMT) === S_IFREG && node.data) {
      this.persist?.({ type: "write", path: b, data: node.data });
    }
  }
  symlink(target, path) {
    const norm = this.normalize(path);
    const parentNode = this.lookup(this.dirname(norm));
    if (!parentNode)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "symlink", path);
    const node = this.makeNode(this.basename(norm), parentNode, S_IFLNK | 511);
    node.target = target;
    this.attach(parentNode, node);
    this.fireRename(this.dirname(norm));
    this.persist?.({ type: "symlink", path: norm, target });
  }
  readlink(p) {
    const node = this.lookup(p, false);
    if (!node)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "readlink", p);
    if ((node.mode & S_IFMT) !== S_IFLNK) {
      throw new VfsError("EINVAL", errnoOf("EINVAL"), "readlink", p);
    }
    return node.target ?? "";
  }
  copyFile(src, dest) {
    this.writeFile(dest, this.readFile(src));
  }
  chmod(p, mode) {
    const node = this.mustNode(p, "chmod");
    node.mode = node.mode & S_IFMT | mode & 4095;
    node.ctimeMs = this.now();
  }
  utimes(p, atimeMs, mtimeMs) {
    const node = this.mustNode(p, "utimes");
    node.atimeMs = atimeMs;
    node.mtimeMs = mtimeMs;
  }
  mountTree(dir, tree) {
    for (const [name, node] of Object.entries(tree)) {
      const path = this.joinPaths(dir, name);
      const anyNode = node;
      if (anyNode && typeof anyNode === "object" && "file" in anyNode) {
        const contents = anyNode.file.contents;
        if (typeof contents === "string")
          this.writeFile(path, contents);
        else if (contents instanceof Uint8Array)
          this.writeFile(path, contents);
      } else if (anyNode && typeof anyNode === "object" && "directory" in anyNode) {
        this.mkdir(path, true);
        this.mountTree(path, anyNode.directory.contents ?? {});
      } else if (typeof anyNode === "string") {
        this.writeFile(path, anyNode);
      }
    }
  }
  watch(path, onEvent) {
    const norm = this.normalize(path);
    const dirNode = this.mustDir(norm, "watch");
    const watcher = {
      path: norm,
      onEvent,
      close: () => {
        dirNode.watchers.delete(watcher);
        this.watchersByDir.get(dirNode)?.delete(watcher);
      }
    };
    dirNode.watchers.add(watcher);
    if (!this.watchersByDir.has(dirNode))
      this.watchersByDir.set(dirNode, new Set);
    this.watchersByDir.get(dirNode).add(watcher);
    return watcher;
  }
  fireRename(dirPath) {
    const dir = this.lookup(dirPath, false);
    if (dir)
      for (const w of dir.watchers)
        w.onEvent({ type: "rename", filename: null });
  }
  fireChange(filePath) {
    const dir = this.lookup(this.dirname(filePath), false);
    if (dir)
      for (const w of dir.watchers)
        w.onEvent({ type: "change", filename: this.basename(filePath) });
  }
  mustNode(p, syscall) {
    const node = this.lookup(p);
    if (!node)
      throw new VfsError("ENOENT", errnoOf("ENOENT"), syscall, p);
    return node;
  }
  mustFile(p, syscall) {
    const node = this.mustNode(p, syscall);
    if ((node.mode & S_IFMT) === S_IFDIR) {
      throw new VfsError("EISDIR", errnoOf("EISDIR"), syscall, p);
    }
    return node;
  }
  mustDir(p, syscall) {
    const node = this.mustNode(p, syscall);
    if ((node.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError("ENOTDIR", errnoOf("ENOTDIR"), syscall, p);
    }
    return node;
  }
  dump(dir = "/", depth = 0) {
    const lines = [];
    const node = this.lookup(dir);
    if (!node)
      return "(missing)";
    for (const c of this.childrenOf(node)) {
      lines.push("  ".repeat(depth) + c.name + ((c.mode & S_IFMT) === S_IFDIR ? "/" : ""));
      if ((c.mode & S_IFMT) === S_IFDIR)
        lines.push(this.dump(this.joinPaths(dir, c.name), depth + 1));
    }
    return lines.filter(Boolean).join(`
`);
  }
  exportTree(dir = "/") {
    const dirs = [];
    const files = [];
    const symlinks = [];
    const walk = (node, p) => {
      for (const c of this.childrenOf(node)) {
        const cp = p === "/" ? "/" + c.name : p + "/" + c.name;
        const t = c.mode & S_IFMT;
        if (t === S_IFDIR) {
          dirs.push(cp);
          walk(c, cp);
        } else if (t === S_IFLNK)
          symlinks.push([cp, c.target ?? "/"]);
        else
          files.push([cp, c.data ?? new Uint8Array(0)]);
      }
    };
    walk(this.lookup(dir, false) ?? this.root, this.normalize(dir));
    return { dirs, files, symlinks };
  }
  importTree(tree) {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const d of tree.dirs) {
        try {
          this.mkdir(d, true);
        } catch {}
      }
      const ensureParents = (p) => {
        const i = p.lastIndexOf("/");
        if (i <= 0)
          return;
        try {
          this.mkdir(p.slice(0, i), true);
        } catch {}
      };
      for (const [p, data] of tree.files) {
        try {
          ensureParents(p);
          this.writeFile(p, data);
        } catch {}
      }
      for (const [p, target] of tree.symlinks) {
        try {
          ensureParents(p);
          this.symlink(target, p);
        } catch {}
      }
    } finally {
      this.persist = prev;
    }
  }
  applyExternalOps(ops) {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const op of ops) {
        try {
          switch (op.type) {
            case "write":
              this.writeFile(op.path, op.data);
              break;
            case "mkdir":
              this.mkdir(op.path, true);
              break;
            case "symlink":
              this.symlink(op.target, op.path);
              break;
            case "unlink": {
              try {
                this.rm(op.path, { recursive: true, force: true });
              } catch {}
              break;
            }
            case "rename": {
              try {
                this.rename(op.from, op.to);
              } catch {}
              break;
            }
          }
        } catch {}
      }
    } finally {
      this.persist = prev;
    }
  }
}
// src/packages/opencontainer/vendor/node-v26.13.0/manifest.json
var manifest_default = {
  nodeVersion: "v26.13.0",
  generatedAt: "2026-11-02T14:37:41.855Z",
  ids: {
    tls: "lib/tls.js",
    https: "lib/https.js",
    dns: "lib/dns.js",
    url: "lib/url.js",
    "dns/promises": "lib/dns/promises.js",
    process: "lib/process.js",
    trace_events: "lib/trace_events.js",
    dtls: "lib/dtls.js",
    util: "lib/util.js",
    punycode: "lib/punycode.js",
    module: "lib/module.js",
    _tls_common: "lib/_tls_common.js",
    http: "lib/http.js",
    "assert/strict": "lib/assert/strict.js",
    "zlib/iter": "lib/zlib/iter.js",
    sys: "lib/sys.js",
    _http_common: "lib/_http_common.js",
    async_hooks: "lib/async_hooks.js",
    readline: "lib/readline.js",
    querystring: "lib/querystring.js",
    perf_hooks: "lib/perf_hooks.js",
    "internal/dtls/dtls": "lib/internal/dtls/dtls.js",
    "internal/dtls/stats": "lib/internal/dtls/stats.js",
    "internal/dtls/state": "lib/internal/dtls/state.js",
    "internal/dtls/symbols": "lib/internal/dtls/symbols.js",
    "internal/abort_controller": "lib/internal/abort_controller.js",
    "internal/url": "lib/internal/url.js",
    "internal/dns/utils": "lib/internal/dns/utils.js",
    "internal/dns/promises": "lib/internal/dns/promises.js",
    "internal/dns/callback_resolver": "lib/internal/dns/callback_resolver.js",
    "internal/vm/module": "lib/internal/vm/module.js",
    "internal/encoding/util": "lib/internal/encoding/util.js",
    "internal/encoding/single-byte": "lib/internal/encoding/single-byte.js",
    "internal/trace_events": "lib/internal/trace_events.js",
    "internal/socket_list": "lib/internal/socket_list.js",
    "internal/worker/clone_dom_exception": "lib/internal/worker/clone_dom_exception.js",
    "internal/worker/io": "lib/internal/worker/io.js",
    "internal/worker/js_transferable": "lib/internal/worker/js_transferable.js",
    "internal/worker/messaging": "lib/internal/worker/messaging.js",
    "internal/util": "lib/internal/util.js",
    "internal/errors/error_source": "lib/internal/errors/error_source.js",
    "internal/watchdog": "lib/internal/watchdog.js",
    "internal/priority_queue": "lib/internal/priority_queue.js",
    "internal/validators": "lib/internal/validators.js",
    "internal/wasm_web_api": "lib/internal/wasm_web_api.js",
    "internal/navigator": "lib/internal/navigator.js",
    "internal/crypto/util": "lib/internal/crypto/util.js",
    "internal/crypto/certificate": "lib/internal/crypto/certificate.js",
    "internal/crypto/ec": "lib/internal/crypto/ec.js",
    "internal/crypto/ml_dsa": "lib/internal/crypto/ml_dsa.js",
    "internal/crypto/cipher": "lib/internal/crypto/cipher.js",
    "internal/crypto/hash": "lib/internal/crypto/hash.js",
    "internal/crypto/random": "lib/internal/crypto/random.js",
    "internal/crypto/hkdf": "lib/internal/crypto/hkdf.js",
    "internal/crypto/hashnames": "lib/internal/crypto/hashnames.js",
    "internal/crypto/mac": "lib/internal/crypto/mac.js",
    "internal/crypto/ml_kem": "lib/internal/crypto/ml_kem.js",
    "internal/crypto/x509": "lib/internal/crypto/x509.js",
    "internal/crypto/diffiehellman": "lib/internal/crypto/diffiehellman.js",
    "internal/crypto/scrypt": "lib/internal/crypto/scrypt.js",
    "internal/crypto/keys": "lib/internal/crypto/keys.js",
    "internal/crypto/provider_mac": "lib/internal/crypto/provider_mac.js",
    "internal/crypto/chacha20_poly1305": "lib/internal/crypto/chacha20_poly1305.js",
    "internal/crypto/aes": "lib/internal/crypto/aes.js",
    "internal/crypto/kem": "lib/internal/crypto/kem.js",
    "internal/crypto/pbkdf2": "lib/internal/crypto/pbkdf2.js",
    "internal/crypto/webcrypto_util": "lib/internal/crypto/webcrypto_util.js",
    "internal/crypto/cfrg": "lib/internal/crypto/cfrg.js",
    "internal/crypto/kem_hybrids": "lib/internal/crypto/kem_hybrids.js",
    "internal/crypto/webidl": "lib/internal/crypto/webidl.js",
    "internal/crypto/webcrypto": "lib/internal/crypto/webcrypto.js",
    "internal/crypto/rsa": "lib/internal/crypto/rsa.js",
    "internal/crypto/sig": "lib/internal/crypto/sig.js",
    "internal/crypto/keygen": "lib/internal/crypto/keygen.js",
    "internal/crypto/argon2": "lib/internal/crypto/argon2.js",
    "internal/http": "lib/internal/http.js",
    "internal/assert/utils": "lib/internal/assert/utils.js",
    "internal/assert/assertion_error": "lib/internal/assert/assertion_error.js",
    "internal/assert/myers_diff": "lib/internal/assert/myers_diff.js",
    "internal/promise_hooks": "lib/internal/promise_hooks.js",
    "internal/vfs/router": "lib/internal/vfs/router.js",
    "internal/vfs/streams": "lib/internal/vfs/streams.js",
    "internal/vfs/provider": "lib/internal/vfs/provider.js",
    "internal/vfs/providers/memory": "lib/internal/vfs/providers/memory.js",
    "internal/vfs/providers/real": "lib/internal/vfs/providers/real.js",
    "internal/vfs/providers/ziparchive": "lib/internal/vfs/providers/ziparchive.js",
    "internal/vfs/providers/composable": "lib/internal/vfs/providers/composable.js",
    "internal/vfs/providers/sea": "lib/internal/vfs/providers/sea.js",
    "internal/vfs/dir": "lib/internal/vfs/dir.js",
    "internal/vfs/file_system": "lib/internal/vfs/file_system.js",
    "internal/vfs/fd": "lib/internal/vfs/fd.js",
    "internal/vfs/stats": "lib/internal/vfs/stats.js",
    "internal/vfs/setup": "lib/internal/vfs/setup.js",
    "internal/vfs/file_handle": "lib/internal/vfs/file_handle.js",
    "internal/vfs/watcher": "lib/internal/vfs/watcher.js",
    "internal/vfs/sea": "lib/internal/vfs/sea.js",
    "internal/vfs/provider_registry": "lib/internal/vfs/provider_registry.js",
    "internal/vfs/errors": "lib/internal/vfs/errors.js",
    "internal/vfs/root": "lib/internal/vfs/root.js",
    "internal/v8_prof_polyfill": "lib/internal/v8_prof_polyfill.js",
    "internal/heap_utils": "lib/internal/heap_utils.js",
    "internal/js_stream_socket": "lib/internal/js_stream_socket.js",
    "internal/console/global": "lib/internal/console/global.js",
    "internal/console/constructor": "lib/internal/console/constructor.js",
    "internal/child_process/serialization": "lib/internal/child_process/serialization.js",
    "internal/async_hooks": "lib/internal/async_hooks.js",
    "internal/repl/utils": "lib/internal/repl/utils.js",
    "internal/repl/await": "lib/internal/repl/await.js",
    "internal/repl/highlight": "lib/internal/repl/highlight.js",
    "internal/repl/completion": "lib/internal/repl/completion.js",
    "internal/repl/history": "lib/internal/repl/history.js",
    "internal/querystring": "lib/internal/querystring.js",
    "internal/fixed_queue": "lib/internal/fixed_queue.js",
    "internal/cluster/primary": "lib/internal/cluster/primary.js",
    "internal/cluster/round_robin_handle": "lib/internal/cluster/round_robin_handle.js",
    "internal/cluster/shared_handle": "lib/internal/cluster/shared_handle.js",
    "internal/cluster/utils": "lib/internal/cluster/utils.js",
    "internal/cluster/child": "lib/internal/cluster/child.js",
    "internal/cluster/worker": "lib/internal/cluster/worker.js",
    "internal/streams/operators": "lib/internal/streams/operators.js",
    "internal/streams/duplexpair": "lib/internal/streams/duplexpair.js",
    "internal/streams/legacy": "lib/internal/streams/legacy.js",
    "internal/streams/from": "lib/internal/streams/from.js",
    "internal/streams/writable": "lib/internal/streams/writable.js",
    "internal/streams/destroy": "lib/internal/streams/destroy.js",
    "internal/streams/transform": "lib/internal/streams/transform.js",
    "internal/streams/end-of-stream": "lib/internal/streams/end-of-stream.js",
    "internal/streams/compose": "lib/internal/streams/compose.js",
    "internal/streams/readable": "lib/internal/streams/readable.js",
    "internal/streams/utils": "lib/internal/streams/utils.js",
    "internal/streams/state": "lib/internal/streams/state.js",
    "internal/streams/pipeline": "lib/internal/streams/pipeline.js",
    "internal/streams/fast-utf8-stream": "lib/internal/streams/fast-utf8-stream.js",
    "internal/streams/lazy_transform": "lib/internal/streams/lazy_transform.js",
    "internal/streams/duplexify": "lib/internal/streams/duplexify.js",
    "internal/streams/passthrough": "lib/internal/streams/passthrough.js",
    "internal/streams/duplex": "lib/internal/streams/duplex.js",
    "internal/streams/iter/push": "lib/internal/streams/iter/push.js",
    "internal/streams/iter/types": "lib/internal/streams/iter/types.js",
    "internal/streams/iter/from": "lib/internal/streams/iter/from.js",
    "internal/streams/iter/consumers": "lib/internal/streams/iter/consumers.js",
    "internal/streams/iter/transform": "lib/internal/streams/iter/transform.js",
    "internal/streams/iter/pull": "lib/internal/streams/iter/pull.js",
    "internal/streams/iter/ringbuffer": "lib/internal/streams/iter/ringbuffer.js",
    "internal/streams/iter/share": "lib/internal/streams/iter/share.js",
    "internal/streams/iter/utils": "lib/internal/streams/iter/utils.js",
    "internal/streams/iter/classic": "lib/internal/streams/iter/classic.js",
    "internal/streams/iter/broadcast": "lib/internal/streams/iter/broadcast.js",
    "internal/streams/iter/duplex": "lib/internal/streams/iter/duplex.js",
    "internal/streams/iter/webidl": "lib/internal/streams/iter/webidl.js",
    "internal/streams/add-abort-signal": "lib/internal/streams/add-abort-signal.js",
    "internal/constants": "lib/internal/constants.js",
    "internal/trace_events_async_hooks": "lib/internal/trace_events_async_hooks.js",
    "internal/net": "lib/internal/net.js",
    "internal/per_context/domexception": "lib/internal/per_context/domexception.js",
    "internal/per_context/messageport": "lib/internal/per_context/messageport.js",
    "internal/per_context/primordials": "lib/internal/per_context/primordials.js",
    "internal/debugger/inspect_client": "lib/internal/debugger/inspect_client.js",
    "internal/debugger/inspect_helpers": "lib/internal/debugger/inspect_helpers.js",
    "internal/debugger/inspect_probe": "lib/internal/debugger/inspect_probe.js",
    "internal/debugger/inspect": "lib/internal/debugger/inspect.js",
    "internal/debugger/inspect_repl": "lib/internal/debugger/inspect_repl.js",
    "internal/freelist": "lib/internal/freelist.js",
    "internal/error_serdes": "lib/internal/error_serdes.js",
    "internal/readline/emitKeypressEvents": "lib/internal/readline/emitKeypressEvents.js",
    "internal/readline/utils": "lib/internal/readline/utils.js",
    "internal/readline/promises": "lib/internal/readline/promises.js",
    "internal/readline/interface": "lib/internal/readline/interface.js",
    "internal/readline/callbacks": "lib/internal/readline/callbacks.js",
    "internal/webworker": "lib/internal/webworker.js",
    "internal/timers": "lib/internal/timers.js",
    "internal/zip/extra-fields": "lib/internal/zip/extra-fields.js",
    "internal/zip/archive": "lib/internal/zip/archive.js",
    "internal/zip/headers": "lib/internal/zip/headers.js",
    "internal/zip/constants": "lib/internal/zip/constants.js",
    "internal/zip/binary": "lib/internal/zip/binary.js",
    "internal/zip/compression": "lib/internal/zip/compression.js",
    "internal/zip/dos": "lib/internal/zip/dos.js",
    "internal/zip/entry": "lib/internal/zip/entry.js",
    "internal/zip/buffer": "lib/internal/zip/buffer.js",
    "internal/zip/header-builders": "lib/internal/zip/header-builders.js",
    "internal/zip/content-size": "lib/internal/zip/content-size.js",
    "internal/zip/fs-util": "lib/internal/zip/fs-util.js",
    "internal/zip/file": "lib/internal/zip/file.js",
    "internal/stream_base_commons": "lib/internal/stream_base_commons.js",
    "internal/inspector_async_hook": "lib/internal/inspector_async_hook.js",
    "internal/locks": "lib/internal/locks.js",
    "internal/inspector_network_tracking": "lib/internal/inspector_network_tracking.js",
    "internal/blob": "lib/internal/blob.js",
    "internal/bench_runner/benchmarks_stream": "lib/internal/bench_runner/benchmarks_stream.js",
    "internal/bench_runner/cli": "lib/internal/bench_runner/cli.js",
    "internal/bench_runner/harness": "lib/internal/bench_runner/harness.js",
    "internal/bench_runner/benchmark": "lib/internal/bench_runner/benchmark.js",
    "internal/bench_runner/reporter/spec": "lib/internal/bench_runner/reporter/spec.js",
    "internal/bench_runner/reporter/json": "lib/internal/bench_runner/reporter/json.js",
    "internal/bench_runner/runner": "lib/internal/bench_runner/runner.js",
    "internal/perf/usertiming": "lib/internal/perf/usertiming.js",
    "internal/perf/resource_timing": "lib/internal/perf/resource_timing.js",
    "internal/perf/observe": "lib/internal/perf/observe.js",
    "internal/perf/event_loop_delay": "lib/internal/perf/event_loop_delay.js",
    "internal/perf/utils": "lib/internal/perf/utils.js",
    "internal/perf/performance": "lib/internal/perf/performance.js",
    "internal/perf/performance_entry": "lib/internal/perf/performance_entry.js",
    "internal/perf/timerify": "lib/internal/perf/timerify.js",
    "internal/perf/event_loop_utilization": "lib/internal/perf/event_loop_utilization.js",
    "internal/perf/nodetiming": "lib/internal/perf/nodetiming.js",
    "internal/modules/esm/resolve": "lib/internal/modules/esm/resolve.js",
    "internal/modules/esm/module_map": "lib/internal/modules/esm/module_map.js",
    "internal/modules/esm/translators": "lib/internal/modules/esm/translators.js",
    "internal/modules/esm/load": "lib/internal/modules/esm/load.js",
    "internal/modules/esm/utils": "lib/internal/modules/esm/utils.js",
    "internal/modules/esm/create_dynamic_module": "lib/internal/modules/esm/create_dynamic_module.js",
    "internal/modules/esm/assert": "lib/internal/modules/esm/assert.js",
    "internal/modules/esm/loader": "lib/internal/modules/esm/loader.js",
    "internal/modules/esm/hooks": "lib/internal/modules/esm/hooks.js",
    "internal/modules/esm/get_format": "lib/internal/modules/esm/get_format.js",
    "internal/modules/esm/worker": "lib/internal/modules/esm/worker.js",
    "internal/modules/esm/shared_constants": "lib/internal/modules/esm/shared_constants.js",
    "internal/modules/esm/module_job": "lib/internal/modules/esm/module_job.js",
    "internal/modules/helpers": "lib/internal/modules/helpers.js",
    "internal/modules/package_map": "lib/internal/modules/package_map.js",
    "internal/modules/cjs/loader": "lib/internal/modules/cjs/loader.js",
    "internal/modules/run_main": "lib/internal/modules/run_main.js",
    "internal/modules/typescript": "lib/internal/modules/typescript.js",
    "internal/modules/customization_hooks": "lib/internal/modules/customization_hooks.js",
    "internal/modules/package_json_reader": "lib/internal/modules/package_json_reader.js",
    "internal/http2/compat": "lib/internal/http2/compat.js",
    "internal/http2/util": "lib/internal/http2/util.js",
    "internal/http2/core": "lib/internal/http2/core.js",
    "internal/watch_mode/files_watcher": "lib/internal/watch_mode/files_watcher.js",
    "internal/event_target": "lib/internal/event_target.js",
    "internal/options": "lib/internal/options.js",
    "internal/util/colors": "lib/internal/util/colors.js",
    "internal/util/types": "lib/internal/util/types.js",
    "internal/util/debounce": "lib/internal/util/debounce.js",
    "internal/util/trace_sigint": "lib/internal/util/trace_sigint.js",
    "internal/util/diff": "lib/internal/util/diff.js",
    "internal/util/throttle": "lib/internal/util/throttle.js",
    "internal/util/comparisons": "lib/internal/util/comparisons.js",
    "internal/util/inspector": "lib/internal/util/inspector.js",
    "internal/util/parse_args/utils": "lib/internal/util/parse_args/utils.js",
    "internal/util/parse_args/parse_args": "lib/internal/util/parse_args/parse_args.js",
    "internal/util/debuglog": "lib/internal/util/debuglog.js",
    "internal/util/inspect": "lib/internal/util/inspect.js",
    "internal/socketaddress": "lib/internal/socketaddress.js",
    "internal/quic/diagnostics": "lib/internal/quic/diagnostics.js",
    "internal/quic/stats": "lib/internal/quic/stats.js",
    "internal/quic/state": "lib/internal/quic/state.js",
    "internal/quic/symbols": "lib/internal/quic/symbols.js",
    "internal/quic/quic": "lib/internal/quic/quic.js",
    "internal/inspector/network_undici": "lib/internal/inspector/network_undici.js",
    "internal/inspector/network_http": "lib/internal/inspector/network_http.js",
    "internal/inspector/network_resources": "lib/internal/inspector/network_resources.js",
    "internal/inspector/network": "lib/internal/inspector/network.js",
    "internal/inspector/webstorage": "lib/internal/inspector/webstorage.js",
    "internal/inspector/network_http2": "lib/internal/inspector/network_http2.js",
    "internal/async_local_storage/async_hooks": "lib/internal/async_local_storage/async_hooks.js",
    "internal/async_local_storage/async_context_frame": "lib/internal/async_local_storage/async_context_frame.js",
    "internal/async_local_storage/run_scope": "lib/internal/async_local_storage/run_scope.js",
    "internal/histogram": "lib/internal/histogram.js",
    "internal/dgram": "lib/internal/dgram.js",
    "internal/assert": "lib/internal/assert.js",
    "internal/async_context_frame": "lib/internal/async_context_frame.js",
    "internal/buffer": "lib/internal/buffer.js",
    "internal/test/transfer": "lib/internal/test/transfer.js",
    "internal/test/binding": "lib/internal/test/binding.js",
    "internal/legacy/processbinding": "lib/internal/legacy/processbinding.js",
    "internal/events/symbols": "lib/internal/events/symbols.js",
    "internal/events/abort_listener": "lib/internal/events/abort_listener.js",
    "internal/linkedlist": "lib/internal/linkedlist.js",
    "internal/test_runner/harness": "lib/internal/test_runner/harness.js",
    "internal/test_runner/coverage": "lib/internal/test_runner/coverage.js",
    "internal/test_runner/test": "lib/internal/test_runner/test.js",
    "internal/test_runner/reporter/tap": "lib/internal/test_runner/reporter/tap.js",
    "internal/test_runner/reporter/spec": "lib/internal/test_runner/reporter/spec.js",
    "internal/test_runner/reporter/dot": "lib/internal/test_runner/reporter/dot.js",
    "internal/test_runner/reporter/rerun": "lib/internal/test_runner/reporter/rerun.js",
    "internal/test_runner/reporter/lcov": "lib/internal/test_runner/reporter/lcov.js",
    "internal/test_runner/reporter/v8-serializer": "lib/internal/test_runner/reporter/v8-serializer.js",
    "internal/test_runner/reporter/utils": "lib/internal/test_runner/reporter/utils.js",
    "internal/test_runner/reporter/junit": "lib/internal/test_runner/reporter/junit.js",
    "internal/test_runner/mock/mock_timers": "lib/internal/test_runner/mock/mock_timers.js",
    "internal/test_runner/mock/loader": "lib/internal/test_runner/mock/loader.js",
    "internal/test_runner/mock/mock": "lib/internal/test_runner/mock/mock.js",
    "internal/test_runner/utils": "lib/internal/test_runner/utils.js",
    "internal/test_runner/assert": "lib/internal/test_runner/assert.js",
    "internal/test_runner/snapshot": "lib/internal/test_runner/snapshot.js",
    "internal/test_runner/tests_stream": "lib/internal/test_runner/tests_stream.js",
    "internal/test_runner/tag_filter": "lib/internal/test_runner/tag_filter.js",
    "internal/test_runner/runner": "lib/internal/test_runner/runner.js",
    "internal/zip": "lib/internal/zip.js",
    "internal/ffi-shared-buffer": "lib/internal/ffi-shared-buffer.js",
    "internal/bootstrap/node": "lib/internal/bootstrap/node.js",
    "internal/bootstrap/realm": "lib/internal/bootstrap/realm.js",
    "internal/bootstrap/web/exposed-window-or-worker": "lib/internal/bootstrap/web/exposed-window-or-worker.js",
    "internal/bootstrap/web/exposed-wildcard": "lib/internal/bootstrap/web/exposed-wildcard.js",
    "internal/bootstrap/switches/does_own_process_state": "lib/internal/bootstrap/switches/does_own_process_state.js",
    "internal/bootstrap/switches/does_not_own_process_state": "lib/internal/bootstrap/switches/does_not_own_process_state.js",
    "internal/bootstrap/switches/is_main_thread": "lib/internal/bootstrap/switches/is_main_thread.js",
    "internal/bootstrap/switches/is_not_main_thread": "lib/internal/bootstrap/switches/is_not_main_thread.js",
    "internal/bootstrap/shadow_realm": "lib/internal/bootstrap/shadow_realm.js",
    "internal/webstreams/adapters": "lib/internal/webstreams/adapters.js",
    "internal/webstreams/util": "lib/internal/webstreams/util.js",
    "internal/webstreams/transformstream": "lib/internal/webstreams/transformstream.js",
    "internal/webstreams/transfer": "lib/internal/webstreams/transfer.js",
    "internal/webstreams/queuingstrategies": "lib/internal/webstreams/queuingstrategies.js",
    "internal/webstreams/compression": "lib/internal/webstreams/compression.js",
    "internal/webstreams/readablestream": "lib/internal/webstreams/readablestream.js",
    "internal/webstreams/writablestream": "lib/internal/webstreams/writablestream.js",
    "internal/webstreams/encoding": "lib/internal/webstreams/encoding.js",
    "internal/process/execution": "lib/internal/process/execution.js",
    "internal/process/finalization": "lib/internal/process/finalization.js",
    "internal/process/warning": "lib/internal/process/warning.js",
    "internal/process/pre_execution": "lib/internal/process/pre_execution.js",
    "internal/process/report": "lib/internal/process/report.js",
    "internal/process/per_thread": "lib/internal/process/per_thread.js",
    "internal/process/worker_thread_only": "lib/internal/process/worker_thread_only.js",
    "internal/process/promises": "lib/internal/process/promises.js",
    "internal/process/permission": "lib/internal/process/permission.js",
    "internal/process/task_queues": "lib/internal/process/task_queues.js",
    "internal/process/signal": "lib/internal/process/signal.js",
    "internal/freeze_intrinsics": "lib/internal/freeze_intrinsics.js",
    "internal/v8/heap_profile": "lib/internal/v8/heap_profile.js",
    "internal/v8/startup_snapshot": "lib/internal/v8/startup_snapshot.js",
    "internal/v8/cpu_profiler": "lib/internal/v8/cpu_profiler.js",
    "internal/webstorage": "lib/internal/webstorage.js",
    "internal/child_process": "lib/internal/child_process.js",
    "internal/cli_table": "lib/internal/cli_table.js",
    "internal/tls/wrap": "lib/internal/tls/wrap.js",
    "internal/tls/secure-context": "lib/internal/tls/secure-context.js",
    "internal/tls/common": "lib/internal/tls/common.js",
    "internal/data_url": "lib/internal/data_url.js",
    "internal/repl": "lib/internal/repl.js",
    "internal/ffi/fast-api": "lib/internal/ffi/fast-api.js",
    "internal/ffi/vfs": "lib/internal/ffi/vfs.js",
    "internal/tty": "lib/internal/tty.js",
    "internal/main/embedding": "lib/internal/main/embedding.js",
    "internal/main/eval_string": "lib/internal/main/eval_string.js",
    "internal/main/test_runner": "lib/internal/main/test_runner.js",
    "internal/main/run_main_module": "lib/internal/main/run_main_module.js",
    "internal/main/eval_stdin": "lib/internal/main/eval_stdin.js",
    "internal/main/check_syntax": "lib/internal/main/check_syntax.js",
    "internal/main/print_help": "lib/internal/main/print_help.js",
    "internal/main/worker_thread": "lib/internal/main/worker_thread.js",
    "internal/main/mksnapshot": "lib/internal/main/mksnapshot.js",
    "internal/main/bench_runner": "lib/internal/main/bench_runner.js",
    "internal/main/repl": "lib/internal/main/repl.js",
    "internal/main/prof_process": "lib/internal/main/prof_process.js",
    "internal/main/inspect": "lib/internal/main/inspect.js",
    "internal/main/watch_mode": "lib/internal/main/watch_mode.js",
    "internal/webidl": "lib/internal/webidl.js",
    "internal/file": "lib/internal/file.js",
    "internal/worker": "lib/internal/worker.js",
    "internal/errors": "lib/internal/errors.js",
    "internal/blocklist": "lib/internal/blocklist.js",
    "internal/mime": "lib/internal/mime.js",
    "internal/source_map/prepare_stack_trace": "lib/internal/source_map/prepare_stack_trace.js",
    "internal/source_map/source_map_cache_map": "lib/internal/source_map/source_map_cache_map.js",
    "internal/source_map/source_map": "lib/internal/source_map/source_map.js",
    "internal/source_map/source_map_cache": "lib/internal/source_map/source_map_cache.js",
    "internal/encoding": "lib/internal/encoding.js",
    "internal/vm": "lib/internal/vm.js",
    "internal/fs/streams": "lib/internal/fs/streams.js",
    "internal/fs/watchers": "lib/internal/fs/watchers.js",
    "internal/fs/rimraf": "lib/internal/fs/rimraf.js",
    "internal/fs/read/context": "lib/internal/fs/read/context.js",
    "internal/fs/dir": "lib/internal/fs/dir.js",
    "internal/fs/utils": "lib/internal/fs/utils.js",
    "internal/fs/promises": "lib/internal/fs/promises.js",
    "internal/fs/sync_write_stream": "lib/internal/fs/sync_write_stream.js",
    "internal/fs/recursive_watch": "lib/internal/fs/recursive_watch.js",
    "internal/fs/glob": "lib/internal/fs/glob.js",
    "internal/fs/cp/cp-sync": "lib/internal/fs/cp/cp-sync.js",
    "internal/fs/cp/cp": "lib/internal/fs/cp/cp.js",
    constants: "lib/constants.js",
    net: "lib/net.js",
    _http_incoming: "lib/_http_incoming.js",
    "readline/promises": "lib/readline/promises.js",
    diagnostics_channel: "lib/diagnostics_channel.js",
    wasi: "lib/wasi.js",
    timers: "lib/timers.js",
    test: "lib/test.js",
    crypto: "lib/crypto.js",
    sqlite: "lib/sqlite.js",
    zlib: "lib/zlib.js",
    "path/posix": "lib/path/posix.js",
    "path/win32": "lib/path/win32.js",
    console: "lib/console.js",
    "util/types": "lib/util/types.js",
    _http_agent: "lib/_http_agent.js",
    stream: "lib/stream.js",
    "inspector/promises": "lib/inspector/promises.js",
    _http_outgoing: "lib/_http_outgoing.js",
    fs: "lib/fs.js",
    os: "lib/os.js",
    ffi: "lib/ffi.js",
    vfs: "lib/vfs.js",
    v8: "lib/v8.js",
    dgram: "lib/dgram.js",
    assert: "lib/assert.js",
    buffer: "lib/buffer.js",
    _http_client: "lib/_http_client.js",
    inspector: "lib/inspector.js",
    "test/reporters": "lib/test/reporters.js",
    worker_threads: "lib/worker_threads.js",
    "timers/promises": "lib/timers/promises.js",
    sea: "lib/sea.js",
    "stream/consumers": "lib/stream/consumers.js",
    "stream/promises": "lib/stream/promises.js",
    "stream/web": "lib/stream/web.js",
    "stream/iter": "lib/stream/iter.js",
    string_decoder: "lib/string_decoder.js",
    http2: "lib/http2.js",
    child_process: "lib/child_process.js",
    _tls_wrap: "lib/_tls_wrap.js",
    repl: "lib/repl.js",
    events: "lib/events.js",
    "bench/reporters": "lib/bench/reporters.js",
    path: "lib/path.js",
    tty: "lib/tty.js",
    bench: "lib/bench.js",
    quic: "lib/quic.js",
    _http_server: "lib/_http_server.js",
    vm: "lib/vm.js",
    "fs/promises": "lib/fs/promises.js",
    cluster: "lib/cluster.js",
    domain: "lib/domain.js",
    "internal/deps/acorn/acorn/dist/acorn": "acorn/acorn/dist/acorn.js",
    "internal/deps/acorn/acorn-walk/dist/walk": "acorn/acorn-walk/dist/walk.js",
    "internal/deps/amaro/dist/index": "amaro/dist/index.js",
    "internal/deps/minimatch/index": "minimatch/index.js"
  },
  files: [
    "acorn/acorn-walk/dist/walk.js",
    "acorn/acorn-walk/package.json",
    "acorn/acorn/dist/acorn.js",
    "acorn/acorn/dist/bin.js",
    "acorn/acorn/package.json",
    "amaro/dist/errors.js",
    "amaro/dist/index.js",
    "amaro/dist/package.json",
    "amaro/dist/strip-loader.js",
    "amaro/dist/transform-loader.js",
    "amaro/package.json",
    "lib/_http_agent.js",
    "lib/_http_client.js",
    "lib/_http_common.js",
    "lib/_http_incoming.js",
    "lib/_http_outgoing.js",
    "lib/_http_server.js",
    "lib/_tls_common.js",
    "lib/_tls_wrap.js",
    "lib/assert.js",
    "lib/assert/strict.js",
    "lib/async_hooks.js",
    "lib/bench.js",
    "lib/bench/reporters.js",
    "lib/buffer.js",
    "lib/child_process.js",
    "lib/cluster.js",
    "lib/console.js",
    "lib/constants.js",
    "lib/crypto.js",
    "lib/dgram.js",
    "lib/diagnostics_channel.js",
    "lib/dns.js",
    "lib/dns/promises.js",
    "lib/domain.js",
    "lib/dtls.js",
    "lib/events.js",
    "lib/ffi.js",
    "lib/fs.js",
    "lib/fs/promises.js",
    "lib/http.js",
    "lib/http2.js",
    "lib/https.js",
    "lib/inspector.js",
    "lib/inspector/promises.js",
    "lib/internal/abort_controller.js",
    "lib/internal/assert.js",
    "lib/internal/assert/assertion_error.js",
    "lib/internal/assert/myers_diff.js",
    "lib/internal/assert/utils.js",
    "lib/internal/async_context_frame.js",
    "lib/internal/async_hooks.js",
    "lib/internal/async_local_storage/async_context_frame.js",
    "lib/internal/async_local_storage/async_hooks.js",
    "lib/internal/async_local_storage/run_scope.js",
    "lib/internal/bench_runner/benchmark.js",
    "lib/internal/bench_runner/benchmarks_stream.js",
    "lib/internal/bench_runner/cli.js",
    "lib/internal/bench_runner/harness.js",
    "lib/internal/bench_runner/reporter/json.js",
    "lib/internal/bench_runner/reporter/spec.js",
    "lib/internal/bench_runner/runner.js",
    "lib/internal/blob.js",
    "lib/internal/blocklist.js",
    "lib/internal/bootstrap/node.js",
    "lib/internal/bootstrap/realm.js",
    "lib/internal/bootstrap/shadow_realm.js",
    "lib/internal/bootstrap/switches/does_not_own_process_state.js",
    "lib/internal/bootstrap/switches/does_own_process_state.js",
    "lib/internal/bootstrap/switches/is_main_thread.js",
    "lib/internal/bootstrap/switches/is_not_main_thread.js",
    "lib/internal/bootstrap/web/exposed-wildcard.js",
    "lib/internal/bootstrap/web/exposed-window-or-worker.js",
    "lib/internal/buffer.js",
    "lib/internal/child_process.js",
    "lib/internal/child_process/serialization.js",
    "lib/internal/cli_table.js",
    "lib/internal/cluster/child.js",
    "lib/internal/cluster/primary.js",
    "lib/internal/cluster/round_robin_handle.js",
    "lib/internal/cluster/shared_handle.js",
    "lib/internal/cluster/utils.js",
    "lib/internal/cluster/worker.js",
    "lib/internal/console/constructor.js",
    "lib/internal/console/global.js",
    "lib/internal/constants.js",
    "lib/internal/crypto/aes.js",
    "lib/internal/crypto/argon2.js",
    "lib/internal/crypto/certificate.js",
    "lib/internal/crypto/cfrg.js",
    "lib/internal/crypto/chacha20_poly1305.js",
    "lib/internal/crypto/cipher.js",
    "lib/internal/crypto/diffiehellman.js",
    "lib/internal/crypto/ec.js",
    "lib/internal/crypto/hash.js",
    "lib/internal/crypto/hashnames.js",
    "lib/internal/crypto/hkdf.js",
    "lib/internal/crypto/kem.js",
    "lib/internal/crypto/kem_hybrids.js",
    "lib/internal/crypto/keygen.js",
    "lib/internal/crypto/keys.js",
    "lib/internal/crypto/mac.js",
    "lib/internal/crypto/ml_dsa.js",
    "lib/internal/crypto/ml_kem.js",
    "lib/internal/crypto/pbkdf2.js",
    "lib/internal/crypto/provider_mac.js",
    "lib/internal/crypto/random.js",
    "lib/internal/crypto/rsa.js",
    "lib/internal/crypto/scrypt.js",
    "lib/internal/crypto/sig.js",
    "lib/internal/crypto/util.js",
    "lib/internal/crypto/webcrypto.js",
    "lib/internal/crypto/webcrypto_util.js",
    "lib/internal/crypto/webidl.js",
    "lib/internal/crypto/x509.js",
    "lib/internal/data_url.js",
    "lib/internal/debugger/inspect.js",
    "lib/internal/debugger/inspect_client.js",
    "lib/internal/debugger/inspect_helpers.js",
    "lib/internal/debugger/inspect_probe.js",
    "lib/internal/debugger/inspect_repl.js",
    "lib/internal/dgram.js",
    "lib/internal/dns/callback_resolver.js",
    "lib/internal/dns/promises.js",
    "lib/internal/dns/utils.js",
    "lib/internal/dtls/dtls.js",
    "lib/internal/dtls/state.js",
    "lib/internal/dtls/stats.js",
    "lib/internal/dtls/symbols.js",
    "lib/internal/encoding.js",
    "lib/internal/encoding/single-byte.js",
    "lib/internal/encoding/util.js",
    "lib/internal/error_serdes.js",
    "lib/internal/errors.js",
    "lib/internal/errors/error_source.js",
    "lib/internal/event_target.js",
    "lib/internal/events/abort_listener.js",
    "lib/internal/events/symbols.js",
    "lib/internal/ffi-shared-buffer.js",
    "lib/internal/ffi/fast-api.js",
    "lib/internal/ffi/vfs.js",
    "lib/internal/file.js",
    "lib/internal/fixed_queue.js",
    "lib/internal/freelist.js",
    "lib/internal/freeze_intrinsics.js",
    "lib/internal/fs/cp/cp-sync.js",
    "lib/internal/fs/cp/cp.js",
    "lib/internal/fs/dir.js",
    "lib/internal/fs/glob.js",
    "lib/internal/fs/promises.js",
    "lib/internal/fs/read/context.js",
    "lib/internal/fs/recursive_watch.js",
    "lib/internal/fs/rimraf.js",
    "lib/internal/fs/streams.js",
    "lib/internal/fs/sync_write_stream.js",
    "lib/internal/fs/utils.js",
    "lib/internal/fs/watchers.js",
    "lib/internal/heap_utils.js",
    "lib/internal/histogram.js",
    "lib/internal/http.js",
    "lib/internal/http2/compat.js",
    "lib/internal/http2/core.js",
    "lib/internal/http2/util.js",
    "lib/internal/inspector/network.js",
    "lib/internal/inspector/network_http.js",
    "lib/internal/inspector/network_http2.js",
    "lib/internal/inspector/network_resources.js",
    "lib/internal/inspector/network_undici.js",
    "lib/internal/inspector/webstorage.js",
    "lib/internal/inspector_async_hook.js",
    "lib/internal/inspector_network_tracking.js",
    "lib/internal/js_stream_socket.js",
    "lib/internal/legacy/processbinding.js",
    "lib/internal/linkedlist.js",
    "lib/internal/locks.js",
    "lib/internal/main/bench_runner.js",
    "lib/internal/main/check_syntax.js",
    "lib/internal/main/embedding.js",
    "lib/internal/main/eval_stdin.js",
    "lib/internal/main/eval_string.js",
    "lib/internal/main/inspect.js",
    "lib/internal/main/mksnapshot.js",
    "lib/internal/main/print_help.js",
    "lib/internal/main/prof_process.js",
    "lib/internal/main/repl.js",
    "lib/internal/main/run_main_module.js",
    "lib/internal/main/test_runner.js",
    "lib/internal/main/watch_mode.js",
    "lib/internal/main/worker_thread.js",
    "lib/internal/mime.js",
    "lib/internal/modules/cjs/loader.js",
    "lib/internal/modules/customization_hooks.js",
    "lib/internal/modules/esm/assert.js",
    "lib/internal/modules/esm/create_dynamic_module.js",
    "lib/internal/modules/esm/get_format.js",
    "lib/internal/modules/esm/hooks.js",
    "lib/internal/modules/esm/load.js",
    "lib/internal/modules/esm/loader.js",
    "lib/internal/modules/esm/module_job.js",
    "lib/internal/modules/esm/module_map.js",
    "lib/internal/modules/esm/resolve.js",
    "lib/internal/modules/esm/shared_constants.js",
    "lib/internal/modules/esm/translators.js",
    "lib/internal/modules/esm/utils.js",
    "lib/internal/modules/esm/worker.js",
    "lib/internal/modules/helpers.js",
    "lib/internal/modules/package_json_reader.js",
    "lib/internal/modules/package_map.js",
    "lib/internal/modules/run_main.js",
    "lib/internal/modules/typescript.js",
    "lib/internal/navigator.js",
    "lib/internal/net.js",
    "lib/internal/options.js",
    "lib/internal/per_context/domexception.js",
    "lib/internal/per_context/messageport.js",
    "lib/internal/per_context/primordials.js",
    "lib/internal/perf/event_loop_delay.js",
    "lib/internal/perf/event_loop_utilization.js",
    "lib/internal/perf/nodetiming.js",
    "lib/internal/perf/observe.js",
    "lib/internal/perf/performance.js",
    "lib/internal/perf/performance_entry.js",
    "lib/internal/perf/resource_timing.js",
    "lib/internal/perf/timerify.js",
    "lib/internal/perf/usertiming.js",
    "lib/internal/perf/utils.js",
    "lib/internal/priority_queue.js",
    "lib/internal/process/execution.js",
    "lib/internal/process/finalization.js",
    "lib/internal/process/per_thread.js",
    "lib/internal/process/permission.js",
    "lib/internal/process/pre_execution.js",
    "lib/internal/process/promises.js",
    "lib/internal/process/report.js",
    "lib/internal/process/signal.js",
    "lib/internal/process/task_queues.js",
    "lib/internal/process/warning.js",
    "lib/internal/process/worker_thread_only.js",
    "lib/internal/promise_hooks.js",
    "lib/internal/querystring.js",
    "lib/internal/quic/diagnostics.js",
    "lib/internal/quic/quic.js",
    "lib/internal/quic/state.js",
    "lib/internal/quic/stats.js",
    "lib/internal/quic/symbols.js",
    "lib/internal/readline/callbacks.js",
    "lib/internal/readline/emitKeypressEvents.js",
    "lib/internal/readline/interface.js",
    "lib/internal/readline/promises.js",
    "lib/internal/readline/utils.js",
    "lib/internal/repl.js",
    "lib/internal/repl/await.js",
    "lib/internal/repl/completion.js",
    "lib/internal/repl/highlight.js",
    "lib/internal/repl/history.js",
    "lib/internal/repl/utils.js",
    "lib/internal/socket_list.js",
    "lib/internal/socketaddress.js",
    "lib/internal/source_map/prepare_stack_trace.js",
    "lib/internal/source_map/source_map.js",
    "lib/internal/source_map/source_map_cache.js",
    "lib/internal/source_map/source_map_cache_map.js",
    "lib/internal/stream_base_commons.js",
    "lib/internal/streams/add-abort-signal.js",
    "lib/internal/streams/compose.js",
    "lib/internal/streams/destroy.js",
    "lib/internal/streams/duplex.js",
    "lib/internal/streams/duplexify.js",
    "lib/internal/streams/duplexpair.js",
    "lib/internal/streams/end-of-stream.js",
    "lib/internal/streams/fast-utf8-stream.js",
    "lib/internal/streams/from.js",
    "lib/internal/streams/iter/broadcast.js",
    "lib/internal/streams/iter/classic.js",
    "lib/internal/streams/iter/consumers.js",
    "lib/internal/streams/iter/duplex.js",
    "lib/internal/streams/iter/from.js",
    "lib/internal/streams/iter/pull.js",
    "lib/internal/streams/iter/push.js",
    "lib/internal/streams/iter/ringbuffer.js",
    "lib/internal/streams/iter/share.js",
    "lib/internal/streams/iter/transform.js",
    "lib/internal/streams/iter/types.js",
    "lib/internal/streams/iter/utils.js",
    "lib/internal/streams/iter/webidl.js",
    "lib/internal/streams/lazy_transform.js",
    "lib/internal/streams/legacy.js",
    "lib/internal/streams/operators.js",
    "lib/internal/streams/passthrough.js",
    "lib/internal/streams/pipeline.js",
    "lib/internal/streams/readable.js",
    "lib/internal/streams/state.js",
    "lib/internal/streams/transform.js",
    "lib/internal/streams/utils.js",
    "lib/internal/streams/writable.js",
    "lib/internal/test_runner/assert.js",
    "lib/internal/test_runner/coverage.js",
    "lib/internal/test_runner/harness.js",
    "lib/internal/test_runner/mock/loader.js",
    "lib/internal/test_runner/mock/mock.js",
    "lib/internal/test_runner/mock/mock_timers.js",
    "lib/internal/test_runner/reporter/dot.js",
    "lib/internal/test_runner/reporter/junit.js",
    "lib/internal/test_runner/reporter/lcov.js",
    "lib/internal/test_runner/reporter/rerun.js",
    "lib/internal/test_runner/reporter/spec.js",
    "lib/internal/test_runner/reporter/tap.js",
    "lib/internal/test_runner/reporter/utils.js",
    "lib/internal/test_runner/reporter/v8-serializer.js",
    "lib/internal/test_runner/runner.js",
    "lib/internal/test_runner/snapshot.js",
    "lib/internal/test_runner/tag_filter.js",
    "lib/internal/test_runner/test.js",
    "lib/internal/test_runner/tests_stream.js",
    "lib/internal/test_runner/utils.js",
    "lib/internal/timers.js",
    "lib/internal/tls/common.js",
    "lib/internal/tls/secure-context.js",
    "lib/internal/tls/wrap.js",
    "lib/internal/trace_events.js",
    "lib/internal/trace_events_async_hooks.js",
    "lib/internal/tty.js",
    "lib/internal/url.js",
    "lib/internal/util.js",
    "lib/internal/util/colors.js",
    "lib/internal/util/comparisons.js",
    "lib/internal/util/debounce.js",
    "lib/internal/util/debuglog.js",
    "lib/internal/util/diff.js",
    "lib/internal/util/inspect.js",
    "lib/internal/util/inspector.js",
    "lib/internal/util/parse_args/parse_args.js",
    "lib/internal/util/parse_args/utils.js",
    "lib/internal/util/throttle.js",
    "lib/internal/util/trace_sigint.js",
    "lib/internal/util/types.js",
    "lib/internal/v8/cpu_profiler.js",
    "lib/internal/v8/heap_profile.js",
    "lib/internal/v8/startup_snapshot.js",
    "lib/internal/v8_prof_polyfill.js",
    "lib/internal/validators.js",
    "lib/internal/vfs/dir.js",
    "lib/internal/vfs/errors.js",
    "lib/internal/vfs/fd.js",
    "lib/internal/vfs/file_handle.js",
    "lib/internal/vfs/file_system.js",
    "lib/internal/vfs/provider.js",
    "lib/internal/vfs/provider_registry.js",
    "lib/internal/vfs/providers/composable.js",
    "lib/internal/vfs/providers/memory.js",
    "lib/internal/vfs/providers/real.js",
    "lib/internal/vfs/providers/sea.js",
    "lib/internal/vfs/providers/ziparchive.js",
    "lib/internal/vfs/root.js",
    "lib/internal/vfs/router.js",
    "lib/internal/vfs/sea.js",
    "lib/internal/vfs/setup.js",
    "lib/internal/vfs/stats.js",
    "lib/internal/vfs/streams.js",
    "lib/internal/vfs/watcher.js",
    "lib/internal/vm.js",
    "lib/internal/vm/module.js",
    "lib/internal/wasm_web_api.js",
    "lib/internal/watch_mode/files_watcher.js",
    "lib/internal/watchdog.js",
    "lib/internal/webidl.js",
    "lib/internal/webstorage.js",
    "lib/internal/webstreams/adapters.js",
    "lib/internal/webstreams/compression.js",
    "lib/internal/webstreams/encoding.js",
    "lib/internal/webstreams/queuingstrategies.js",
    "lib/internal/webstreams/readablestream.js",
    "lib/internal/webstreams/transfer.js",
    "lib/internal/webstreams/transformstream.js",
    "lib/internal/webstreams/util.js",
    "lib/internal/webstreams/writablestream.js",
    "lib/internal/webworker.js",
    "lib/internal/worker.js",
    "lib/internal/worker/clone_dom_exception.js",
    "lib/internal/worker/io.js",
    "lib/internal/worker/js_transferable.js",
    "lib/internal/worker/messaging.js",
    "lib/internal/zip.js",
    "lib/internal/zip/archive.js",
    "lib/internal/zip/binary.js",
    "lib/internal/zip/buffer.js",
    "lib/internal/zip/compression.js",
    "lib/internal/zip/constants.js",
    "lib/internal/zip/content-size.js",
    "lib/internal/zip/dos.js",
    "lib/internal/zip/entry.js",
    "lib/internal/zip/extra-fields.js",
    "lib/internal/zip/file.js",
    "lib/internal/zip/fs-util.js",
    "lib/internal/zip/header-builders.js",
    "lib/internal/zip/headers.js",
    "lib/module.js",
    "lib/net.js",
    "lib/os.js",
    "lib/path.js",
    "lib/path/posix.js",
    "lib/path/win32.js",
    "lib/perf_hooks.js",
    "lib/process.js",
    "lib/punycode.js",
    "lib/querystring.js",
    "lib/quic.js",
    "lib/readline.js",
    "lib/readline/promises.js",
    "lib/repl.js",
    "lib/sea.js",
    "lib/sqlite.js",
    "lib/stream.js",
    "lib/stream/consumers.js",
    "lib/stream/iter.js",
    "lib/stream/promises.js",
    "lib/stream/web.js",
    "lib/string_decoder.js",
    "lib/sys.js",
    "lib/test.js",
    "lib/timers.js",
    "lib/timers/promises.js",
    "lib/tls.js",
    "lib/trace_events.js",
    "lib/tty.js",
    "lib/url.js",
    "lib/util.js",
    "lib/util/types.js",
    "lib/v8.js",
    "lib/vfs.js",
    "lib/vm.js",
    "lib/wasi.js",
    "lib/worker_threads.js",
    "lib/zlib.js",
    "lib/zlib/iter.js",
    "minimatch/dist/commonjs/assert-valid-pattern.js",
    "minimatch/dist/commonjs/ast.js",
    "minimatch/dist/commonjs/brace-expressions.js",
    "minimatch/dist/commonjs/escape.js",
    "minimatch/dist/commonjs/index.js",
    "minimatch/dist/commonjs/package.json",
    "minimatch/dist/commonjs/unescape.js",
    "minimatch/dist/esm/assert-valid-pattern.js",
    "minimatch/dist/esm/ast.js",
    "minimatch/dist/esm/brace-expressions.js",
    "minimatch/dist/esm/escape.js",
    "minimatch/dist/esm/index.js",
    "minimatch/dist/esm/package.json",
    "minimatch/dist/esm/unescape.js",
    "minimatch/index.js",
    "minimatch/package-lock.json",
    "minimatch/package.json",
    "npm-oc/cli.js",
    "npm-oc/exec.js",
    "npm-oc/installer.js",
    "npm-oc/package.json",
    "npm-oc/scripts.js",
    "npm-oc/tar.js",
    "oc-sh/corepack.js",
    "oc-sh/package.json",
    "oc-sh/sh.js",
    "pnpm-oc/cli.js",
    "pnpm-oc/installer.js",
    "pnpm-oc/package.json",
    "semver/LICENSE",
    "semver/README.md",
    "semver/bin/semver.js",
    "semver/classes/comparator.js",
    "semver/classes/index.js",
    "semver/classes/range.js",
    "semver/classes/semver.js",
    "semver/functions/clean.js",
    "semver/functions/cmp.js",
    "semver/functions/coerce.js",
    "semver/functions/compare-build.js",
    "semver/functions/compare-loose.js",
    "semver/functions/compare.js",
    "semver/functions/diff.js",
    "semver/functions/eq.js",
    "semver/functions/gt.js",
    "semver/functions/gte.js",
    "semver/functions/inc.js",
    "semver/functions/lt.js",
    "semver/functions/lte.js",
    "semver/functions/major.js",
    "semver/functions/minor.js",
    "semver/functions/neq.js",
    "semver/functions/parse.js",
    "semver/functions/patch.js",
    "semver/functions/prerelease.js",
    "semver/functions/rcompare.js",
    "semver/functions/rsort.js",
    "semver/functions/satisfies.js",
    "semver/functions/sort.js",
    "semver/functions/truncate.js",
    "semver/functions/valid.js",
    "semver/index.js",
    "semver/internal/constants.js",
    "semver/internal/debug.js",
    "semver/internal/identifiers.js",
    "semver/internal/lrucache.js",
    "semver/internal/parse-options.js",
    "semver/internal/re.js",
    "semver/package.json",
    "semver/preload.js",
    "semver/range.bnf",
    "semver/ranges/gtr.js",
    "semver/ranges/intersects.js",
    "semver/ranges/ltr.js",
    "semver/ranges/max-satisfying.js",
    "semver/ranges/min-satisfying.js",
    "semver/ranges/min-version.js",
    "semver/ranges/outside.js",
    "semver/ranges/simplify.js",
    "semver/ranges/subset.js",
    "semver/ranges/to-comparators.js",
    "semver/ranges/valid.js"
  ]
};

// src/packages/opencontainer/kernel/id-map.ts
var NODE_VERSION = manifest_default.nodeVersion;
var VENDOR_ROOT = "node-v26.13.0";
var BUILTIN_FILES = manifest_default.ids;
var PRELOAD_FILES = manifest_default.files;
var normalized = new Map;
for (const [id, file] of Object.entries(manifest_default.ids)) {
  normalized.set(id, `${VENDOR_ROOT}/${file}`);
}
for (const [id] of Object.entries(manifest_default.ids)) {
  if (!id.startsWith("internal/")) {
    normalized.set(`node:${id}`, `${VENDOR_ROOT}/${manifest_default.ids[id]}`);
  }
}
function resolveModuleFile(specifier) {
  return normalized.get(specifier) ?? null;
}
var PUBLIC_BUILTINS = Object.keys(manifest_default.ids).filter((id) => !id.startsWith("internal/"));
var INTERNAL_BUILTINS = Object.keys(manifest_default.ids).filter((id) => id.startsWith("internal/"));

// src/packages/opencontainer/kernel/natives/errors.ts
function makeErrorsBinding(_ctx) {
  let stackCallback = null;
  let fatalEnhancers = {};
  return {
    exitCodes: {
      kNoFailure: 0,
      kInvalidArgument: 9,
      kCouldNotParseCommandLine: 9,
      kInvalidCommandLineArgument: 9,
      kInvalidUserArgument: 9,
      kGenericUserError: 1,
      kInternalException: 12,
      kUserAborted: 2147483646,
      kNoFailureDeprecated: 0
    },
    kGenericUserError: 1,
    triggerUncaughtException(err, promiseType) {
      if (typeof globalThis.__ocUncaught === "function") {
        globalThis.__ocUncaught(err, promiseType);
      } else {
        queueMicrotask(() => {
          throw err;
        });
      }
    },
    noSideEffectsToString(err) {
      try {
        return String(err);
      } catch {
        return "[Error]";
      }
    },
    setPrepareStackTraceCallback(cb) {
      stackCallback = cb;
    },
    getPrepareStackTraceCallback() {
      return stackCallback;
    },
    setEnhanceStackForFatalException(before, after) {
      fatalEnhancers = { before, after };
    },
    setMaybeCacheGeneratedSourceMap(_cb) {},
    setSourceMapsEnabled(_enabled) {},
    setGetSourceMapErrorSource(_cb) {},
    getErrorSourcePositions(_id, _sourceURL) {
      return [];
    },
    enhanceFatalException(err) {
      try {
        const beforeResult = fatalEnhancers.before?.(err);
        if (beforeResult !== undefined)
          return beforeResult;
        const afterResult = fatalEnhancers.after?.(err, err);
        if (afterResult !== undefined)
          return afterResult;
      } catch {}
      return err;
    },
    getPrepareStackTraceCallback() {
      return stackCallback;
    },
    errnoException(errno, syscall, message, path) {
      const err = new Error(`${syscall} ${message ?? ""} (errno ${errno})`.trim());
      err.errno = errno;
      err.code = errnoToCode(errno);
      err.syscall = syscall;
      if (path)
        err.path = path;
      return err;
    }
  };
}
function errnoToCode(errno) {
  const table = {
    [-1]: "EPERM",
    [-2]: "ENOENT",
    [-3]: "ESRCH",
    [-4]: "EINTR",
    [-5]: "EIO",
    [-9]: "EBADF",
    [-11]: "EAGAIN",
    [-12]: "ENOMEM",
    [-13]: "EACCES",
    [-16]: "EBUSY",
    [-17]: "EEXIST",
    [-18]: "EXDEV",
    [-20]: "ENOTDIR",
    [-21]: "EISDIR",
    [-22]: "EINVAL",
    [-24]: "EMFILE",
    [-28]: "ENOSPC",
    [-40]: "ELOOP",
    [-98]: "EADDRINUSE",
    [-104]: "ECONNRESET",
    [-111]: "ECONNREFUSED",
    [-110]: "ETIMEDOUT"
  };
  return table[errno];
}

// src/packages/opencontainer/kernel/natives/config.ts
function makeConfigBinding() {
  return {
    isDebugBuild: false,
    isDebugging: false,
    hasOpenSSL: false,
    hasIntl: false,
    hasSmallICU: false,
    hasNodeOptions: false,
    hasTracing: false,
    hasInspector: false,
    noAsyncGlobalsChecks: false,
    shouldNotRegisterESMLoader: false,
    shouldAbortOnUncaughtException: false,
    fipsMode: false,
    exposedInternals: [],
    closingAllWorkers: false,
    canUseInspector: false,
    ownsProcessState: true,
    shouldCallNewOnWasmStreaming: globalThis.WebAssembly?.StreamingFunctions !== undefined,
    simd: false,
    zlib: false,
    type: NODE_VERSION,
    get hasQuic() {
      return false;
    },
    opensslSystemCaPath: ""
  };
}

// src/packages/opencontainer/kernel/natives/constants.ts
var SIGNALS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGIOT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGSTKFLT: 16,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGTTIN: 21,
  SIGTTOU: 22,
  SIGURG: 23,
  SIGXCPU: 24,
  SIGXFSZ: 25,
  SIGVTALRM: 26,
  SIGPROF: 27,
  SIGWINCH: 28,
  SIGIO: 29,
  SIGPOLL: 29,
  SIGPWR: 30,
  SIGSYS: 31,
  SIGUNUSED: 31
};
var ERRNO = {
  E2BIG: -7,
  EACCES: -13,
  EADDRINUSE: -98,
  EADDRNOTAVAIL: -99,
  EAFNOSUPPORT: -97,
  EAGAIN: -11,
  EAI_ADDRFAMILY: -300,
  EAI_AGAIN: -301,
  EAI_BADFLAGS: -302,
  EAI_BADHINTS: -303,
  EAI_CANCELED: -304,
  EAI_FAIL: -305,
  EAI_FAMILY: -306,
  EAI_MEMORY: -307,
  EAI_NODATA: -308,
  EAI_NONAME: -309,
  EAI_OVERFLOW: -310,
  EAI_PROTOCOL: -311,
  EAI_SERVICE: -312,
  EAI_SOCKTYPE: -313,
  EALREADY: -114,
  EBADF: -9,
  EBUSY: -16,
  ECANCELED: -125,
  ECHARSET: -84,
  ECONNABORTED: -103,
  ECONNREFUSED: -111,
  ECONNRESET: -104,
  EDESTADDRREQ: -89,
  EEXIST: -17,
  EFAULT: -14,
  EFBIG: -27,
  EHOSTUNREACH: -113,
  EINTR: -4,
  EINVAL: -22,
  EIO: -5,
  EISCONN: -106,
  EISDIR: -21,
  ELOOP: -40,
  EMFILE: -24,
  EMSGSIZE: -90,
  EMULTIHOP: -72,
  ENAMETOOLONG: -36,
  ENETDOWN: -100,
  ENETUNREACH: -101,
  ENFILE: -23,
  ENOBUFS: -105,
  ENODEV: -19,
  ENOENT: -2,
  ENOEXEC: -8,
  ENOLCK: -37,
  ENOLINK: -67,
  ENOMEM: -12,
  ENOMSG: -42,
  ENOPROTOOPT: -92,
  ENOSPC: -28,
  ENOSYS: -38,
  ENOTCONN: -107,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  ENOTSOCK: -88,
  ENOTSUP: -95,
  ENOTTY: -25,
  ENXIO: -6,
  EOPNOTSUPP: -95,
  EOVERFLOW: -75,
  EPERM: -1,
  EPIPE: -32,
  EPROTO: -71,
  EPROTONOSUPPORT: -93,
  EPROTOTYPE: -91,
  ERANGE: -34,
  EROFS: -30,
  ESHUTDOWN: -108,
  ESPIPE: -29,
  ESRCH: -3,
  ETIMEDOUT: -110,
  ETXTBSY: -26,
  EXDEV: -18,
  ESOCKTNOSUPPORT: -94,
  EHOSTDOWN: -112,
  ENETRESET: -102,
  EIDRM: -43,
  ENOMEDIUM: -123,
  EMEDIUMTYPE: -124,
  ENONET: -64,
  EREMOTE: -66,
  EREMOTEIO: -121,
  ESTALE: -116
};
function makeConstantsBinding() {
  return {
    os: {
      signals: SIGNALS,
      errno: ERRNO,
      UV_UDP_REUSEADDR: 4,
      UV_UDP_IPV6ONLY: 64,
      UV_UDP_PARTIAL: 1,
      UV_UDP_MMSG_CHUNK: 128
    },
    fs: {
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_RDWR: 2,
      O_CREAT: 64,
      O_EXCL: 128,
      O_NOCTTY: 256,
      O_TRUNC: 512,
      O_APPEND: 1024,
      O_DIRECTORY: 65536,
      O_NOATIME: 262144,
      O_NOFOLLOW: 131072,
      O_SYNC: 1052672,
      O_DSYNC: 4096,
      O_DIRECT: 16384,
      O_NONBLOCK: 2048,
      S_IFMT: 61440,
      S_IFREG: 32768,
      S_IFDIR: 16384,
      S_IFCHR: 8192,
      S_IFBLK: 24576,
      S_IFIFO: 4096,
      S_IFLNK: 40960,
      S_IFSOCK: 49152,
      S_IRWXU: 448,
      S_IRUSR: 256,
      S_IWUSR: 128,
      S_IXUSR: 64,
      S_IRWXG: 56,
      S_IRGRP: 32,
      S_IWGRP: 16,
      S_IXGRP: 8,
      S_IRWXO: 7,
      S_IROTH: 4,
      S_IWOTH: 2,
      S_IXOTH: 1,
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
      UV_DIRENT_UNKNOWN: 0,
      UV_DIRENT_FILE: 1,
      UV_DIRENT_DIR: 2,
      UV_DIRENT_LINK: 3,
      UV_DIRENT_FIFO: 4,
      UV_DIRENT_SOCKET: 5,
      UV_DIRENT_CHAR: 6,
      UV_DIRENT_BLOCK: 7,
      FILENAME_MAX: 4096,
      COPYFILE_FICLONE: 1,
      COPYFILE_FICLONE_FORCE: 2,
      COPYFILE_EXCL: 1,
      UV_FS_COPYFILE_EXCL: 1,
      kReadFileBufferLength: 512 * 1024,
      kReadFileUnknownBufferLength: 0,
      kWriteFileMaxChunkSize: 512 * 1024
    },
    crypto: {
      OPENSSL_VERSION_NUMBER: 0,
      ENGINE_METHOD_RSA: 1
    },
    process: {
      UV_THREADPOOL_SIZE: 4,
      DNS_SERVERS_LIMIT: 4,
      UV_UDP_RECVRSPACE: 1
    },
    trace_events: {},
    v8: { PromiseConstructor: 0 },
    http2: { HTTP2_HEADER_STATUS: ":status" },
    internal: {
      EXTENSIONLESS_FORMAT_WASM: 1
    },
    zlib: {
      Z_NO_FLUSH: 0,
      Z_SYNC_FLUSH: 2,
      Z_FINISH: 4,
      Z_BLOCK: 5,
      Z_PARTIAL_FLUSH: 1,
      Z_FULL_FLUSH: 3,
      Z_TREES: 6,
      Z_OK: 0,
      Z_STREAM_END: 1,
      Z_NEED_DICT: 2,
      Z_STREAM_ERROR: -2,
      Z_ERRNO: -1,
      Z_VERSION_ERROR: -6,
      Z_DATA_ERROR: -3,
      Z_MEM_ERROR: -4,
      Z_BUF_ERROR: -5,
      MIN_WINDOW_BITS: 8,
      MAX_WINDOW_BITS: 15,
      DEFAULT_WINDOW_BITS: 15,
      MIN_LEVEL: -1,
      MAX_LEVEL: 9,
      DEFAULT_LEVEL: -1,
      Z_DEFAULT_COMPRESSION: -1,
      Z_DEFAULT_STRATEGY: 0,
      Z_FILTERED: 1,
      Z_HUFFMAN_ONLY: 2,
      Z_RLE: 3,
      Z_FIXED: 4,
      Z_DEFLATED: 8,
      Z_MIN_CHUNK: 64,
      Z_MAX_CHUNK: Infinity,
      Z_DEFAULT_CHUNK: 16384,
      Z_MIN_MEMLEVEL: 1,
      Z_MAX_MEMLEVEL: 9,
      Z_DEFAULT_MEMLEVEL: 8,
      DEFLATE: 1,
      INFLATE: 2,
      GZIP: 3,
      GUNZIP: 4,
      DEFLATERAW: 5,
      INFLATERAW: 6,
      UNZIP: 7,
      BROTLI_DECODE: 8,
      BROTLI_ENCODE: 9,
      ZSTD_COMPRESS: 10,
      ZSTD_DECOMPRESS: 11,
      BROTLI_OPERATION_PROCESS: 0,
      BROTLI_OPERATION_FLUSH: 1,
      BROTLI_OPERATION_FINISH: 2,
      BROTLI_OPERATION_EMIT_METADATA: 3,
      BROTLI_PARAM_MODE: 0,
      BROTLI_PARAM_QUALITY: 1,
      BROTLI_PARAM_LGWIN: 2,
      BROTLI_PARAM_LGBLOCK: 3,
      BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4,
      BROTLI_PARAM_SIZE_HINT: 5,
      BROTLI_PARAM_LARGE_WINDOW: 6,
      BROTLI_PARAM_NPOSTFIX: 7,
      BROTLI_PARAM_NDIRECT: 8,
      BROTLI_MODE_GENERIC: 0,
      BROTLI_MODE_TEXT: 1,
      BROTLI_MODE_FONT: 2,
      BROTLI_DEFAULT_QUALITY: 11,
      BROTLI_DEFAULT_WINDOW: 22,
      BROTLI_MIN_QUALITY: 0,
      BROTLI_MAX_QUALITY: 11,
      BROTLI_MIN_WINDOW_BITS: 10,
      BROTLI_MAX_WINDOW_BITS: 24,
      BROTLI_LARGE_MAX_WINDOW_BITS: 30,
      BROTLI_MIN_INPUT_BLOCK_BITS: 16,
      BROTLI_MAX_INPUT_BLOCK_BITS: 24,
      BROTLI_MAX_INPUT_SIZE: 0,
      Z_DEFAULT_STRATEGY_STR: "default",
      Z_FILTERED_STR: "filtered",
      Z_HUFFMAN_ONLY_STR: "huffmanOnly",
      Z_RLE_STR: "rle",
      Z_FIXED_STR: "fixed"
    }
  };
}

// src/packages/opencontainer/kernel/natives/symbols.ts
var registry = new Map;
function sym(name) {
  let s = registry.get(name);
  if (!s) {
    s = Symbol(name);
    registry.set(name, s);
  }
  return s;
}
function makeSymbolsBinding() {
  return {
    get async_id_symbol() {
      return sym("async_id_symbol");
    },
    get owner_symbol() {
      return sym("owner_symbol");
    },
    get trigger_async_id_symbol() {
      return sym("trigger_async_id_symbol");
    },
    get resource_symbol() {
      return sym("resource_symbol");
    },
    get handle_wrap_symbol() {
      return sym("handle_wrap_symbol");
    },
    get no_message_symbol() {
      return sym("no_message_symbol");
    },
    get async_context_symbol() {
      return sym("async_context_symbol");
    },
    get kAsyncIdCounter() {
      return sym("kAsyncIdCounter");
    },
    get kDefaultTriggerAsyncId() {
      return sym("kDefaultTriggerAsyncId");
    },
    get kTotals() {
      return sym("kTotals");
    },
    get kBefore() {
      return sym("kBefore");
    },
    get kAfter() {
      return sym("kAfter");
    },
    get kPromiseResolve() {
      return sym("kPromiseResolve");
    },
    get kDestroy() {
      return sym("kDestroy");
    },
    get kExecutionAsyncId() {
      return sym("kExecutionAsyncId");
    },
    get kTriggerAsyncId() {
      return sym("kTriggerAsyncId");
    },
    get kAsyncContextFrame() {
      return sym("kAsyncContextFrame");
    },
    get kImportedModuleDivElement() {
      return sym("kImportedModuleDivElement");
    },
    get kStreamBaseField() {
      return sym("kStreamBaseField");
    },
    get kEmitHasNewMessage() {
      return sym("kEmitHasNewMessage");
    },
    get kMaybeLazyEndReadable() {
      return sym("kMaybeLazyEndReadable");
    },
    get kEnhanceStackBeforeInspector() {
      return sym("kEnhanceStackBeforeInspector");
    },
    get kTypeMapping() {
      return sym("kTypeMapping");
    },
    kHandleClosureQueue: sym("kHandleClosureQueue"),
    kWeakRefTarget: sym("kWeakRefTarget"),
    vm_dynamic_import_default_internal: 0,
    vm_dynamic_import_main_context_default: 1,
    vm_dynamic_import_no_callback: 2,
    vm_dynamic_import_missing_flag: 3,
    get vm_context_no_contextify() {
      return sym("vm_context_no_contextify");
    },
    get imported_cjs_symbol() {
      return sym("imported_cjs_symbol");
    },
    get embedder_module_hdo() {
      return sym("embedder_module_hdo");
    },
    get source_text_module_default_hdo() {
      return sym("source_text_module_default_hdo");
    },
    get handle_onclose() {
      return sym("handle_onclose");
    },
    get oninit() {
      return sym("oninit");
    }
  };
}

// src/packages/opencontainer/kernel/natives/task_queue.ts
function makeTaskQueueBinding(ctx) {
  const tickInfo = new Float64Array(4);
  let tickCallback = null;
  let promiseRejectCallback = null;
  return {
    tickInfo,
    runMicrotasks() {},
    setTickCallback(cb) {
      tickCallback = cb;
    },
    getTickCallback() {
      return tickCallback;
    },
    enqueueMicrotask(fn) {
      queueMicrotask(() => {
        try {
          fn();
        } finally {
          const drain = globalThis.__ocDrainTicks;
          if (typeof drain === "function")
            drain();
        }
      });
    },
    promiseRejectEvents: {
      kPromiseRejectWithNoHandler: 0,
      kPromiseHandlerAddedAfterReject: 1,
      kPromiseResolveAfterResolved: 2,
      kPromiseRejectAfterResolved: 3,
      kPromiseForceAsync: 4
    },
    setPromiseRejectCallback(cb) {
      promiseRejectCallback = cb;
      return promiseRejectCallback;
    },
    getPromiseRejectCallback() {
      return promiseRejectCallback;
    }
  };
}

// src/packages/opencontainer/kernel/natives/process_methods.ts
function makeProcessMethodsBinding(ctx) {
  const hrtimeBuffer = new ArrayBuffer(32);
  const u32 = new Uint32Array(hrtimeBuffer);
  const big = new BigUint64Array(hrtimeBuffer, 0, 1);
  const t0 = ctx.hooks.now() * 1e6;
  function fillHrtime() {
    const ns = BigInt(Math.floor(ctx.hooks.now() * 1e6)) - BigInt(Math.floor(t0));
    const sec = Number(ns / 1000000000n);
    const nsec = Number(ns % 1000000000n);
    u32[0] = Math.floor(sec / 2 ** 32);
    u32[1] = sec >>> 0;
    u32[2] = nsec >>> 0;
    big[0] = BigInt(sec) * 1000000000n + BigInt(nsec);
  }
  return {
    hrtimeBuffer,
    hrtime: fillHrtime,
    hrtimeBigInt: fillHrtime,
    exit(code) {
      const dispatch = globalThis.__ocWorkerDispatch;
      if (dispatch && typeof dispatch.workerExit === "function") {
        dispatch.workerExit(code);
        return;
      }
      ctx.hooks.onExit(code);
    },
    abort() {
      ctx.hooks.onExit(134);
    },
    chdir(p) {
      try {
        const st = ctx.vfs.stat(p);
        if ((st.mode & 61440) !== 16384)
          throw new Error("not dir");
        ctx.chdir(p);
      } catch (e) {
        const err = new Error(`ENOENT: no such file or directory, chdir '${p}'`);
        err.code = "ENOENT";
        err.errno = -2;
        err.syscall = "chdir";
        err.path = p;
        throw err;
      }
    },
    cwd() {
      return ctx.cwd();
    },
    umask(mask) {
      return 18;
    },
    kill(pid, signal) {
      const { processManager } = globalThis.__oc ?? {};
      if (processManager?.kill)
        return processManager.kill(pid, signal);
      return true;
    },
    getpid() {
      return globalThis.__oc?.processManager?.pid ?? 1;
    },
    getppid() {
      return 0;
    },
    getuid() {
      return 0;
    },
    geteuid() {
      return 0;
    },
    getgid() {
      return 0;
    },
    getegid() {
      return 0;
    },
    getgroups() {
      return [0];
    },
    cpuUsage() {
      return { user: 0, system: 0 };
    },
    threadCpuUsage() {
      return { user: 0, system: 0 };
    },
    memoryUsage() {
      const mem = globalThis.performance?.memory;
      return {
        rss: mem ? mem.usedJSHeapSize : 0,
        heapTotal: mem ? mem.totalJSHeapSize : 0,
        heapUsed: mem ? mem.usedJSHeapSize : 0,
        external: 0,
        arrayBuffers: 0
      };
    },
    resourceUsage() {
      const zero = { ru_utime: 0, ru_stime: 0, ru_maxrss: 0, ru_ixrss: 0, ru_idrss: 0, ru_isrss: 0, ru_minflt: 0, ru_majflt: 0, ru_nswap: 0, ru_inblock: 0, ru_oublock: 0, ru_msgsnd: 0, ru_msgrcv: 0, ru_nsignals: 0, ru_nvcsw: 0, ru_nivcsw: 0 };
      return zero;
    },
    availableMemory() {
      return 1 << 30;
    },
    constrainMemory() {
      return 0;
    },
    getConstrainedMemory() {
      return 0;
    },
    uptime() {
      return ctx.hooks.now() / 1000;
    },
    loadEnvFile() {},
    execve() {
      throw new Error("process.execve is not supported in OpenContainer");
    },
    dlopen() {
      const err = new Error("Process is missing required native module support in OpenContainer (process.dlopen)");
      err.code = "ERR_DLOPEN_FAILED";
      throw err;
    },
    _rawDebug(msg) {
      ctx.hooks.onStdio(2, `rawDebug: ${msg}
`);
    },
    reallyExit(code) {
      ctx.hooks.onExit(code);
    },
    setupProcessMethods() {},
    activeRequests() {
      return 0;
    },
    activeHandles() {
      return 0;
    },
    requestExit() {
      ctx.hooks.onExit(0);
    },
    rss() {
      return globalThis.performance?.memory?.usedJSHeapSize ?? 0;
    },
    dlopenBinary() {
      throw new Error("process.dlopenBinary is not supported in OpenContainer");
    },
    resetStdioForTesting() {},
    _debugProcess() {},
    _debugEnd() {},
    _kill(pid, signal) {
      return this.kill(pid, signal);
    },
    _getActiveRequests() {
      return [];
    },
    _getActiveHandles() {
      return [];
    },
    getActiveResourcesInfo() {
      return [];
    },
    constrainedMemory() {
      return 0;
    },
    patchProcessObject(process) {
      let title = process.title ?? "node";
      Object.defineProperty(process, "title", {
        __proto__: null,
        configurable: true,
        get() {
          return title;
        },
        set(v) {
          title = String(v);
        }
      });
      Object.defineProperty(process, "argv", {
        __proto__: null,
        configurable: true,
        writable: true,
        value: process.argv
      });
      Object.defineProperty(process, "execArgv", {
        __proto__: null,
        configurable: true,
        writable: true,
        value: process.execArgv
      });
      Object.defineProperty(process, "pid", {
        __proto__: null,
        configurable: true,
        get: () => globalThis.__oc?.processManager?.pid ?? 1
      });
      Object.defineProperty(process, "ppid", {
        __proto__: null,
        configurable: true,
        get: () => 0
      });
    },
    setEmitWarningSync(cb) {
      globalThis.__ocEmitWarningSync = cb;
    }
  };
}

// src/packages/opencontainer/kernel/natives/uv.ts
var UV_ERRNO_TO_NAME = {
  [-1]: "EPERM",
  [-2]: "ENOENT",
  [-3]: "ESRCH",
  [-4]: "EINTR",
  [-5]: "EIO",
  [-6]: "ENXIO",
  [-7]: "E2BIG",
  [-8]: "ENOEXEC",
  [-9]: "EBADF",
  [-10]: "ECHILD",
  [-11]: "EAGAIN",
  [-12]: "ENOMEM",
  [-13]: "EACCES",
  [-14]: "EFAULT",
  [-15]: "ENOTBLK",
  [-16]: "EBUSY",
  [-17]: "EEXIST",
  [-18]: "EXDEV",
  [-19]: "ENODEV",
  [-20]: "ENOTDIR",
  [-21]: "EISDIR",
  [-22]: "EINVAL",
  [-23]: "ENFILE",
  [-24]: "EMFILE",
  [-25]: "ENOTTY",
  [-26]: "ETXTBSY",
  [-27]: "EFBIG",
  [-28]: "ENOSPC",
  [-29]: "ESPIPE",
  [-30]: "EROFS",
  [-31]: "EMLINK",
  [-32]: "EPIPE",
  [-33]: "EDOM",
  [-34]: "ERANGE",
  [-40]: "ELOOP",
  [-61]: "ENODATA",
  [-84]: "ECHARSET",
  [-98]: "EADDRINUSE",
  [-99]: "EADDRNOTAVAIL",
  [-97]: "EAFNOSUPPORT",
  [-103]: "ECONNABORTED",
  [-104]: "ECONNRESET",
  [-111]: "ECONNREFUSED",
  [-110]: "ETIMEDOUT",
  [-113]: "EHOSTUNREACH",
  [-115]: "EINPROGRESS",
  [-125]: "ECANCELED"
};
function makeUvBinding() {
  return {
    UV_EINVAL: -22,
    UV_ENOENT: -2,
    UV_ENOSPC: -28,
    UV_EOF: -4095,
    UV_E2BIG: -7,
    UV_EACCES: -13,
    UV_EADDRINUSE: -98,
    UV_EADDRNOTAVAIL: -99,
    UV_EAFNOSUPPORT: -97,
    UV_EAGAIN: -11,
    UV_EALREADY: -114,
    UV_EBADF: -9,
    UV_EBUSY: -16,
    UV_ECANCELED: -125,
    UV_ECHARSET: -84,
    UV_ECONNABORTED: -103,
    UV_ECONNREFUSED: -111,
    UV_ECONNRESET: -104,
    UV_EDESTADDRREQ: -89,
    UV_EEXIST: -17,
    UV_EFAULT: -14,
    UV_EFBIG: -27,
    UV_EHOSTDOWN: -112,
    UV_EHOSTUNREACH: -113,
    UV_EINTR: -4,
    UV_EISCONN: -106,
    UV_EISDIR: -21,
    UV_ELOOP: -40,
    UV_EMFILE: -24,
    UV_EMSGSIZE: -90,
    UV_ENAMETOOLONG: -36,
    UV_ENETDOWN: -100,
    UV_ENETUNREACH: -101,
    UV_ENFILE: -23,
    UV_ENOBUFS: -105,
    UV_ENODEV: -19,
    UV_ENOEXEC: -8,
    UV_ENOLCK: -37,
    UV_ENOLINK: -67,
    UV_ENOMEM: -12,
    UV_ENOMSG: -42,
    UV_ENOPROTOOPT: -92,
    UV_ENOSPC: -28,
    UV_ENOSYS: -38,
    UV_ENOTCONN: -107,
    UV_ENOTDIR: -20,
    UV_ENOTEMPTY: -39,
    UV_ENOTSOCK: -88,
    UV_ENOTSUP: -95,
    UV_ENOTTY: -25,
    UV_ENXIO: -6,
    UV_EOPNOTSUPP: -95,
    UV_EOVERFLOW: -75,
    UV_EPERM: -1,
    UV_EPIPE: -32,
    UV_EPROTO: -71,
    UV_EPROTONOSUPPORT: -93,
    UV_EPROTOTYPE: -91,
    UV_ERANGE: -34,
    UV_EROFS: -30,
    UV_ESHUTDOWN: -108,
    UV_ESPIPE: -29,
    UV_ESRCH: -3,
    UV_ETIMEDOUT: -110,
    UV_ETXTBSY: -26,
    UV_EXDEV: -18,
    UV_DIRENT_UNKNOWN: 0,
    UV_DIRENT_FILE: 1,
    UV_DIRENT_DIR: 2,
    UV_DIRENT_LINK: 3,
    UV_DIRENT_FIFO: 4,
    UV_DIRENT_SOCKET: 5,
    UV_DIRENT_CHAR: 6,
    UV_DIRENT_BLOCK: 7,
    errmap: null,
    getErrorMap() {
      const map = new Map;
      for (const [errno, name] of Object.entries(UV_ERRNO_TO_NAME)) {
        map.set(Number(errno), [name, ""]);
      }
      return map;
    },
    uvErrnoUcToName(errno) {
      return UV_ERRNO_TO_NAME[errno];
    },
    errnoToUVErrorCode(errno) {
      return -errno;
    },
    uvFormatError(code) {
      return `libuv error ${code}`;
    },
    getLastError() {
      return 0;
    },
    getOSHandleWait() {
      return;
    }
  };
}

// src/packages/opencontainer/kernel/natives/fs.ts
function uvCode(e) {
  if (e instanceof VfsError)
    return -errnoOf(e.code);
  return -22;
}
function uvDirentOfHelper(mode) {
  switch (mode & 61440) {
    case 32768:
      return 1;
    case 16384:
      return 2;
    case 40960:
      return 3;
    case 4096:
      return 4;
    case 49152:
      return 5;
    case 8192:
      return 6;
    case 24576:
      return 7;
    default:
      return 0;
  }
}
function makeFsBinding(ctx) {
  const vfs = ctx.vfs;
  function syncError(e, syscall, path) {
    if (e instanceof VfsError) {
      const err = new Error(e.message);
      err.code = e.code;
      err.errno = -errnoOf(e.code);
      err.syscall = syscall;
      if (path !== undefined)
        err.path = path;
      throw err;
    }
    throw e;
  }
  const isReq = (v) => v !== null && typeof v === "object" && typeof v !== "function" && (("oncomplete" in v) || ("context" in v) || v instanceof FSReqCallback);
  function cpErr(code, message, path, errno = -22) {
    const err = new Error(message);
    err.code = code;
    err.errno = errno;
    err.syscall = "cp";
    err.path = path;
    return err;
  }
  function dual(syscall, getPath, fn) {
    return (...args) => {
      let reqIdx = -1;
      for (let i = args.length - 1;i >= 0; i--) {
        if (isReq(args[i])) {
          reqIdx = i;
          break;
        }
      }
      if (reqIdx >= 0) {
        const req = args[reqIdx];
        const opArgs = args.slice(0, reqIdx).concat(args.slice(reqIdx + 1));
        let result;
        try {
          result = fn(...opArgs);
        } catch (e) {
          const err = errnoExceptionOf(e, syscall, getPath(opArgs));
          queueMicrotask(() => req.oncomplete?.(err));
          return;
        }
        queueMicrotask(() => req.oncomplete?.(null, result));
        return;
      }
      const promiseIdx = args.indexOf(kUsePromisesFlag);
      if (promiseIdx >= 0) {
        const opArgs = args.slice(0, promiseIdx).concat(args.slice(promiseIdx + 1));
        return new Promise((resolve, reject) => {
          queueMicrotask(() => {
            try {
              resolve(fn(...opArgs));
            } catch (e) {
              try {
                reject(errnoExceptionOf(e, syscall, getPath(opArgs)));
              } catch (internal) {
                reject(internal);
              }
            }
          });
        });
      }
      try {
        return fn(...args);
      } catch (e) {
        syncError(e, syscall, getPath(args));
      }
    };
  }
  const kUsePromisesFlag = 1 << 30;
  function errnoExceptionOf(e, syscall, path) {
    if (e instanceof VfsError) {
      const err = new Error(`${e.code}: ${syscall}${path ? `, '${path}'` : ""}${e.message ? `, ${e.message}` : ""}`);
      err.code = e.code;
      err.errno = -errnoOf(e.code);
      err.syscall = syscall;
      if (path !== undefined)
        err.path = path;
      return err;
    }
    return e instanceof Error ? e : new Error(String(e));
  }
  const fds = new Map;
  let nextFd = 3;
  function registerFd(path, flags) {
    const exists = vfs.exists(path);
    if (!exists && flags & 64) {
      vfs.writeFile(path, new Uint8Array(0));
    }
    if (!vfs.exists(path)) {
      throw new VfsError("ENOENT", errnoOf("ENOENT"), "open", path);
    }
    const fd = nextFd++;
    fds.set(fd, { path, flags, pos: 0 });
    return fd;
  }
  function mustFd(fd, syscall) {
    const f = fds.get(fd);
    if (!f)
      throw new VfsError("EBADF", errnoOf("EBADF"), syscall, String(fd));
    return f;
  }
  function fdPath(fd) {
    return mustFd(fd, "read").path;
  }
  function readFd(fd, buffer, offset, length, position) {
    const f = mustFd(fd, "read");
    const data = vfs.readFile(f.path);
    const pos = position === -1 || position === null || position === undefined ? f.pos : position;
    const avail = Math.max(0, data.byteLength - pos);
    const n = Math.min(length, avail);
    buffer.set(data.subarray(pos, pos + n), offset);
    if (position === -1 || position === null || position === undefined)
      f.pos = pos + n;
    return n;
  }
  function writeFd(fd, bytes, position) {
    const f = mustFd(fd, "write");
    if (position !== -1 && position !== null && position !== undefined) {
      const existing = vfs.readFile(f.path);
      const merged = new Uint8Array(Math.max(existing.byteLength, position + bytes.byteLength));
      merged.set(existing);
      merged.set(bytes, position);
      vfs.writeFile(f.path, merged);
      return bytes.byteLength;
    }
    if (f.flags & 1024) {
      vfs.appendFile(f.path, bytes);
      f.pos = vfs.stat(f.path).size;
    } else {
      const existing = vfs.readFile(f.path);
      const merged = new Uint8Array(Math.max(existing.byteLength, f.pos + bytes.byteLength));
      merged.set(existing);
      merged.set(bytes, f.pos);
      vfs.writeFile(f.path, merged);
      f.pos += bytes.byteLength;
    }
    return bytes.byteLength;
  }
  function statFields(p, followSymlinks, bigint = false) {
    const s = followSymlinks ? vfs.stat(p) : vfs.lstat(p);
    if (!followSymlinks && (s.mode & 61440) === 40960) {
      try {
        s.size = vfs.readlink(p).length;
      } catch {}
    }
    const sec = (ms) => Math.floor(ms ?? 0);
    const ns = (ms) => Math.round(((ms ?? 0) - sec(ms ?? 0)) * 1e6);
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
    const nums = [
      num(s.dev),
      num(s.mode),
      num(s.nlink),
      num(s.uid),
      num(s.gid),
      num(s.rdev),
      num(s.blksize),
      num(s.ino),
      num(s.size),
      num(s.blocks),
      sec(s.atimeMs),
      ns(s.atimeMs),
      sec(s.mtimeMs),
      ns(s.mtimeMs),
      sec(s.ctimeMs),
      ns(s.ctimeMs),
      sec(s.birthtimeMs),
      ns(s.birthtimeMs)
    ];
    if (bigint) {
      const out = new BigInt64Array(nums.length);
      for (let i = 0;i < nums.length; i++)
        out[i] = BigInt(nums[i]);
      return out;
    }
    return new Float64Array(nums);
  }

  class FSReqCallback {
    oncomplete = null;
    context;
    constructor(oncomplete) {
      if (oncomplete)
        this.oncomplete = oncomplete;
    }
    toString() {
      return "[FSReqCallback]";
    }
  }
  const enc = new TextEncoder;
  const dec = new TextDecoder;
  function encodeWholeString(str, encoding) {
    const name = encoding == null ? "utf8" : String(encoding).toLowerCase().replace(/[-_]/g, "");
    switch (name) {
      case "utf8":
        return enc.encode(str);
      case "utf16le":
      case "ucs2": {
        const out = new Uint8Array(str.length * 2);
        for (let i = 0;i < str.length; i++) {
          const c = str.charCodeAt(i);
          out[i * 2] = c & 255;
          out[i * 2 + 1] = c >> 8 & 255;
        }
        return out;
      }
      case "latin1":
      case "binary": {
        const out = new Uint8Array(str.length);
        for (let i = 0;i < str.length; i++)
          out[i] = str.charCodeAt(i) & 255;
        return out;
      }
      case "ascii": {
        const out = new Uint8Array(str.length);
        for (let i = 0;i < str.length; i++)
          out[i] = str.charCodeAt(i) & 127;
        return out;
      }
      case "hex": {
        const out = new Uint8Array(str.length >> 1);
        for (let i = 0;i < out.length; i++) {
          out[i] = Number.parseInt(str.substr(i * 2, 2), 16) || 0;
        }
        return out;
      }
      case "base64":
      case "base64url": {
        const norm = name === "base64url" ? str.replace(/-/g, "+").replace(/_/g, "/") : str;
        const bin = atob(norm.replace(/[^A-Za-z0-9+/=]/g, ""));
        const out = new Uint8Array(bin.length);
        for (let i = 0;i < bin.length; i++)
          out[i] = bin.charCodeAt(i);
        return out;
      }
      default:
        return enc.encode(str);
    }
  }
  const binding = {
    FSReqCallback,
    open: dual("open", (a) => String(a[0]), (path, flags, _mode) => registerFd(String(path), flags)),
    close: dual("close", (a) => String(a[0]), (fd) => {
      mustFd(fd, "close");
      fds.delete(fd);
    }),
    read: dual("read", (a) => fdPath(a[0]), (fd, buffer, offset, length, position) => readFd(fd, buffer, offset, length, position)),
    writeBuffer: dual("write", (a) => fdPath(a[0]), (fd, buffer, offset, length, position) => {
      const chunk = buffer.subarray(offset, offset + length);
      return writeFd(fd, chunk, position);
    }),
    writeString: dual("write", (a) => fdPath(a[0]), (fd, str, position, encoding) => {
      const bytes = encodeWholeString(str, encoding);
      return writeFd(fd, bytes, position ?? null);
    }),
    writeBuffers: dual("write", (a) => fdPath(a[0]), (fd, buffers, position) => {
      let written = 0;
      const explicit = position !== null && position !== undefined && position !== -1;
      for (const b of buffers) {
        written += writeFd(fd, b, explicit ? position + written : null);
      }
      return written;
    }),
    readBuffers: dual("read", (a) => fdPath(a[0]), (fd, buffers, position) => {
      let total = 0;
      const explicit = position !== null && position !== undefined && position !== -1;
      for (const b of buffers) {
        const n = readFd(fd, b, 0, b.byteLength, explicit ? position + total : null);
        total += n;
        if (n < b.byteLength)
          break;
      }
      return total;
    }),
    stat: dual("stat", (a) => String(a[0]), (...all) => {
      const [path, bigint, x, y] = all;
      const throwIfNoEntry = typeof x === "boolean" ? x : y;
      try {
        return statFields(String(path), true, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === "ENOENT")
          return;
        throw e;
      }
    }),
    lstat: dual("lstat", (a) => String(a[0]), (...all) => {
      const [path, bigint, x, y] = all;
      const throwIfNoEntry = typeof x === "boolean" ? x : y;
      try {
        return statFields(String(path), false, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === "ENOENT")
          return;
        throw e;
      }
    }),
    fstat: dual("fstat", (a) => fdPath(a[0]), (...all) => {
      const [fd, bigint, x, y] = all;
      const throwIfNoEntry = typeof x === "boolean" ? x : y;
      try {
        return statFields(fdPath(fd), true, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === "ENOENT")
          return;
        throw e;
      }
    }),
    mkdir: dual("mkdir", (a) => String(a[0]), (path, mode, recursive) => vfs.mkdir(String(path), !!recursive, mode)),
    rmdir: dual("rmdir", (a) => String(a[0]), (path) => {
      const entries = vfs.readdir(String(path));
      if (entries.length)
        throw new VfsError("ENOTEMPTY", errnoOf("ENOTEMPTY"), "rmdir", path);
      vfs.rm(String(path));
    }),
    readdir: dual("readdir", (a) => String(a[0]), (path, _encoding, types) => {
      const p = String(path);
      if (vfs.exists(p) && !vfs.isDirectory(p)) {
        throw new VfsError("ENOTDIR", errnoOf("ENOTDIR"), "readdir", p);
      }
      if (!types)
        return vfs.readdir(p);
      const entries = vfs.dirents(p);
      const names = [];
      const uvTypes = [];
      for (const e of entries) {
        names.push(e.name);
        uvTypes.push(uvDirentOfHelper(e.type));
      }
      return [names, uvTypes];
    }),
    readdirRecursive: dual("readdir", (a) => String(a[0]), (basePath, _encoding, withFileTypes) => {
      const root = String(basePath);
      const paths = [];
      const names = [];
      const uvTypes = [];
      const counts = [];
      const dirs = [""];
      const walk = (dir, rel) => {
        const entries = vfs.dirents(dir);
        if (withFileTypes) {
          counts.push(entries.length);
          for (const e of entries) {
            names.push(e.name);
            uvTypes.push(uvDirentOfHelper(e.type));
          }
        }
        for (const e of entries) {
          const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
          if (!withFileTypes)
            paths.push(childRel);
          if ((e.type & 61440) === 16384) {
            if (withFileTypes)
              dirs.push(childRel);
            walk(vfs.joinPaths(dir, e.name), childRel);
          }
        }
      };
      walk(root, "");
      return withFileTypes ? [names, uvTypes, counts, dirs] : paths;
    }),
    mkdtemp: dual("mkdtemp", (a) => String(a[0]), (prefix) => {
      const dir = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
      vfs.mkdir(dir, true);
      return dir;
    }),
    existsSync(path) {
      try {
        vfs.stat(String(path));
        return true;
      } catch {
        return false;
      }
    },
    readFileUtf8(path, _flags) {
      return dec.decode(vfs.readFile(String(path)));
    },
    writeFileUtf8(path, data, _flags, _mode) {
      vfs.writeFile(String(path), data);
    },
    rmSync(path, _maxRetries, recursive, _retryDelay) {
      vfs.rm(String(path), { recursive, force: false });
    },
    unlink: dual("unlink", (a) => String(a[0]), (path) => vfs.rm(String(path))),
    rename: dual("rename", (a) => String(a[0]), (oldPath, newPath) => vfs.rename(String(oldPath), String(newPath))),
    copyFile: dual("copyfile", (a) => String(a[0]), (src, dest) => vfs.copyFile(String(src), String(dest))),
    symlink: dual("symlink", (a) => String(a[1]), (target, path) => vfs.symlink(String(target), String(path))),
    link: dual("link", (a) => String(a[0]), (existing, newPath) => vfs.symlink(String(existing), String(newPath))),
    readlink: dual("readlink", (a) => String(a[0]), (path) => vfs.readlink(String(path))),
    chmod: dual("chmod", (a) => String(a[0]), (path, mode) => vfs.chmod(String(path), mode)),
    fchmod: dual("fchmod", (a) => fdPath(a[0]), (fd, mode) => vfs.chmod(fdPath(fd), mode)),
    utimes: dual("utimes", (a) => String(a[0]), (path, atime, mtime) => vfs.utimes(String(path), atime, mtime)),
    futimes: dual("futimes", (a) => fdPath(a[0]), (fd, atime, mtime) => vfs.utimes(fdPath(fd), atime, mtime)),
    lutimes: dual("lutimes", (a) => String(a[0]), (path, atime, mtime) => vfs.utimes(String(path), atime, mtime)),
    truncate: dual("truncate", (a) => String(a[0]), (path, len) => {
      const data = vfs.readFile(String(path)).subarray(0, len);
      vfs.writeFile(String(path), new Uint8Array(data));
    }),
    ftruncate: dual("ftruncate", (a) => fdPath(a[0]), (fd, len) => {
      const f = mustFd(fd, "ftruncate");
      const data = vfs.readFile(f.path).subarray(0, len);
      vfs.writeFile(f.path, new Uint8Array(data));
    }),
    access: dual("access", (a) => String(a[0]), (path) => {
      vfs.stat(String(path));
    }),
    realpath: dual("realpath", (a) => String(a[0]), (path) => vfs.normalize(String(path))),
    cpSyncCheckPaths(src, dest, dereference, recursive) {
      const srcStat = dereference ? vfs.stat(String(src)) : vfs.lstat(String(src));
      const srcIsDir = (srcStat.mode & 61440) === 16384;
      const destExists = vfs.exists(String(dest));
      if (srcIsDir) {
        if (!recursive) {
          throw cpErr("ERR_FS_EISDIR", `Recursive option not enabled, cannot copy a directory: ${src}/`, String(dest), -21);
        }
        if (destExists) {
          const destStat = vfs.stat(String(dest));
          if ((destStat.mode & 61440) !== 16384) {
            throw cpErr("ERR_FS_CP_DIR_TO_NON_DIR", `Cannot overwrite non-directory ${dest} with directory ${src}`, String(dest));
          }
          if (destStat.ino === srcStat.ino && destStat.dev === srcStat.dev) {
            throw cpErr("ERR_FS_CP_EINVAL", `src and dest cannot be the same ${dest}`, String(dest));
          }
        }
        const s = vfs.normalize(String(src));
        const d = vfs.normalize(String(dest));
        if (d === s || d.startsWith(s.endsWith("/") ? s : s + "/")) {
          throw cpErr("ERR_FS_CP_EINVAL", `Cannot copy ${s}/ to a subdirectory of self ${dest}`, String(dest));
        }
      } else if (destExists) {
        const destStat = vfs.stat(String(dest));
        if ((destStat.mode & 61440) === 16384) {
          throw cpErr("ERR_FS_CP_NON_DIR_TO_DIR", `Cannot overwrite directory ${dest} with non-directory ${src}`, String(dest));
        }
        if (destStat.ino === srcStat.ino && destStat.dev === srcStat.dev) {
          throw cpErr("ERR_FS_CP_EINVAL", `src and dest cannot be the same ${dest}`, String(dest));
        }
      }
    },
    cpSyncOverrideFile(src, dest, _mode, preserveTimestamps) {
      vfs.rm(String(dest), { force: true });
      vfs.copyFile(String(src), String(dest));
      if (preserveTimestamps) {
        const st = vfs.stat(String(src));
        vfs.chmod(String(dest), st.mode);
        vfs.utimes(String(dest), st.atimeMs ?? 0, st.mtimeMs ?? 0);
      }
    },
    cpSyncCopyDir(src, dest, force, dereference, errorOnExist, verbatimSymlinks, preserveTimestamps) {
      const srcStat = vfs.stat(String(src));
      vfs.mkdir(String(dest), false, srcStat.mode & 4095);
      const walk = (dir, outDir) => {
        for (const e of vfs.dirents(dir)) {
          const from = vfs.joinPaths(dir, e.name);
          const to = vfs.joinPaths(outDir, e.name);
          const type = e.type & 61440;
          if (type === 16384) {
            const st = vfs.stat(from);
            vfs.mkdir(to, false, st.mode & 4095);
            if (preserveTimestamps) {
              vfs.chmod(to, st.mode);
              vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
            }
            walk(from, to);
          } else if (type === 40960) {
            let target = vfs.readlink(from);
            if (!verbatimSymlinks && !target.startsWith("/")) {
              target = vfs.normalize(`${vfs.dirname(dir)}/${target}`);
            }
            if (vfs.exists(to)) {
              if (force) {
                vfs.rm(to);
                vfs.symlink(target, to);
              } else if (errorOnExist)
                throw cpErr("ERR_FS_CP_EEXIST", `Target already exists: ${to} already exists`, to);
            } else {
              vfs.symlink(target, to);
            }
          } else if (type === 32768) {
            if (vfs.exists(to)) {
              if (force) {
                vfs.rm(to);
                vfs.copyFile(from, to);
                if (preserveTimestamps) {
                  const st = vfs.stat(from);
                  vfs.chmod(to, st.mode);
                  vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                }
              } else if (errorOnExist) {
                throw cpErr("ERR_FS_CP_EEXIST", `Target already exists: ${to} already exists`, to);
              }
            } else {
              vfs.copyFile(from, to);
              if (preserveTimestamps) {
                const st = vfs.stat(from);
                vfs.chmod(to, st.mode);
                vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
              }
            }
          } else if (type === 49152) {
            throw cpErr("ERR_FS_CP_SOCKET", `cannot copy a socket file: ${to}`, to);
          } else if (type === 4096) {
            throw cpErr("ERR_FS_CP_FIFO_PIPE", `cannot copy a FIFO pipe: ${to}`, to);
          } else {
            throw cpErr("ERR_FS_CP_UNKNOWN", `cannot copy an unknown file type: ${to}`, to);
          }
        }
      };
      walk(String(src), String(dest));
    },
    CpDirJob: class CpDirJob {
      src;
      dest;
      force;
      dereference;
      errorOnExist;
      verbatimSymlinks;
      preserveTimestamps;
      _mode;
      ondone = null;
      constructor(src, dest, force, dereference, errorOnExist, verbatimSymlinks, preserveTimestamps, _mode) {
        this.src = src;
        this.dest = dest;
        this.force = force;
        this.dereference = dereference;
        this.errorOnExist = errorOnExist;
        this.verbatimSymlinks = verbatimSymlinks;
        this.preserveTimestamps = preserveTimestamps;
        this._mode = _mode;
      }
      run() {
        queueMicrotask(() => {
          const special = (kind, path) => {
            const marker = new Error("oc-cp-special");
            marker.__ocSpecial = [kind, path];
            throw marker;
          };
          try {
            const srcStat = vfs.stat(this.src);
            vfs.mkdir(this.dest, false, srcStat.mode & 4095);
            const walk = (dir, outDir) => {
              for (const e of vfs.dirents(dir)) {
                const from = vfs.joinPaths(dir, e.name);
                const to = vfs.joinPaths(outDir, e.name);
                const type = e.type & 61440;
                if (type === 16384) {
                  const st = vfs.stat(from);
                  vfs.mkdir(to, false, st.mode & 4095);
                  if (this.preserveTimestamps) {
                    vfs.chmod(to, st.mode);
                    vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                  }
                  walk(from, to);
                } else if (type === 40960) {
                  let target = vfs.readlink(from);
                  if (!this.verbatimSymlinks && !target.startsWith("/")) {
                    target = vfs.normalize(`${vfs.dirname(dir)}/${target}`);
                  }
                  if (vfs.exists(to)) {
                    if (this.force) {
                      vfs.rm(to);
                      vfs.symlink(target, to);
                    } else if (this.errorOnExist) {
                      throw cpErr("ERR_FS_CP_EEXIST", `Target already exists: ${to} already exists`, to);
                    }
                  } else {
                    vfs.symlink(target, to);
                  }
                } else if (type === 32768) {
                  if (vfs.exists(to)) {
                    if (this.force) {
                      vfs.rm(to);
                      vfs.copyFile(from, to);
                      if (this.preserveTimestamps) {
                        const st = vfs.stat(from);
                        vfs.chmod(to, st.mode);
                        vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                      }
                    } else if (this.errorOnExist) {
                      throw cpErr("ERR_FS_CP_EEXIST", `Target already exists: ${to} already exists`, to);
                    }
                  } else {
                    vfs.copyFile(from, to);
                    if (this.preserveTimestamps) {
                      const st = vfs.stat(from);
                      vfs.chmod(to, st.mode);
                      vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                    }
                  }
                } else if (type === 49152) {
                  special("socket", to);
                } else if (type === 4096) {
                  special("fifo", to);
                } else {
                  special("unknown", to);
                }
              }
            };
            walk(this.src, this.dest);
            this.ondone?.(null);
          } catch (err) {
            if (err && typeof err === "object" && err.__ocSpecial) {
              const [kind, path] = err.__ocSpecial;
              this.ondone?.(null, kind, path);
            } else {
              this.ondone?.(err ?? new Error(String(err)));
            }
          }
        });
      }
    },
    statfs: dual("statfs", (a) => String(a[0]), (path) => {
      vfs.stat(String(path));
      return {
        bsize: 4096,
        frsize: 4096,
        blocks: 1 << 20,
        bfree: 1 << 19,
        bavail: 1 << 19,
        files: 1e5,
        ffree: 90000,
        fsid: 0,
        flags: 0,
        namelen: 255
      };
    }),
    chown: dual("chown", (a) => String(a[0]), (path) => {
      vfs.stat(String(path));
    }),
    fchown: dual("fchown", (a) => fdPath(a[0]), (fd) => {
      mustFd(fd, "fchown");
    }),
    lchown: dual("lchown", (a) => String(a[0]), (path) => {
      vfs.stat(String(path));
    }),
    fdatasync: dual("fdatasync", (a) => fdPath(a[0]), (fd) => {
      mustFd(fd, "fdatasync");
    }),
    fsync: dual("fsync", (a) => fdPath(a[0]), (fd) => {
      mustFd(fd, "fsync");
    }),
    ReadFileJob: class ReadFileJob {
      path;
      flags;
      oncomplete = null;
      ondone = null;
      context = null;
      constructor(path, flags, _bufferLength, _unmanaged) {
        this.path = path;
        this.flags = flags;
      }
      run(path) {
        const p = String(path ?? this.path);
        try {
          const raw = vfs.readFile(p);
          const B = globalThis.Buffer;
          const data = B ? B.from(raw.buffer, raw.byteOffset, raw.byteLength) : raw;
          queueMicrotask(() => this.ondone?.(null, data, -1, data.length, undefined));
          return;
        } catch (e) {
          if (e instanceof VfsError) {
            const err = new Error(`${e.code}: open, '${p}'`);
            err.code = e.code;
            err.errno = -errnoOf(e.code);
            err.syscall = "open";
            err.path = p;
            return err;
          }
          return e instanceof Error ? e : new Error(String(e));
        }
      }
      start() {
        return this.run();
      }
    },
    WriteFileJob: class WriteFileJob {
      path;
      flags;
      mode;
      data;
      oncomplete = null;
      ondone = null;
      constructor(path, flags, mode, data) {
        this.path = path;
        this.flags = flags;
        this.mode = mode;
        this.data = data;
      }
      run(path) {
        const p = String(path ?? this.path);
        try {
          vfs.writeFile(p, this.data);
          queueMicrotask(() => this.ondone?.(null));
          return;
        } catch (e) {
          if (e instanceof VfsError) {
            const err = new Error(`${e.code}: open, '${p}'`);
            err.code = e.code;
            err.errno = -errnoOf(e.code);
            err.syscall = "open";
            err.path = p;
            return err;
          }
          return e instanceof Error ? e : new Error(String(e));
        }
      }
      start() {
        return this.run();
      }
    },
    FileHandle: class FileHandle {
      fd;
      constructor(fd) {
        this.fd = fd;
      }
      close() {
        fds.delete(this.fd);
      }
    },
    StatWatcher: class StatWatcher {
      onchange = null;
      constructor(_opts) {}
      start(_path, _bigint, _persistent, _interval) {}
      stop() {}
      ref() {}
      unref() {}
    },
    openFileHandle(path, flags, mode, reqOrPromise) {
      const openIt = () => {
        const flagsNumber = typeof flags === "number" ? flags : 0;
        return registerFd(String(path), flagsNumber | (flagsNumber === 0 ? 64 : 0));
      };
      if (reqOrPromise === kUsePromisesFlag) {
        return new Promise((resolve, reject) => {
          queueMicrotask(() => {
            try {
              const fd = openIt();
              resolve({
                fd,
                close() {
                  return new Promise((res, rej) => {
                    queueMicrotask(() => {
                      try {
                        fds.delete(fd);
                        res();
                      } catch (e) {
                        rej(e);
                      }
                    });
                  });
                }
              });
            } catch (e) {
              reject(errnoExceptionOf(e, "open", String(path)));
            }
          });
        });
      }
      if (isReq(reqOrPromise)) {
        try {
          const fd = openIt();
          queueMicrotask(() => reqOrPromise.oncomplete?.(null, fd));
        } catch (e) {
          queueMicrotask(() => reqOrPromise.oncomplete?.(uvCode(e)));
        }
        return;
      }
      return openIt();
    },
    kUsePromises: 1 << 30,
    internalModuleStat(filename) {
      try {
        const st = vfs.stat(String(filename));
        return (st.mode & 61440) === 16384 ? 1 : 0;
      } catch (e) {
        return -uvCode(e);
      }
    },
    legacyMainResolve(pkgPath, main, _base) {
      const pkgDir = vfs.normalize(String(pkgPath)).replace(/\/package\.json$/, "");
      const isFile = (p) => {
        try {
          const st = vfs.stat(p);
          return (st.mode & 61440) === 32768;
        } catch {
          return false;
        }
      };
      const hasDir = (p) => {
        try {
          return (vfs.stat(p).mode & 61440) === 16384;
        } catch {
          return false;
        }
      };
      if (main != null && main !== "") {
        const m = main.replace(/^\.\//, "");
        if (isFile(`${pkgDir}/${m}`))
          return 0;
        if (isFile(`${pkgDir}/${m}.js`))
          return 1;
        if (isFile(`${pkgDir}/${m}.json`))
          return 2;
        if (isFile(`${pkgDir}/${m}.node`))
          return 3;
        if (isFile(`${pkgDir}/${m}/index.js`))
          return 4;
        if (isFile(`${pkgDir}/${m}/index.json`))
          return 5;
        if (isFile(`${pkgDir}/${m}/index.node`))
          return 6;
        if (hasDir(`${pkgDir}/${m}`))
          return 4;
        return 0;
      }
      if (isFile(`${pkgDir}/index.json`))
        return 8;
      if (isFile(`${pkgDir}/index.node`))
        return 9;
      return 7;
    },
    getFormatOfExtensionlessFile(filePath) {
      try {
        const data = vfs.readFile(String(filePath));
        if (data.length >= 4 && data[0] === 0 && data[1] === 97 && data[2] === 115 && data[3] === 109) {
          return 1;
        }
      } catch {}
      return 0;
    }
  };
  return binding;
}

// src/packages/opencontainer/kernel/natives/fs_dir.ts
function makeFsDirBinding(ctx) {
  const makeHandle = (path) => {
    const entries = ctx.vfs.dirents(path).map((e) => [e.name, uvDirentOfHelper(e.type)]);
    let pos = 0;
    let closed = false;
    const readBatch = () => {
      if (closed)
        throw Object.assign(new Error("EBADF: bad directory handle"), { errno: -9, code: "EBADF" });
      if (pos >= entries.length)
        return null;
      const out = [];
      while (pos < entries.length) {
        const [name, type] = entries[pos++];
        out.push(name, type);
      }
      return out;
    };
    return {
      read(encoding, bufferSize, req) {
        const maybeReq = req ?? (typeof bufferSize === "object" && bufferSize !== null && "oncomplete" in bufferSize ? bufferSize : undefined);
        if (maybeReq !== undefined) {
          queueMicrotask(() => {
            try {
              maybeReq.oncomplete(null, readBatch());
            } catch (e) {
              maybeReq.oncomplete(e?.errno ?? -2);
            }
          });
          return;
        }
        return readBatch();
      },
      close(req) {
        closed = true;
        if (req !== undefined && typeof req.oncomplete === "function") {
          queueMicrotask(() => req.oncomplete(null));
        }
      }
    };
  };
  return {
    opendir(path, _encoding, req) {
      if (req !== undefined && typeof req.oncomplete === "function") {
        queueMicrotask(() => {
          try {
            req.oncomplete(null, makeHandle(String(path)));
          } catch (e) {
            req.oncomplete(e?.errno ?? -2);
          }
        });
        return;
      }
      return makeHandle(String(path));
    },
    opendirSync(path) {
      return makeHandle(String(path));
    }
  };
}

// src/packages/opencontainer/kernel/natives/fs_event.ts
function makeFsEventBinding(ctx) {
  const watchers = new Map;
  let nextId = 1;
  const FSEvent = class FSEvent2 {
    onchange = null;
    _id = 0;
    constructor(path, _req, _persistent) {
      if (path !== undefined)
        this.watch(String(path));
    }
    watch(path) {
      const id = nextId++;
      const hostWatcher = ctx.vfs.watch(path, (event) => {
        this.onchange?.(0, event.type, event.filename);
      });
      watchers.set(id, hostWatcher);
      this._id = id;
    }
    start(path, _persistent) {
      this.watch(String(path));
    }
    close() {
      const w = watchers.get(this._id);
      w?.close();
      watchers.delete(this._id);
    }
    ref() {}
    unref() {}
  };
  return {
    FSEvent,
    FSWatcher: FSEvent
  };
}

// src/packages/opencontainer/kernel/natives/buffer.ts
function makeBufferBinding() {
  const enc = new TextEncoder;
  const dec = new TextDecoder;
  function normalizeEncodingName(encoding) {
    if (encoding == null)
      return "utf8";
    if (typeof encoding !== "string")
      return;
    const lower = encoding.toLowerCase().replace(/[-_]/g, "");
    switch (lower) {
      case "utf8":
        return "utf8";
      case "ucs2":
      case "utf16le":
        return "utf16le";
      case "latin1":
      case "binary":
        return "latin1";
      case "ascii":
        return "ascii";
      case "base64":
        return "base64";
      case "base64url":
        return "base64url";
      case "hex":
        return "hex";
      default:
        return;
    }
  }
  function lenientBase64Decode(str, alphabet) {
    const out = [];
    let bits = 0, acc = 0;
    for (let i = 0;i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (alphabet === "base64url" && c === 45)
        c = 43;
      if (alphabet === "base64url" && c === 95)
        c = 47;
      if (c === 61)
        break;
      let v;
      if (c >= 65 && c <= 90)
        v = c - 65;
      else if (c >= 97 && c <= 122)
        v = c - 97 + 26;
      else if (c >= 48 && c <= 57)
        v = c - 48 + 52;
      else if (c === 43)
        v = 62;
      else if (c === 47)
        v = 63;
      else
        continue;
      acc = acc << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(acc >>> bits & 255);
      }
    }
    return Uint8Array.from(out);
  }
  function encodeString(str, encName) {
    switch (encName) {
      case "utf8":
        return enc.encode(str);
      case "utf16le": {
        const out = new Uint8Array(str.length * 2);
        for (let i = 0;i < str.length; i++) {
          const c = str.charCodeAt(i);
          out[i * 2] = c & 255;
          out[i * 2 + 1] = c >> 8 & 255;
        }
        return out;
      }
      case "latin1": {
        const out = new Uint8Array(str.length);
        for (let i = 0;i < str.length; i++)
          out[i] = str.charCodeAt(i) & 255;
        return out;
      }
      case "ascii": {
        const out = new Uint8Array(str.length);
        for (let i = 0;i < str.length; i++)
          out[i] = str.charCodeAt(i) & 127;
        return out;
      }
      case "hex": {
        if (str.length % 2 !== 0)
          return null;
        const out = new Uint8Array(str.length >> 1);
        for (let i = 0;i < out.length; i++) {
          const hi = hexVal(str.charCodeAt(i * 2));
          const lo = hexVal(str.charCodeAt(i * 2 + 1));
          if (hi < 0 || lo < 0)
            return null;
          out[i] = hi << 4 | lo;
        }
        return out;
      }
      case "base64":
        return lenientBase64Decode(str, "base64");
      case "base64url":
        return lenientBase64Decode(str, "base64url");
      default:
        return null;
    }
  }
  function hexVal(c) {
    if (c >= 48 && c <= 57)
      return c - 48;
    if (c >= 65 && c <= 70)
      return c - 65 + 10;
    if (c >= 97 && c <= 102)
      return c - 97 + 10;
    return -1;
  }
  const ENCODING_VAL = {
    0: "ascii",
    1: "utf8",
    2: "base64",
    3: "base64url",
    4: "utf16le",
    5: "hex",
    6: "buffer",
    7: "latin1"
  };
  function memIndexOf(source, needle, byteOffset, dir, end) {
    const srcLen = source.length;
    const ndlLen = needle.length;
    const effEnd = Math.max(0, Math.min(end, srcLen));
    let start = byteOffset < 0 ? byteOffset + srcLen : byteOffset;
    if (dir) {
      if (start < 0)
        start = 0;
      else if (start > srcLen)
        start = srcLen;
      outer:
        for (let i = start;i + ndlLen <= effEnd; i++) {
          for (let j = 0;j < ndlLen; j++)
            if (source[i + j] !== needle[j])
              continue outer;
          return i;
        }
      return -1;
    }
    if (start < 0)
      return -1;
    if (start > srcLen - ndlLen)
      start = srcLen - ndlLen;
    outer:
      for (let i = start;i >= 0; i--) {
        if (i + ndlLen > effEnd)
          continue;
        for (let j = 0;j < ndlLen; j++)
          if (source[i + j] !== needle[j])
            continue outer;
        return i;
      }
    return -1;
  }
  function strictUtf8Valid(bytes) {
    const len = bytes.length;
    let i = 0;
    const cont = (b) => b >= 128 && b <= 191;
    while (i < len) {
      const b = bytes[i];
      if (b < 128) {
        i++;
        continue;
      }
      if (b < 194)
        return false;
      if (b < 224) {
        if (!cont(bytes[i + 1]))
          return false;
        i += 2;
        continue;
      }
      if (b < 240) {
        const lo = b === 224 ? 160 : b === 237 ? 128 : 128;
        const hi = b === 224 ? 191 : b === 237 ? 159 : 191;
        const b1 = bytes[i + 1];
        if (b1 < lo || b1 > hi || !cont(bytes[i + 2]))
          return false;
        i += 3;
        continue;
      }
      if (b < 245) {
        const lo = b === 240 ? 144 : b === 244 ? 128 : 128;
        const hi = b === 240 ? 191 : b === 244 ? 143 : 191;
        const b1 = bytes[i + 1];
        if (b1 < lo || b1 > hi || !cont(bytes[i + 2]) || !cont(bytes[i + 3]))
          return false;
        i += 4;
        continue;
      }
      return false;
    }
    return true;
  }
  function utf16LengthUtf8(bytes) {
    const len = bytes.length;
    let units = 0, i = 0;
    const cont = (b) => b >= 128 && b <= 191;
    while (i < len) {
      const b = bytes[i];
      if (b < 128) {
        units++;
        i++;
        continue;
      }
      if (b >= 194 && b < 224 && cont(bytes[i + 1])) {
        units++;
        i += 2;
        continue;
      }
      if (b >= 224 && b < 240 && cont(bytes[i + 1]) && cont(bytes[i + 2])) {
        const ok = (b !== 224 || bytes[i + 1] >= 160) && (b !== 237 || bytes[i + 1] <= 159);
        if (ok) {
          units++;
          i += 3;
          continue;
        }
      }
      if (b >= 240 && b < 245 && cont(bytes[i + 1]) && cont(bytes[i + 2]) && cont(bytes[i + 3])) {
        const ok = (b !== 240 || bytes[i + 1] >= 144) && (b !== 244 || bytes[i + 1] <= 143);
        if (ok) {
          units += 2;
          i += 4;
          continue;
        }
      }
      units++;
      i++;
    }
    return units;
  }
  function b64EncodeBytes(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0;i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += chars[b0 >> 2];
      out += chars[(b0 & 3) << 4 | (b1 ?? 0) >> 4];
      out += b1 === undefined ? "=" : chars[(b1 & 15) << 2 | (b2 ?? 0) >> 6];
      out += b2 === undefined ? "=" : chars[b2 & 63];
    }
    return out;
  }
  function btoaImpl(data) {
    for (let i = 0;i < data.length; i++) {
      if (data.charCodeAt(i) > 255)
        return -1;
    }
    const bytes = new Uint8Array(data.length);
    for (let i = 0;i < data.length; i++)
      bytes[i] = data.charCodeAt(i);
    return b64EncodeBytes(bytes);
  }
  function isB64Alphabet(c) {
    return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47;
  }
  function isAsciiWhitespace(c) {
    return c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
  }
  function atobImpl(data) {
    let stripped = "";
    for (let i = 0;i < data.length; i++) {
      const c = data.charCodeAt(i);
      if (!isAsciiWhitespace(c))
        stripped += String.fromCharCode(c);
    }
    const len = stripped.length;
    if (len === 0)
      return "";
    let pads = 0;
    while (pads < len && stripped.charCodeAt(len - 1 - pads) === 61)
      pads++;
    if (pads > 2)
      return -2;
    const dataLen = len - pads;
    for (let i = 0;i < dataLen; i++) {
      if (!isB64Alphabet(stripped.charCodeAt(i)))
        return -2;
    }
    if (dataLen % 4 === 1)
      return -1;
    if (pads === 1 && dataLen % 4 !== 3)
      return -2;
    if (pads === 2 && dataLen % 4 !== 2)
      return -2;
    const out = new Uint8Array(Math.floor(dataLen * 6 / 8));
    let bits = 0, acc = 0, oi = 0;
    for (let i = 0;i < dataLen; i++) {
      const c = stripped.charCodeAt(i);
      let v;
      if (c >= 65 && c <= 90)
        v = c - 65;
      else if (c >= 97 && c <= 122)
        v = c - 97 + 26;
      else if (c >= 48 && c <= 57)
        v = c - 48 + 52;
      else if (c === 43)
        v = 62;
      else
        v = 63;
      acc = acc << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[oi++] = acc >>> bits & 255;
      }
    }
    let bin = "";
    for (let i = 0;i < out.length; i++)
      bin += String.fromCharCode(out[i]);
    return bin;
  }
  function hexWrite(buf, str, offset) {
    const bytes = str.length >> 1;
    for (let i = 0;i < bytes; i++) {
      const b = Number.parseInt(str.substr(i * 2, 2), 16);
      buf[offset + i] = b;
    }
    return bytes;
  }
  function hexSlice(buf, start, end) {
    const len = (end - start) * 2;
    let out = "";
    for (let i = start;i < end; i++) {
      const h = buf[i].toString(16).padStart(2, "0");
      out += h;
    }
    return out;
  }
  function base64UrlSlice(buf, start, end) {
    return btoaSlice(buf, start, end).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function base64UrlWrite(buf, str, offset) {
    const norm = str.replace(/-/g, "+").replace(/_/g, "/");
    return base64WriteFn(buf, norm, offset);
  }
  function base64WriteFn(buf, str, offset) {
    const bin = atob(str);
    for (let i = 0;i < bin.length; i++)
      buf[offset + i] = bin.charCodeAt(i);
    return bin.length;
  }
  function btoaSlice(buf, start, end) {
    let s = "";
    for (let i = start;i < end; i++)
      s += String.fromCharCode(buf[i]);
    return btoa(s);
  }
  function bytesOf(input) {
    return input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  }
  return {
    kMaxLength: 2 ** 31 - 1,
    kStringMaxLength: 2 ** 29 - 24,
    arrayBufferAlignedOffset(view) {
      return view.byteOffset;
    },
    createUnsafeArrayBuffer(size) {
      return new ArrayBuffer(size);
    },
    setDetachKey() {},
    byteLength(str, encoding) {
      return enc.encode(str).byteLength;
    },
    byteLengthUtf8(str) {
      return enc.encode(str).byteLength;
    },
    copy(source, target, targetStart, sourceStart, nb) {
      const bySource = source.length - sourceStart;
      const byTarget = target.length - targetStart;
      const n = Math.max(0, Math.min(nb, bySource, byTarget));
      if (n > 0)
        target.set(source.subarray(sourceStart, sourceStart + n), targetStart);
      return n;
    },
    fill(buf, value, offset, end, encoding) {
      if (end === undefined || end === null || end > buf.length)
        end = buf.length;
      if (offset === undefined || offset === null || offset < 0)
        offset = 0;
      if (offset >= end)
        return -2;
      let pattern;
      if (typeof value === "string") {
        const name = normalizeEncodingName(encoding);
        if (name === undefined)
          return -1;
        pattern = encodeString(value, name);
      } else if (ArrayBuffer.isView(value)) {
        pattern = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else {
        return -1;
      }
      if (pattern === null || pattern.length === 0)
        return -1;
      const plen = pattern.length;
      for (let i = offset;i < end; i++)
        buf[i] = pattern[(i - offset) % plen];
      return;
    },
    compareOffset(source, target, targetStart, sourceStart, targetEnd, sourceEnd) {
      const tEnd = Math.min(targetEnd, target.length);
      const sEnd = Math.min(sourceEnd, source.length);
      const tStart = Math.max(0, Math.min(targetStart, tEnd));
      const sStart = Math.max(0, Math.min(sourceStart, sEnd));
      const tLen = tEnd - tStart;
      const sLen = sEnd - sStart;
      const n = Math.min(tLen, sLen);
      for (let i = 0;i < n; i++) {
        const a = source[sStart + i], b = target[tStart + i];
        if (a !== b)
          return a < b ? -1 : 1;
      }
      if (sLen === tLen)
        return 0;
      return sLen < tLen ? -1 : 1;
    },
    indexOfNumber(source, val, byteOffset, dir, end) {
      const needle = Uint8Array.of(val >>> 0 & 255);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },
    indexOfString(source, val, byteOffset, encodingVal, dir, end) {
      const name = ENCODING_VAL[encodingVal] ?? "utf8";
      const needle = encodeString(val, name) ?? enc.encode(val);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },
    indexOfBuffer(source, val, byteOffset, encodingVal, dir, end) {
      const needle = ArrayBuffer.isView(val) ? new Uint8Array(val.buffer, val.byteOffset, val.byteLength) : Uint8Array.of(val >>> 0);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },
    isAscii(input) {
      const bytes = bytesOf(input);
      for (let i = 0;i < bytes.length; i++)
        if (bytes[i] > 127)
          return false;
      return true;
    },
    isUtf8(input) {
      return strictUtf8Valid(bytesOf(input));
    },
    isLatin1(input) {
      for (let i = 0;i < input.length; i++) {
        if (input.charCodeAt(i) > 255)
          return false;
      }
      return true;
    },
    stringLengthUtf8(input) {
      return utf16LengthUtf8(bytesOf(input));
    },
    atob: atobImpl,
    btoa: btoaImpl,
    mask(source, output, offset, length, maskValue) {
      const src = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      const dst = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
      const m0 = maskValue & 255, m1 = maskValue >>> 8 & 255, m2 = maskValue >>> 16 & 255, m3 = maskValue >>> 24 & 255;
      for (let i = 0;i < length; i++) {
        dst[offset + i] = src[i] ^ (i % 4 === 0 ? m0 : i % 4 === 1 ? m1 : i % 4 === 2 ? m2 : m3);
      }
      return true;
    },
    copyArrayBuffer(dest, destOffset, source, sourceOffset, length) {
      if (length <= 0)
        return;
      const src = new Uint8Array(source, Math.max(0, Math.min(sourceOffset, source.byteLength)));
      const dst = new Uint8Array(dest, Math.max(0, Math.min(destOffset, dest.byteLength)));
      const n = Math.min(src.length, dst.length, Math.max(0, length));
      if (n > 0)
        dst.set(src.subarray(0, n));
    },
    btoaEncode(data) {
      let s = "";
      for (let i = 0;i < data.length; i++)
        s += String.fromCharCode(data[i]);
      return btoa(s);
    },
    btoaDecode(data, out) {
      const bin = atob(data);
      for (let i = 0;i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
      return bin.length;
    },
    compare(a, b) {
      const n = Math.min(a.length, b.length);
      for (let i = 0;i < n; i++)
        if (a[i] !== b[i])
          return a[i] < b[i] ? -1 : 1;
      return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
    },
    indexOf(source, target, from, forward = true) {
      if (forward) {
        outer:
          for (let i = from;i <= source.length - target.length; i++) {
            for (let j = 0;j < target.length; j++)
              if (source[i + j] !== target[j])
                continue outer;
            return i;
          }
        return -1;
      }
      outer:
        for (let i = Math.min(from, source.length - target.length);i >= 0; i--) {
          for (let j = 0;j < target.length; j++)
            if (source[i + j] !== target[j])
              continue outer;
          return i;
        }
      return -1;
    },
    latin1Slice(buf, start, end) {
      let s = "";
      for (let i = start;i < end; i++)
        s += String.fromCharCode(buf[i]);
      return s;
    },
    latin1Write(buf, str, offset) {
      for (let i = 0;i < str.length; i++)
        buf[offset + i] = str.charCodeAt(i) & 255;
      return str.length;
    },
    asciiSlice(buf, start, end) {
      let s = "";
      for (let i = start;i < end; i++)
        s += String.fromCharCode(buf[i] & 127);
      return s;
    },
    asciiWrite(buf, str, offset) {
      for (let i = 0;i < str.length; i++)
        buf[offset + i] = str.charCodeAt(i) & 127;
      return str.length;
    },
    base64Slice: btoaSlice,
    base64urlSlice: base64UrlSlice,
    hexSlice,
    base64Write: base64WriteFn,
    base64urlWrite: base64UrlWrite,
    hexWrite,
    asciiWriteStatic(buf, str, offset) {
      for (let i = 0;i < str.length; i++)
        buf[offset + i] = str.charCodeAt(i) & 127;
      return str.length;
    },
    latin1WriteStatic(buf, str, offset) {
      for (let i = 0;i < str.length; i++)
        buf[offset + i] = str.charCodeAt(i) & 255;
      return str.length;
    },
    utf8WriteStatic(buf, str, offset) {
      const bytes = enc.encode(str);
      buf.set(bytes, offset);
      return bytes.byteLength;
    },
    ucs2Slice(buf, start, end) {
      return new TextDecoder("utf-16le").decode(buf.subarray(start, end));
    },
    ucs2Write(buf, str, offset) {
      let written = 0;
      for (let i = 0;i < str.length; i++) {
        const c = str.charCodeAt(i);
        buf[offset + written++] = c & 255;
        buf[offset + written++] = c >> 8 & 255;
      }
      return written;
    },
    utf8Slice(buf, start, end) {
      return dec.decode(buf.subarray(start, end));
    },
    utf8Write(buf, str, offset) {
      const bytes = enc.encode(str);
      buf.set(bytes, offset);
      return bytes.byteLength;
    },
    swap16(b) {
      swapN(b, 2);
    },
    swap32(b) {
      swapN(b, 4);
    },
    swap64(b) {
      swapN(b, 8);
    }
  };
}
function swapN(buf, n) {
  for (let i = 0;i + n <= buf.length; i += n) {
    for (let j = 0;j < n / 2; j++) {
      const a = buf[i + j];
      buf[i + j] = buf[i + n - 1 - j];
      buf[i + n - 1 - j] = a;
    }
  }
}

// src/packages/opencontainer/kernel/natives/shared-symbols.ts
var registry2 = new Map;
function sharedSymbol(name) {
  let s = registry2.get(name);
  if (!s) {
    s = Symbol(name);
    registry2.set(name, s);
  }
  return s;
}
var hostDefinedOptionSymbol = sharedSymbol("nodejs.util.host_defined_options");
var contextifyContextPrivateSymbol = sharedSymbol("nodejs.contextify.context");

// src/packages/opencontainer/kernel/natives/util.ts
function makeUtilBinding() {
  const hidden = new WeakMap;
  const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
  function isCanonicalIndex(p) {
    if (!INDEX_RE.test(p))
      return false;
    return p.length < 10 || Number(p) < 2 ** 32 - 1;
  }
  const shouldAbortOnUncaughtToggle = new Int32Array(1);
  const privateSymbols = {
    arrow_message_private_symbol: Symbol("nodejs.util.arrow_message"),
    decorated_private_symbol: Symbol("nodejs.util.decorated"),
    error_context_symbol: Symbol("nodejs.util.error_context"),
    maybe_error_position_symbol: Symbol("nodejs.util.maybe_error_position"),
    no_side_effects_symbol: Symbol("nodejs.util.no_side_effects"),
    host_defined_option_symbol: hostDefinedOptionSymbol,
    contextify_context_private_symbol: contextifyContextPrivateSymbol,
    exit_info_private_symbol: Symbol("nodejs.exit_info"),
    entry_point_promise_private_symbol: Symbol("nodejs.entry_point_promise"),
    module_source_private_symbol: Symbol("nodejs.module.module_source"),
    module_export_names_private_symbol: Symbol("nodejs.module.module_export_names"),
    module_circular_visited_private_symbol: Symbol("nodejs.module.module_circular_visited"),
    module_export_private_symbol: Symbol("nodejs.module.module_export"),
    module_first_parent_private_symbol: Symbol("nodejs.module.module_first_parent"),
    module_last_parent_private_symbol: Symbol("nodejs.module.module_last_parent"),
    source_map_data_private_symbol: Symbol("nodejs.source_map_data"),
    transfer_mode_private_symbol: Symbol("nodejs.transfer_mode"),
    untransferable_object_private_symbol: Symbol("nodejs.untransferable_object")
  };
  return {
    privateSymbols,
    shouldAbortOnUncaughtToggle,
    defineLazyProperties(target, id, keys, esm) {
      const realmRequire = () => globalThis.__ocRealmRequire;
      for (const key of keys) {
        Object.defineProperty(target, key, {
          __proto__: null,
          configurable: true,
          enumerable: true,
          get() {
            const req = realmRequire();
            const mod = req ? req(id) : undefined;
            const value = mod?.[key];
            Object.defineProperty(target, key, {
              __proto__: null,
              configurable: true,
              enumerable: true,
              writable: true,
              value
            });
            return value;
          },
          set(value) {
            Object.defineProperty(target, key, {
              __proto__: null,
              configurable: true,
              enumerable: true,
              writable: true,
              value
            });
          }
        });
      }
    },
    constructSharedArrayBuffer(size) {
      try {
        return new SharedArrayBuffer(size);
      } catch {
        return new ArrayBuffer(size);
      }
    },
    testEnabled(set) {
      try {
        const env = globalThis.__ocEnv?.() ?? {};
        const debug = env.NODE_DEBUG ?? "";
        const debugNative = env.NODE_DEBUG_NATIVE ?? "";
        return new RegExp(`(?:^|,)${set}(?:,|$)`).test(debug) || new RegExp(`(?:^|,)${set}(?:,|$)`).test(debugNative);
      } catch {
        return false;
      }
    },
    guessHandleType(fd) {
      const mode = globalThis.__ocStdio?.[fd];
      if (mode?.type === "pipe")
        return 4;
      if (mode?.type === "ignore")
        return 5;
      if (mode?.type === "tty")
        return 1;
      return fd >= 0 && fd <= 2 ? 1 : 5;
    },
    constants: {
      ALL_PROPERTIES: 0,
      ONLY_WRITABLE: 1,
      ONLY_ENUMERABLE: 2,
      ONLY_CONFIGURABLE: 3,
      SKIP_STRINGS: 4,
      SKIP_SYMBOLS: 5,
      kPending: 0,
      kFulfilled: 1,
      kRejected: 2
    },
    getOwnNonIndexProperties(obj, _filter) {
      const out = [];
      try {
        const names = Object.getOwnPropertyNames(obj);
        for (const p of names) {
          if (isCanonicalIndex(p))
            continue;
          out.push(p);
        }
        for (const p of Object.getOwnPropertySymbols(obj))
          out.push(p);
      } catch {}
      return out;
    },
    getHiddenValue(inst, key) {
      return hidden.get(inst)?.get(key);
    },
    setHiddenValue(inst, key, value) {
      if (value === undefined) {
        hidden.get(inst)?.delete(key);
        return true;
      }
      if (!hidden.has(inst))
        hidden.set(inst, new Map);
      hidden.get(inst).set(key, value);
      return true;
    },
    getProxyDetails(obj) {
      try {
        if (obj && typeof obj === "object" && obj.constructor?.name === "Proxy...")
          return;
      } catch {}
      try {
        const desc = Object.getOwnPropertyDescriptor(obj, "then");
      } catch {
        return;
      }
      return;
    },
    getConstructorName(obj) {
      try {
        return obj?.constructor?.name ?? "";
      } catch {
        return "";
      }
    },
    getExternalValue() {
      return { data: 0, size: 0 };
    },
    getPromiseDetails(p) {
      if (!p || typeof p.then !== "function")
        return;
      const details = promiseDetailsMap.get(p);
      if (details)
        return details;
      p.then((v) => {
        promiseDetailsMap.set(p, { 0: 1, 1: v });
      }, (e) => {
        promiseDetailsMap.set(p, { 0: 2, 1: e });
      });
      return { 0: 0 };
    },
    previewEntries(iterator) {
      if (!iterator || typeof iterator !== "object")
        return;
      try {
        if (typeof iterator.next !== "function")
          return;
        const entries = [];
        let isKeyValue = false;
        for (let i = 0;i < 100; i++) {
          const r = iterator.next();
          if (r?.done)
            break;
          const v = r.value;
          if (Array.isArray(v)) {
            isKeyValue = true;
            entries.push([v[0], v[1]]);
          } else
            entries.push(v);
        }
        return [entries, isKeyValue];
      } catch {
        return;
      }
    },
    isInsideNodeModules() {
      return false;
    },
    getCallSites(_err, _count) {
      return [];
    },
    getCallerLocation() {
      return;
    },
    markPromiseAsHandled(_p) {},
    getSharedArrayBufferGrowable(_sab) {
      return false;
    },
    parseEnv(env) {
      const out = {};
      for (const line of String(env).split(`
`)) {
        const m = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m)
          continue;
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
          v = v.slice(1, -1);
        }
        out[m[1]] = v;
      }
      return out;
    },
    enqueueDeprecationWarning() {},
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    getCwdSafe() {
      try {
        return globalThis.__ocCwd?.() ?? undefined;
      } catch {
        return;
      }
    }
  };
}
var promiseDetailsMap = new WeakMap;

// src/packages/opencontainer/kernel/natives/options.ts
function makeOptionsBinding(ctx) {
  const defaults = {
    "--eval": "",
    "--print": false,
    "--input-type": undefined,
    "--interactive": false,
    "--inspect": false,
    "--inspect-brk": false,
    "--experimental-strip-types": true,
    "--strip-types": true,
    "--experimental-transform-types": false,
    "--import": [],
    "--experimental-loader": [],
    "--experimental-network-imports": false,
    "--no-experimental-global-webcrypto": false,
    "--no-experimental-global-navigator": false,
    "--frozen-intrinsics": false,
    "--redirect-warnings": undefined,
    "--stack-trace-limit": 10,
    "--perf-basic-prof": false,
    "--title": "node",
    "--conditions": [],
    "--experimental-require-module": true,
    "--experimental-default-type": undefined,
    "--experimental-repl-await": true,
    "--experimental-detect-module": true,
    "--require-module": true,
    "--experimental-vm-modules": false,
    "--warnings": true,
    "--enable-source-maps": false,
    "--dns-result-order": "",
    "--vfs-load": "",
    "--unhandled-rejections": "throw",
    "--user-agent": "node",
    "--heapsnapshot-signal": "",
    "--preserve-symlinks": false,
    "--preserve-symlinks-main": false,
    "--no-addons": false,
    "--entry-url": false,
    "[has_eval_string]": false,
    "[no_force_repl]": false,
    "[has_inspector]": false
  };
  return {
    getOptionValue(opt) {
      if (ctx.options.has(opt))
        return ctx.options.get(opt);
      return defaults[opt] ?? undefined;
    },
    getCLIOptionsInfo() {
      return {};
    },
    getCLIOptionsValues() {
      const out = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (Array.isArray(v))
          out[k] = [];
        else
          out[k] = v;
      }
      for (const [k, v] of ctx.options.entries()) {
        out[k] = v;
      }
      return out;
    },
    getCLIOptionsValuesWithSource() {
      return {};
    },
    getOptionsAsFlags() {
      return [];
    },
    getEnvOptionsInputType() {
      return "no-options";
    },
    getNamespaceOptionsInputType() {
      return "no-options";
    },
    parseNodeOptionsEnvVar() {
      return { value: "", warnings: [] };
    },
    getEmbedderOptions() {
      return {
        shouldNotRegisterESMLoader: false,
        globalServicing: false,
        shouldExitOnUncaughtException: false,
        noGlobalSearchPaths: false,
        compileSnapshotAsMainModule: false,
        hasInspector: false,
        hasEmbedderPreload: false,
        noBrowserGlobals: false
      };
    },
    getOptionValueFromString: undefined,
    getOptions() {
      return { options: {} };
    },
    shouldNotRegisterESMLoader: false
  };
}

// src/packages/opencontainer/kernel/natives/builtins.ts
function makeBuiltinsBinding() {
  const allIds = [...PUBLIC_BUILTINS, ...INTERNAL_BUILTINS];
  return {
    builtinIds: allIds,
    canBeRequiredByUsers: PUBLIC_BUILTINS,
    canBeRequiredWithoutSuffix: PUBLIC_BUILTINS.filter((id) => !id.includes("/")),
    getBuiltinCategories: () => ({ canBeRequiredByUsers: PUBLIC_BUILTINS, cannotBeRequiredByUsers: INTERNAL_BUILTINS }),
    getBuiltinModule(id) {
      return;
    },
    definedExportNames: () => [],
    setInternalLoaders(internalBinding, requireBuiltin) {
      globalThis.__ocRealmRequire = requireBuiltin;
    },
    compileFunction(id) {
      const g = globalThis;
      if (!g.__ocLoadedModules)
        g.__ocLoadedModules = new Set;
      g.__ocLoadedModules.add(id);
      const file = resolveModuleFileForCompile(id);
      if (file === null) {
        const e = new Error(`Cannot find module '${id}'`);
        e.code = "MODULE_NOT_FOUND";
        throw e;
      }
      const src = getSourceForCompile(file);
      if (src === undefined) {
        throw new Error(`OpenContainer: builtins.compileFunction source unavailable for '${id}' (store not wired yet)`);
      }
      return new Function("exports", "require", "module", "process", "internalBinding", "primordials", `'use strict';
${src}
//# sourceURL=opencontainer://${id}`);
    }
  };
}
var resolveModuleFileForCompile = () => null;
var getSourceForCompile = () => {
  return;
};
function wireBuiltinCompile(resolve, getSource) {
  resolveModuleFileForCompile = resolve;
  getSourceForCompile = getSource;
}

// src/packages/opencontainer/kernel/natives/modules.ts
function tupleFrom(jsonPath, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  const name = typeof parsed.name === "string" ? parsed.name : undefined;
  const main = typeof parsed.main === "string" ? parsed.main : undefined;
  const type = parsed.type === "module" || parsed.type === "commonjs" ? parsed.type : undefined;
  const plainImports = parsed.imports === undefined || parsed.imports === null ? null : typeof parsed.imports === "string" ? parsed.imports : JSON.stringify(parsed.imports);
  const plainExports = parsed.exports === undefined || parsed.exports === null ? null : typeof parsed.exports === "string" ? parsed.exports : JSON.stringify(parsed.exports);
  return [name, main, type, plainImports, plainExports, jsonPath];
}
function makeModulesBinding(ctx) {
  const vfs = ctx.vfs;
  function dirOf(p) {
    const norm = vfs.normalize(p);
    const i = norm.lastIndexOf("/");
    if (i <= 0)
      return "/";
    return norm.slice(0, i);
  }
  function walkNearest(startDir) {
    let dir = vfs.normalize(startDir);
    for (let hops = 0;hops < 128; hops++) {
      const candidate = dir === "/" ? "/package.json" : `${dir}/package.json`;
      if (vfs.exists(candidate)) {
        try {
          const text = vfs.readTextFile(candidate);
          const tuple = tupleFrom(candidate, text);
          if (tuple !== undefined)
            return { dir, tuple };
        } catch {}
      }
      if (dir === "/")
        break;
      const parent = dirOf(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
    return { dir: null, tuple: undefined };
  }
  const scopeCache = new Map;
  function nearestFor(checkPath) {
    const norm = vfs.normalize(checkPath);
    const start = vfs.isDirectory(norm) ? norm : dirOf(norm);
    const key = start;
    let hit = scopeCache.get(key);
    if (hit === undefined) {
      hit = walkNearest(start);
      scopeCache.set(key, hit);
    }
    return hit;
  }
  return {
    enableCompileCache: () => ({ enabled: false, status: 2, message: "", directory: "" }),
    getCompileCacheDir: () => "",
    compileCacheStatus: ["ENABLED", "FAILED", "DISABLED"],
    flushCompileCache: () => {},
    kEmbedder: 1,
    kInternal: 2,
    kUser: 3,
    kESMSource: Symbol("nodejs.module.esm_source"),
    kRequiredModule: Symbol("nodejs.module.required_module"),
    kIsExecuting: Symbol("nodejs.module.is_executing"),
    kURL: Symbol("nodejs.module.url"),
    kModuleSource: Symbol("nodejs.module.source"),
    kModuleExport: Symbol("nodejs.module.export"),
    kModuleExportNames: Symbol("nodejs.module.export_names"),
    kModuleCircularVisited: Symbol("nodejs.module.circular_visited"),
    kFormat: Symbol("nodejs.module.format"),
    cachedCodeTypes: {
      kCommonJS: 0,
      kESM: 1,
      kStrippedTypeScript: 2
    },
    getCompileCacheEntry() {
      return;
    },
    saveCompileCacheEntry() {},
    compileFunction(options) {
      return;
    },
    stripShebang: (shebang) => shebang.replace(/^#!.*/, (m) => " ".repeat(m.length)),
    moduleSourceMapInfo() {
      return;
    },
    source_map_cache_() {
      return;
    },
    sourceTextModuleRundown: undefined,
    readPackageJSON(jsonPath, _isESM, _base, _specifier) {
      try {
        const text = vfs.readTextFile(vfs.normalize(jsonPath));
        return tupleFrom(vfs.normalize(jsonPath), text);
      } catch {
        return;
      }
    },
    getNearestParentPackageJSON(checkPath) {
      return nearestFor(checkPath).tuple;
    },
    getNearestParentPackageJSONType(checkPath) {
      const { tuple } = nearestFor(checkPath);
      return tuple?.[2];
    },
    getPackageScopeConfig(resolved) {
      const norm = vfs.normalize(String(resolved).replace(/^file:\/\//, ""));
      const { dir, tuple } = nearestFor(norm);
      if (dir === null) {
        return "/package.json";
      }
      return tuple;
    },
    getPackageType(url) {
      const norm = vfs.normalize(String(url).replace(/^file:\/\//, ""));
      return nearestFor(norm).tuple?.[2];
    },
    parsePackageJSON(_jsonPath, _isESM, _base, _specifier) {
      return;
    },
    moduleFormats: {
      commonjs: { source: "module" }
    }
  };
}

// src/packages/opencontainer/kernel/natives/url.ts
function makeUrlPatternBinding() {
  return {
    URLPattern: globalThis.URLPattern ?? class URLPattern {
      constructor(...args) {
        throw new Error("URLPattern is not supported in this browser");
      }
    }
  };
}
var OMITTED = 4294967295;
var SCHEME_TYPES = {
  "http:": 0,
  "https:": 2,
  "ws:": 3,
  "ftp:": 4,
  "wss:": 5,
  "file:": 6
};
function computeComponents(href, u) {
  const c = new Array(9).fill(OMITTED);
  c[0] = href.indexOf(":") + 1;
  const afterAuth = c[0] + 2;
  let hostStart = afterAuth;
  const at = href.indexOf("@", afterAuth);
  const slash = href.indexOf("/", afterAuth);
  const q = href.indexOf("?", afterAuth);
  const h = href.indexOf("#", afterAuth);
  const limits = [slash, q, h].filter((i) => i !== -1);
  const authEnd = limits.length ? Math.min(...limits) : href.length;
  if (at !== -1 && at < authEnd) {
    c[1] = at + 1;
    hostStart = at + 1;
  } else {
    c[1] = afterAuth;
  }
  c[2] = hostStart;
  const colon = href.indexOf(":", hostStart);
  const hostEnd = colon !== -1 && colon < authEnd ? colon : authEnd;
  c[3] = hostEnd;
  if (u.port) {
    c[4] = Number(u.port);
  } else {
    c[4] = OMITTED;
  }
  if (u.pathname) {
    c[5] = href.indexOf(u.pathname, Math.max(hostEnd, hostStart));
    if (c[5] === -1)
      c[5] = OMITTED;
  } else {
    c[5] = hostEnd;
  }
  const searchIdx = href.indexOf("?");
  c[6] = searchIdx === -1 ? OMITTED : searchIdx;
  const hashIdx = href.indexOf("#");
  c[7] = hashIdx === -1 ? OMITTED : hashIdx;
  c[8] = SCHEME_TYPES[u.protocol] ?? 1;
  return c;
}
function makeUrlBinding() {
  const urlComponents = new Array(9).fill(0);
  return {
    URL,
    urlComponents,
    parse(input, base, raiseException) {
      try {
        const u = base !== undefined && base !== null && base !== false ? new URL(input, String(base)) : new URL(input);
        const href = u.href;
        const c = computeComponents(href, u);
        for (let i = 0;i < 9; i++)
          urlComponents[i] = c[i];
        return href;
      } catch (e) {
        if (globalThis.__ocUrlDebug) {
          globalThis.__ocUrlDebug({
            input: typeof input === "string" ? input.slice(0, 120) : String(input),
            baseType: typeof base,
            base: typeof base === "object" && base !== null ? `URL-ctor:${base?.constructor?.name} toString:${(() => {
              try {
                return String(base).slice(0, 120);
              } catch (err) {
                return "THREW:" + err.message;
              }
            })()}` : String(base),
            err: e?.message
          });
        }
        if (raiseException === true)
          throw e;
        return;
      }
    },
    update(href, action, value) {
      try {
        const u = new URL(href);
        switch (action) {
          case 0:
            u.protocol = value;
            break;
          case 1:
            u.host = value;
            break;
          case 2:
            u.hostname = value;
            break;
          case 3:
            u.port = value;
            break;
          case 4:
            u.username = value;
            break;
          case 5:
            u.password = value;
            break;
          case 6:
            u.pathname = value;
            break;
          case 7:
            u.search = value;
            break;
          case 8:
            u.hash = value;
            break;
          case 9: {
            const u2 = new URL(value);
            const c2 = computeComponents(u2.href, u2);
            for (let i = 0;i < 9; i++)
              urlComponents[i] = c2[i];
            return u2.href;
          }
        }
        const c = computeComponents(u.href, u);
        for (let i = 0;i < 9; i++)
          urlComponents[i] = c[i];
        return u.href;
      } catch {
        return "";
      }
    },
    format(href, fragment, _unicode, search, auth) {
      try {
        const u = new URL(href);
        if (!fragment)
          u.hash = "";
        if (!search)
          u.search = "";
        if (!auth) {
          u.username = "";
          u.password = "";
        }
        return u.href;
      } catch {
        return href;
      }
    },
    getOrigin(url) {
      try {
        return new URL(url?.href ?? String(url)).origin || "null";
      } catch {
        return "null";
      }
    },
    canParse(input, base) {
      try {
        if (base !== undefined)
          new URL(input, base);
        else
          new URL(input);
        return true;
      } catch {
        return false;
      }
    },
    domainToASCII(domain) {
      try {
        return new URL(`http://${domain}`).hostname;
      } catch {
        return null;
      }
    },
    domainToUnicode(domain) {
      try {
        return new URL(`http://${domain}`).hostname;
      } catch {
        return null;
      }
    },
    encodeAuth: (u) => u,
    hrefAsBlob: undefined,
    blobFromDataUrl: undefined,
    URLSearchParams,
    pathToFileURL(path, _isWindows, _base) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const u = new URL(`file://${encoded.startsWith("/") ? encoded : "/" + encoded}`);
      const c = computeComponents(u.href, u);
      for (let i = 0;i < 9; i++)
        urlComponents[i] = c[i];
      return u.href;
    },
    fileURLToPath(url) {
      const u = typeof url === "string" ? new URL(url) : url;
      if (u.protocol !== "file:")
        throw new Error("ERR_INVALID_URL_SCHEME: must be file");
      return decodeURIComponent(u.pathname);
    },
    URLPattern: globalThis.URLPattern ?? class URLPattern {
      constructor(...args) {
        throw new Error("URLPattern is not supported in this browser");
      }
    }
  };
}

// src/packages/opencontainer/kernel/natives/performance.ts
var NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN = 7;
var NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP = 6;
var perfObservers = {};
function makePerformanceBinding(ctx) {
  const now = () => globalThis.performance?.now?.() ?? ctx.hooks.now();
  const t0ns = BigInt(Math.floor(now() * 1e6));
  const milestones = new Float64Array(32);
  milestones[NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN] = Number(t0ns);
  milestones[NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP] = Date.now() * 1000;
  return {
    now,
    timerFast: { now },
    milestones,
    timerStart: undefined,
    timerEnd: undefined,
    timerInit: undefined,
    nowMilliseconds() {
      return now();
    },
    setupObservers(observers) {
      try {
        Object.assign(perfObservers, observers);
      } catch {}
    },
    observerCounts: new Int32Array(16),
    constants: {
      NODE_PERFORMANCE_ENTRY_TYPE_NODE_START: 0,
      NODE_PERFORMANCE_ENTRY_TYPE_NODE_BOOTSTRAP_COMPLETE: 1,
      NODE_PERFORMANCE_ENTRY_TYPE_BOOTSTRAP_COMPLETE: 2,
      NODE_PERFORMANCE_ENTRY_TYPE_ENVIRONMENT: 3,
      NODE_PERFORMANCE_ENTRY_TYPE_LOOP_START: 4,
      NODE_PERFORMANCE_ENTRY_TYPE_LOOP_EXIT: 5,
      NODE_PERFORMANCE_ENTRY_TYPE_GC: 6,
      NODE_PERFORMANCE_ENTRY_TYPE_HTTP2: 7,
      NODE_PERFORMANCE_ENTRY_TYPE_HTTP: 8,
      NODE_PERFORMANCE_ENTRY_TYPE_NET: 9,
      NODE_PERFORMANCE_ENTRY_TYPE_DNS: 10,
      NODE_PERFORMANCE_ENTRY_TYPE_QUIC: 11,
      NODE_PERFORMANCE_MILESTONE_NODE_START: 0,
      NODE_PERFORMANCE_MILESTONE_NODE_BOOTSTRAP_COMPLETE: 1,
      NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: 2,
      NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: 3,
      NODE_PERFORMANCE_MILESTONE_LOOP_START: 4,
      NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 5,
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP: 6,
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: 7
    },
    nowBigInt() {
      return BigInt(Math.floor(now() * 1e6));
    },
    milestoneUpdateTimeOrigin: () => {},
    setupPerfDefaults: () => {},
    markBootstrapComplete() {
      milestones[2] = Number(BigInt(Math.floor(now() * 1e6)));
    },
    getMilestones() {
      return milestones;
    },
    eventLoopUtilization(usage1, usage2) {
      const idle = 0, active = 0;
      const u = { idle, active, utilization: 0 };
      return u;
    },
    loopIdleTime: () => 0
  };
}

// src/packages/opencontainer/kernel/natives/messaging-ports.ts
class EmuPort {
  peer = null;
  listeners = new Map;
  closed = false;
  dispatchTrap = null;
  static pair() {
    const a = new EmuPort;
    const b = new EmuPort;
    a.peer = b;
    b.peer = a;
    return [a, b];
  }
  on(event, fn) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set;
      this.listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }
  once(event, fn) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }
  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  emit(event, ...args) {
    if (this.closed)
      return false;
    const set = this.listeners.get(event);
    if (!set || set.size === 0)
      return false;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
    return true;
  }
  postMessage(data, _transferList) {
    if (this.closed || !this.peer || this.peer.closed)
      return;
    const peer = this.peer;
    if (globalThis.__ocWorkerMsgDebug) {
      try {
        const d = data;
        globalThis.__ocWorkerMsgDebug(`${data === false ? "shutdown" : d?.type ?? (d?.status ? `reply:${d.status}` : "?")} ${d?.error ? "ERROR code=" + d.error.code + " msg=" + String(d.error.message).slice(0, 300) : ""} ${d?.value !== undefined ? "value:" + (typeof d.value === "object" ? Object.keys(d.value ?? {}).slice(0, 8).join(",") : String(d.value)) : ""}`);
      } catch {}
    }
    queueMicrotask(() => {
      const deliver = () => peer.emit("message", data);
      if (peer.dispatchTrap)
        peer.dispatchTrap(deliver);
      else
        deliver();
    });
  }
  close(_cb) {
    if (this.closed)
      return;
    this.closed = true;
    const peer = this.peer;
    this.listeners.clear();
    if (peer && !peer.closed) {
      peer.closed = true;
      peer.emit("close");
      peer.listeners.clear();
    }
    this.emit("close");
  }
  start() {}
  ref() {}
  unref() {}
  hasRef() {
    return false;
  }
}

class EmuMessageChannel {
  port1;
  port2;
  constructor() {
    [this.port1, this.port2] = EmuPort.pair();
  }
}

// src/packages/opencontainer/kernel/natives/worker.ts
var kMainThreadName = "main";
var nextThreadId = 1;
function makeWorkerBinding() {
  const g = globalThis;
  const workers = new Map;

  class WorkerImpl {
    messagePort;
    onexit = null;
    threadId;
    threadName;
    invalidExecArgv = null;
    invalidNodeOptions = null;
    threadSide;
    exited = false;
    constructor(_url, _env, execArgv, _resourceLimits, _trackUnmanagedFds, _isInternal, name) {
      if (Array.isArray(execArgv) && execArgv.length > 0) {
        this.invalidExecArgv = execArgv;
      }
      this.threadId = nextThreadId++;
      this.threadName = name ?? `WorkerThread-${this.threadId}`;
      const [mainSide, threadSide] = EmuPort.pair();
      this.messagePort = mainSide;
      this.threadSide = threadSide;
      this.threadSide.on("message", (m) => this.onControlMessage(m));
      workers.set(this.threadId, this);
    }
    startThread() {}
    stopThread() {
      this.finish(1);
    }
    ref() {}
    unref() {}
    takeHeapSnapshot() {}
    onControlMessage(msg) {
      if (!msg || msg.type !== "loadScript")
        return;
      const filename = String(msg.filename ?? "");
      const workerData = msg.workerData;
      const publicPort = msg.publicPort ?? null;
      this.bootScript(filename, workerData, publicPort);
    }
    async bootScript(filename, workerData, publicPort) {
      if (publicPort) {
        publicPort.dispatchTrap = (deliver) => {
          const prev = g.__ocWorkerDispatch;
          g.__ocWorkerDispatch = this;
          try {
            deliver();
          } finally {
            g.__ocWorkerDispatch = prev;
          }
        };
      }
      const view = {
        __proto__: null,
        isMainThread: false,
        parentPort: publicPort,
        workerData,
        threadId: this.threadId,
        threadName: this.threadName,
        resourceLimits: null,
        MessagePort: EmuPort,
        MessageChannel: EmuMessageChannel,
        BroadcastChannel: globalThis.BroadcastChannel ?? class BroadcastChannel {
        },
        markAsUncloneable() {},
        moveMessagePortToContext() {
          throw new Error("OpenContainer: worker_threads context move is not supported");
        },
        receiveMessageOnPort() {
          throw new Error("OpenContainer: synchronous receiveMessageOnPort() is not supported");
        },
        postMessageToThread() {
          throw new Error("OpenContainer: postMessageToThread is not supported");
        },
        SHARE_ENV: Symbol("nodejs.worker_threads.SHARE_ENV"),
        environmentData: new Map,
        getEnvironmentData(k) {
          return this.environmentData.get(k);
        },
        setEnvironmentData(k, v) {
          if (v === undefined)
            this.environmentData.delete(k);
          else
            this.environmentData.set(k, v);
        }
      };
      view.default = view;
      const restore = swapBuiltin("worker_threads", view);
      g.__ocWorkerDispatch = this;
      try {
        const requireFile = g.__ocRequireFile;
        if (typeof requireFile !== "function") {
          throw new Error("OpenContainer: kernel file-require hook not wired (worker boot)");
        }
        requireFile(filename);
        this.threadSide.postMessage({ type: "upAndRunning" });
      } catch (err) {
        g.__ocWorkerError = err;
        this.finish(1);
        return;
      } finally {
        g.__ocWorkerDispatch = null;
        restore();
      }
    }
    workerExit(code) {
      this.finish(code);
    }
    finish(code) {
      if (this.exited)
        return;
      this.exited = true;
      workers.delete(this.threadId);
      try {
        this.threadSide.close();
      } catch {}
      try {
        this.messagePort.close();
      } catch {}
      try {
        this.onexit?.(code, null, null);
      } catch {}
    }
  }
  function swapBuiltin(id, exportsObj) {
    try {
      const realm = g.__ocRealmRequire?.("internal/bootstrap/realm");
      const bm = realm?.BuiltinModule?.map?.get(id);
      if (!bm)
        return () => {};
      const saved = { exports: bm.exports, loaded: bm.loaded, loading: bm.loading };
      bm.exports = exportsObj;
      bm.loaded = true;
      bm.loading = false;
      return () => {
        bm.exports = saved.exports;
        bm.loaded = saved.loaded;
        bm.loading = saved.loading;
      };
    } catch {
      return () => {};
    }
  }
  return {
    ownsProcessState: true,
    isMainThread: true,
    isInternalThread: false,
    resourceLimits: null,
    threadId: 0,
    threadName: kMainThreadName,
    Worker: WorkerImpl,
    getEnvMessagePort() {
      return null;
    },
    messaging: null,
    getMsgChannel() {
      return null;
    },
    postMessage() {
      throw new Error("OpenContainer: worker-to-thread postMessage is not supported");
    },
    parentPort: null,
    markAsUntransferable() {},
    moveMessagePortToContext() {
      throw new Error("OpenContainer: worker_threads context move is not supported");
    },
    kMaxYoungGenerationSizeMb: 16,
    kMaxOldGenerationSizeMb: 4096,
    kCodeRangeSizeMb: 0,
    kStackSizeMb: 4,
    kTotalResourceLimitCount: 0,
    getHeapStatistics() {
      return { totalHeapSize: 0, usedHeapSize: 0, totalExternalSize: 0, totalAvailableSize: 0 };
    },
    takeHeapSnapshot() {
      throw new Error("unsupported");
    }
  };
}

// src/packages/opencontainer/kernel/natives/credentials.ts
function makeCredentialsBinding(ctx) {
  return {
    isRootUserId: false,
    safeGetenv(name) {
      if (name.startsWith("NODE_"))
        return ctx.hooks.env()[name];
      return;
    },
    getTempDir() {
      return "/tmp";
    },
    getEmbedderOptions() {
      return { shouldNotRegisterESMLoader: false, globalServicing: false, shouldExitOnUncaughtException: false, noGlobalSearchPaths: false, compileSnapshotAsMainModule: false, hasInspector: false };
    },
    getCIDR() {
      return null;
    }
  };
}

// src/packages/opencontainer/kernel/natives/os.ts
function makeOsBinding() {
  return {
    getOSInformation() {
      return ["browser", ""];
    },
    getHomeDir() {
      return "/home/node";
    },
    getHomeDirectory() {
      return "/home/node";
    },
    getPasswdUid() {
      return 0;
    },
    getUserInfoByUid() {
      return { username: "node", uid: 0, gid: 0, homedir: "/home/node", shell: "/bin/jsh" };
    },
    getUserInfo: () => ({ username: "node", uid: 0, gid: 0, homedir: "/home/node", shell: "/bin/jsh" }),
    getFreeMem: () => 1 << 30,
    getTotalMem: () => 4 * (1 << 30),
    getLoadAvg: () => [0, 0, 0],
    getUptime: () => 0,
    getPriority: () => 0,
    setPriority() {
      throw new Error("os.setPriority is not supported in OpenContainer");
    },
    getCPUs: () => [{ model: "browser-jit", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
    getInterfaceAddresses: () => ({}),
    getHostname: () => "opencontainer",
    getAvailableParallelism: () => 1,
    getEndianness: () => "LE",
    isBigEndian: () => false,
    dlopen: () => {
      throw new Error("process.dlopen not supported");
    }
  };
}

// src/packages/opencontainer/kernel/natives/crypto.ts
function rotr32(x, n) {
  return (x >>> n | x << 32 - n) >>> 0;
}
function rotl32(x, n) {
  return (x << n | x >>> 32 - n) >>> 0;
}
var K256 = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var IV256 = [
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
];
var IV224 = [
  3238371032,
  914150663,
  812702999,
  4144912697,
  4290775857,
  1750603025,
  1694076839,
  3204075428
];

class Sha2_32 {
  digestLen;
  blockSize = 64;
  h;
  buf = new Uint8Array(64);
  bufLen = 0;
  totalLen = 0;
  w = new Uint32Array(64);
  constructor(digestLen, iv) {
    this.digestLen = digestLen;
    this.h = Uint32Array.from(iv);
  }
  update(data) {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64)
        return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }
  compress(block, off) {
    const w = this.w;
    const h = this.h;
    for (let i = 0;i < 16; i++) {
      const o = off + i * 4;
      w[i] = (block[o] << 24 | block[o + 1] << 16 | block[o + 2] << 8 | block[o + 3]) >>> 0;
    }
    for (let i = 16;i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ x >>> 3) >>> 0;
      const s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ y >>> 10) >>> 0;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0;i < 64; i++) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = (e & f ^ ~e & g) >>> 0;
      const t1 = hh + S1 + ch + K256[i] + w[i] >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = (a & b ^ a & c ^ b & c) >>> 0;
      const t2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  digest() {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 128;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128);
      t2.set(tail);
      return t2;
    })();
    const hi = Math.floor(bits / 4294967296);
    const lo = bits % 4294967296;
    const n = padLen - 8;
    view[n] = hi >>> 24 & 255;
    view[n + 1] = hi >>> 16 & 255;
    view[n + 2] = hi >>> 8 & 255;
    view[n + 3] = hi & 255;
    view[n + 4] = lo / 2 ** 24 & 255;
    view[n + 5] = lo / 2 ** 16 & 255;
    view[n + 6] = lo / 2 ** 8 & 255;
    view[n + 7] = lo % 256;
    this.compress(view, 0);
    if (padLen === 128)
      this.compress(view, 64);
    const out = new Uint8Array(this.digestLen);
    for (let i = 0;i < this.digestLen; i += 4) {
      const word = this.h[i / 4];
      out[i] = word >>> 24 & 255;
      out[i + 1] = word >>> 16 & 255;
      out[i + 2] = word >>> 8 & 255;
      out[i + 3] = word & 255;
    }
    return out;
  }
  clone() {
    const c = new Sha2_32(this.digestLen, IV256);
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}
var K1 = [1518500249, 1859775393, 2400959708, 3395469782];

class Sha1 {
  blockSize = 64;
  digestLen = 20;
  h = new Uint32Array([
    1732584193,
    4023233417,
    2562383102,
    271733878,
    3285377520
  ]);
  buf = new Uint8Array(64);
  bufLen = 0;
  totalLen = 0;
  w = new Uint32Array(80);
  update(data) {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64)
        return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }
  compress(block, off) {
    const w = this.w;
    for (let i = 0;i < 16; i++) {
      const o = off + i * 4;
      w[i] = (block[o] << 24 | block[o + 1] << 16 | block[o + 2] << 8 | block[o + 3]) >>> 0;
    }
    for (let i = 16;i < 80; i++) {
      w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let [a, b, c, d, e] = this.h;
    for (let i = 0;i < 80; i++) {
      let f, k;
      if (i < 20) {
        f = (b & c | ~b & d) >>> 0;
        k = K1[0];
      } else if (i < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = K1[1];
      } else if (i < 60) {
        f = (b & c | b & d | c & d) >>> 0;
        k = K1[2];
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = K1[3];
      }
      const tmp = (rotl32(a, 5) + f + e + k + w[i]) / 1 >>> 0;
      e = d;
      d = c;
      c = rotl32(b, 30);
      b = a;
      a = tmp;
    }
    this.h[0] = this.h[0] + a >>> 0;
    this.h[1] = this.h[1] + b >>> 0;
    this.h[2] = this.h[2] + c >>> 0;
    this.h[3] = this.h[3] + d >>> 0;
    this.h[4] = this.h[4] + e >>> 0;
  }
  digest() {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 128;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128);
      t2.set(tail);
      return t2;
    })();
    const hi = Math.floor(bits / 4294967296);
    const lo = bits % 4294967296;
    const n = padLen - 8;
    view[n] = hi >>> 24 & 255;
    view[n + 1] = hi >>> 16 & 255;
    view[n + 2] = hi >>> 8 & 255;
    view[n + 3] = hi & 255;
    view[n + 4] = lo / 2 ** 24 & 255;
    view[n + 5] = lo / 2 ** 16 & 255;
    view[n + 6] = lo / 2 ** 8 & 255;
    view[n + 7] = lo % 256;
    this.compress(view, 0);
    if (padLen === 128)
      this.compress(view, 64);
    const out = new Uint8Array(20);
    for (let i = 0;i < 5; i++) {
      out[i * 4] = this.h[i] >>> 24 & 255;
      out[i * 4 + 1] = this.h[i] >>> 16 & 255;
      out[i * 4 + 2] = this.h[i] >>> 8 & 255;
      out[i * 4 + 3] = this.h[i] & 255;
    }
    return out;
  }
  clone() {
    const c = new Sha1;
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}
var T_MD5 = new Uint32Array(64);
for (let i = 0;i < 64; i++) {
  T_MD5[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
}
var S_MD5 = new Uint8Array(64);
{
  const groups = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  for (let r = 0;r < 4; r++) {
    for (let i = 0;i < 16; i++)
      S_MD5[r * 16 + i] = groups[r][i % 4];
  }
}

class Md5 {
  blockSize = 64;
  digestLen = 16;
  h = new Uint32Array([1732584193, 4023233417, 2562383102, 271733878]);
  buf = new Uint8Array(64);
  bufLen = 0;
  totalLen = 0;
  w = new Uint32Array(16);
  update(data) {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64)
        return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }
  compress(block, off) {
    const w = this.w;
    for (let i = 0;i < 16; i++) {
      const o = off + i * 4;
      w[i] = (block[o] | block[o + 1] << 8 | block[o + 2] << 16 | block[o + 3] << 24) >>> 0;
    }
    let a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
    for (let i = 0;i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c | ~b & d) >>> 0;
        g = i;
      } else if (i < 32) {
        f = (d & b | ~d & c) >>> 0;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = (b ^ c ^ d) >>> 0;
        g = (3 * i + 5) % 16;
      } else {
        f = (c ^ (b | ~d)) >>> 0;
        g = 7 * i % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = a + f + T_MD5[i] + w[g] >>> 0;
      b = b + rotl32(sum, S_MD5[i]) >>> 0;
      a = tmp;
    }
    this.h[0] = this.h[0] + a >>> 0;
    this.h[1] = this.h[1] + b >>> 0;
    this.h[2] = this.h[2] + c >>> 0;
    this.h[3] = this.h[3] + d >>> 0;
  }
  digest() {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 128;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128);
      t2.set(tail);
      return t2;
    })();
    const lo = bits % 4294967296;
    const hi = Math.floor(bits / 4294967296);
    const n = padLen - 8;
    view[n] = lo % 256;
    view[n + 1] = lo / 2 ** 8 % 256;
    view[n + 2] = lo / 2 ** 16 % 256;
    view[n + 3] = lo / 2 ** 24 % 256;
    view[n + 4] = hi % 256;
    view[n + 5] = hi / 2 ** 8 % 256;
    view[n + 6] = hi / 2 ** 16 % 256;
    view[n + 7] = hi / 2 ** 24 % 256;
    this.compress(view, 0);
    if (padLen === 128)
      this.compress(view, 64);
    const out = new Uint8Array(16);
    for (let i = 0;i < 4; i++) {
      out[i * 4] = this.h[i] & 255;
      out[i * 4 + 1] = this.h[i] >>> 8 & 255;
      out[i * 4 + 2] = this.h[i] >>> 16 & 255;
      out[i * 4 + 3] = this.h[i] >>> 24 & 255;
    }
    return out;
  }
  clone() {
    const c = new Md5;
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}
var M64 = (1n << 64n) - 1n;
var rotr64 = (x, n) => (x >> BigInt(n) | x << BigInt(64 - n)) & M64;
var K512 = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n
];
var IV512 = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n
];
var IV384 = [
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n
];

class Sha2_64 {
  digestLen;
  blockSize = 128;
  h;
  buf = new Uint8Array(128);
  bufLen = 0;
  totalLen = 0n;
  constructor(digestLen, iv) {
    this.digestLen = digestLen;
    this.h = [...iv];
  }
  update(data) {
    this.totalLen += BigInt(data.length);
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(128 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 128)
        return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 128 <= data.length) {
      this.compress(data, offset);
      offset += 128;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }
  compress(block, off) {
    const w = new Array(80);
    for (let i = 0;i < 16; i++) {
      let v = 0n;
      const o = off + i * 8;
      for (let j = 0;j < 8; j++)
        v = v << 8n | BigInt(block[o + j]);
      w[i] = v;
    }
    for (let i = 16;i < 80; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr64(x, 1) ^ rotr64(x, 8) ^ x >> 7n;
      const s1 = rotr64(y, 19) ^ rotr64(y, 61) ^ y >> 6n;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 & M64;
    }
    let [a, b, c, d, e, f, g, hh] = this.h;
    for (let i = 0;i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K512[i] + w[i] & M64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj & M64;
      hh = g;
      g = f;
      f = e;
      e = d + t1 & M64;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 & M64;
    }
    const h = this.h;
    h[0] = h[0] + a & M64;
    h[1] = h[1] + b & M64;
    h[2] = h[2] + c & M64;
    h[3] = h[3] + d & M64;
    h[4] = h[4] + e & M64;
    h[5] = h[5] + f & M64;
    h[6] = h[6] + g & M64;
    h[7] = h[7] + hh & M64;
  }
  digest() {
    const bits = this.totalLen * 8n;
    const tail = new Uint8Array(128);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 128;
    const padLen = this.bufLen < 112 ? 128 : 256;
    const view = padLen === 128 ? tail : (() => {
      const t2 = new Uint8Array(256);
      t2.set(tail);
      return t2;
    })();
    const n = padLen - 16;
    for (let i = 0;i < 16; i++) {
      view[n + i] = Number(bits >> BigInt(8 * (15 - i)) & 0xffn);
    }
    this.compress(view, 0);
    if (padLen === 256)
      this.compress(view, 128);
    const out = new Uint8Array(this.digestLen);
    for (let i = 0;i < this.digestLen; i++) {
      out[i] = Number(this.h[i >> 3] >> BigInt(56 - 8 * (i & 7)) & 0xffn);
    }
    return out;
  }
  clone() {
    const c = new Sha2_64(this.digestLen, IV512);
    c.h = [...this.h];
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}
var HASHES = {};
{
  let nextId = 1;
  const register = (name, aliases, make) => {
    for (const n of [name, ...aliases]) {
      HASHES[n] = { make, id: nextId };
    }
    nextId++;
  };
  register("md5", [], () => new Md5);
  register("sha1", ["sha", "sha-1"], () => new Sha1);
  register("sha224", ["sha-224", "sha2-224"], () => new Sha2_32(28, IV224));
  register("sha256", ["sha-256", "sha2-256"], () => new Sha2_32(32, IV256));
  register("sha384", ["sha-384", "sha2-384"], () => new Sha2_64(48, IV384));
  register("sha512", ["sha-512", "sha2-512"], () => new Sha2_64(64, IV512));
}
var CANONICAL_HASHES = ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"];
function lookupHash(name) {
  const entry = HASHES[String(name ?? "").toLowerCase()];
  if (!entry) {
    throw new Error(`Invalid digest: ${String(name)} ` + `(OpenContainer supports: ${CANONICAL_HASHES.join(", ")})`);
  }
  return entry.make;
}

class HmacImpl {
  inner;
  outerKey;
  factory;
  constructor(factory, key) {
    const block = factory().blockSize;
    let k = key;
    if (k.length > block) {
      const h = factory();
      h.update(k);
      k = h.digest();
    }
    const padded = new Uint8Array(block);
    padded.set(k);
    this.outerKey = new Uint8Array(block);
    const ipad = new Uint8Array(block);
    for (let i = 0;i < block; i++) {
      ipad[i] = padded[i] ^ 54;
      this.outerKey[i] = padded[i] ^ 92;
    }
    this.factory = factory;
    this.inner = factory();
    this.inner.update(ipad);
  }
  update(data) {
    this.inner.update(data);
  }
  digest() {
    const innerDigest = this.inner.digest();
    const outer = this.factory();
    outer.update(this.outerKey);
    outer.update(innerDigest);
    return outer.digest();
  }
}
function toBytes(data, encoding) {
  if (typeof data === "string") {
    const B = globalThis.Buffer;
    if (typeof B?.from === "function")
      return B.from(data, encoding || "utf8");
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array)
    return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer)
    return new Uint8Array(data);
  throw new TypeError("Expected input to be a string, Buffer, TypedArray, or DataView");
}
function toBuffer(bytes) {
  const B = globalThis.Buffer;
  if (typeof B === "function") {
    return new B(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes;
}
var K_MODE_ASYNC = 0;
var K_MODE_SYNC = 1;
var K_MODE_WEBCRYPTO = 2;

class CryptoJob {
  mode;
  ondone = null;
  constructor(mode) {
    this.mode = mode;
  }
  run() {
    if (this.mode === K_MODE_SYNC) {
      try {
        return [undefined, this.task()];
      } catch (err) {
        return [err, undefined];
      }
    }
    const p = (async () => this.task())();
    if (typeof this.ondone === "function") {
      const cb = this.ondone;
      p.then((r) => {
        try {
          cb(null, r);
        } catch {}
      }, (e) => {
        try {
          cb(e, undefined);
        } catch {}
      });
    }
    return p;
  }
}
function makeCryptoBinding() {
  const nativeCrypto = globalThis.crypto;
  const nativeGetRandomValues = typeof nativeCrypto?.getRandomValues === "function" ? nativeCrypto.getRandomValues.bind(nativeCrypto) : null;
  function randomFillInto(view) {
    if (!nativeGetRandomValues) {
      throw new Error("OpenContainer: crypto.getRandomValues unavailable");
    }
    for (let off = 0;off < view.length; off += 65536) {
      nativeGetRandomValues(off + 65536 <= view.length ? view.subarray(off, off + 65536) : view.subarray(off));
    }
  }

  class CryptoHash {
    impl;
    finalized = false;
    constructor(algorithm, _xofLen, _algorithmId, _cache, functionName, customization) {
      if (algorithm instanceof CryptoHash) {
        this.impl = algorithm.impl.clone();
        return;
      }
      if (functionName !== undefined || customization !== undefined) {
        throw new Error("OpenContainer: cSHAKE not supported " + "(no OpenSSL in the browser runtime)");
      }
      this.impl = lookupHash(algorithm)();
    }
    update(data, encoding) {
      if (this.finalized) {
        throw new Error("Digest already called");
      }
      this.impl.update(toBytes(data, encoding));
      return true;
    }
    digest(outputEncoding) {
      if (this.finalized) {
        throw new Error("Digest already called");
      }
      this.finalized = true;
      const out = toBuffer(this.impl.digest());
      if (outputEncoding && typeof outputEncoding === "string") {
        return out.toString(outputEncoding);
      }
      return out;
    }
  }

  class CryptoHmac {
    impl = null;
    finalized = false;
    init(algorithm, key) {
      this.impl = new HmacImpl(lookupHash(algorithm), toBytes(key));
    }
    update(data, encoding) {
      if (this.finalized || !this.impl) {
        throw new Error("Hmac already finalized");
      }
      this.impl.update(toBytes(data, encoding));
      return true;
    }
    digest(outputEncoding) {
      if (this.finalized || !this.impl) {
        throw new Error("Hmac already finalized");
      }
      this.finalized = true;
      const out = toBuffer(this.impl.digest());
      if (outputEncoding && typeof outputEncoding === "string") {
        return out.toString(outputEncoding);
      }
      return out;
    }
  }

  class RandomBytesJob extends CryptoJob {
    buf;
    offset;
    size;
    constructor(mode, buf, offset = 0, size) {
      super(mode);
      this.buf = buf;
      this.offset = offset;
      this.size = size ?? (buf?.byteLength ?? 0) - offset;
    }
    task() {
      let view;
      if (this.buf instanceof ArrayBuffer) {
        view = new Uint8Array(this.buf, this.offset, this.size);
      } else if (ArrayBuffer.isView(this.buf)) {
        view = new Uint8Array(this.buf.buffer, this.buf.byteOffset + this.offset, this.size);
      } else {
        throw new TypeError("RandomBytesJob requires an ArrayBuffer or view");
      }
      randomFillInto(view);
      return view;
    }
  }
  const SUBTLE_NAMES = {
    "sha-1": "SHA-1",
    "sha-256": "SHA-256",
    "sha-384": "SHA-384",
    "sha-512": "SHA-512"
  };

  class HashJob extends CryptoJob {
    constructor(mode, algorithm, ...data) {
      super(mode);
      this.algorithm = algorithm;
      this.data = data[0];
    }
    algorithm;
    data;
    task() {
      if (this.mode === K_MODE_WEBCRYPTO) {
        const name = SUBTLE_NAMES[String(this.algorithm).toLowerCase()] ?? String(this.algorithm);
        const subtle = globalThis.crypto?.subtle;
        if (subtle)
          return subtle.digest(name, toBytes(this.data));
      }
      const impl = lookupHash(this.algorithm)();
      impl.update(toBytes(this.data));
      return impl.digest().buffer;
    }
  }

  class PBKDF2Job extends CryptoJob {
    iterations;
    keylen;
    digestName;
    outputEncoding;
    constructor(mode, password, salt, iterations, keylen, digestName, outputEncoding) {
      super(mode);
      this.iterations = iterations;
      this.keylen = keylen;
      this.digestName = digestName;
      this.outputEncoding = outputEncoding;
      this.password = toBytes(password);
      this.salt = toBytes(salt);
    }
    password;
    salt;
    task() {
      if (!(this.iterations >= 1)) {
        throw new Error("Invalid pbkdf2 iterations value");
      }
      if (this.keylen < 0) {
        throw new Error("Invalid pbkdf2 key length");
      }
      const factory = lookupHash(this.digestName);
      const proto = factory();
      const hLen = proto.digestLen;
      const block = proto.blockSize;
      const dk = new Uint8Array(this.keylen);
      let key = this.password;
      if (key.length > block) {
        const kh = factory();
        kh.update(key);
        key = kh.digest();
      }
      const padded = new Uint8Array(block);
      padded.set(key);
      const ipad = new Uint8Array(block);
      const opad = new Uint8Array(block);
      for (let i = 0;i < block; i++) {
        ipad[i] = padded[i] ^ 54;
        opad[i] = padded[i] ^ 92;
      }
      const innerState = factory();
      innerState.update(ipad);
      const outerState = factory();
      outerState.update(opad);
      const hmacOnce = (data) => {
        const inner = innerState.clone();
        inner.update(data);
        const outer = outerState.clone();
        outer.update(inner.digest());
        return outer.digest();
      };
      const blocks = Math.ceil(this.keylen / hLen) || 1;
      const be32 = new Uint8Array(4);
      for (let b = 1;b <= blocks; b++) {
        be32[0] = b >>> 24 & 255;
        be32[1] = b >>> 16 & 255;
        be32[2] = b >>> 8 & 255;
        be32[3] = b & 255;
        const seed = new Uint8Array(this.salt.length + 4);
        seed.set(this.salt);
        seed.set(be32, this.salt.length);
        let u = hmacOnce(seed);
        const t = Uint8Array.from(u);
        for (let c = 1;c < this.iterations; c++) {
          u = hmacOnce(u);
          for (let i = 0;i < hLen; i++)
            t[i] ^= u[i];
        }
        const start = (b - 1) * hLen;
        const take = Math.min(hLen, this.keylen - start);
        dk.set(t.subarray(0, take), start);
      }
      if (this.outputEncoding && typeof this.outputEncoding === "string") {
        return toBuffer(dk).toString(this.outputEncoding);
      }
      return dk;
    }
  }
  const unsupportedMsg = (what) => `OpenContainer: node:crypto ${what} is not supported in the browser ` + `runtime (no OpenSSL backend). Tracked for a future WASM crypto build.`;
  const unsupported = (what) => (..._args) => {
    throw new Error(unsupportedMsg(what));
  };
  const unsupportedClass = (what) => {
    const C = class {
      constructor(..._args) {
        throw new Error(unsupportedMsg(what));
      }
    };
    return C;
  };
  const todoJob = (what) => class extends CryptoJob {
    task() {
      throw new Error(unsupportedMsg(what));
    }
  };
  const NativeX509Certificate = class {
    constructor(..._args) {
      throw new Error("OpenContainer: X.509 certificates are not supported " + "in the browser runtime (no OpenSSL backend).");
    }
  };
  {
    const proto = NativeX509Certificate.prototype;
    for (const m of [
      "checkCA",
      "checkEmail",
      "checkHost",
      "checkIP",
      "checkIssued",
      "checkPrivateKey",
      "fingerprint",
      "fingerprint256",
      "fingerprint512",
      "getIssuerCert",
      "infoAccess",
      "issuer",
      "keyUsage",
      "pem",
      "publicKey",
      "raw",
      "serialNumber",
      "signatureAlgorithm",
      "signatureAlgorithmOid",
      "subject",
      "subjectAltName",
      "toLegacy",
      "validFrom",
      "validFromDate",
      "validTo",
      "validToDate",
      "verify"
    ]) {
      proto[m] = unsupported(`X509Certificate.${m}`);
    }
  }
  const kNativeSlotKey = "__ocNativeKeyObject";
  const createNativeKeyObjectClass = (cb) => {
    const NativeKeyObject = class {
      constructor(handle) {
        this[kNativeSlotKey] = handle;
      }
    };
    return cb(NativeKeyObject);
  };
  const createCryptoKeyClass = (cb) => {
    const NativeCryptoKey = class {
      constructor(handle, algorithm, usagesMask, extractable, secondaryHandle, seedData) {
        this[kNativeSlotKey] = { handle, algorithm, usagesMask, extractable, secondaryHandle, seedData };
      }
    };
    return cb(NativeCryptoKey);
  };
  const createX509CertificateClass = (cb) => cb(NativeX509Certificate);
  const aliasCache = {};
  for (const [name, entry] of Object.entries(HASHES))
    aliasCache[name] = entry.id;
  return {
    randomFillSync(buf, offset, size) {
      if (buf instanceof ArrayBuffer) {
        randomFillInto(new Uint8Array(buf, offset, size));
      } else if (ArrayBuffer.isView(buf)) {
        randomFillInto(new Uint8Array(buf.buffer, buf.byteOffset + offset, size));
      } else {
        throw new TypeError("randomFillSync requires an ArrayBuffer or view");
      }
    },
    secureBuffer(n) {
      const B = globalThis.Buffer;
      return typeof B?.alloc === "function" ? B.alloc(n) : new Uint8Array(n);
    },
    RandomBytesJob,
    getFipsCrypto: () => 0,
    getFipsCryptoGeneration: () => 0,
    setFipsCrypto: () => 0,
    timingSafeEqual(a, b) {
      const av = a instanceof Uint8Array ? a : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : a instanceof ArrayBuffer ? new Uint8Array(a) : null;
      const bv = b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b instanceof ArrayBuffer ? new Uint8Array(b) : null;
      if (!av || !bv) {
        throw new TypeError("Expected input to be an ArrayBuffer or view");
      }
      if (av.byteLength !== bv.byteLength) {
        throw new RangeError("Input buffers must have the same byte length");
      }
      let acc = 0;
      for (let i = 0;i < av.byteLength; i++)
        acc |= av[i] ^ bv[i];
      return acc === 0;
    },
    getCachedAliases: () => aliasCache,
    getCachedMacAliases: () => aliasCache,
    getHashes: () => [
      ...CANONICAL_HASHES,
      "sha-1",
      "sha-224",
      "sha-256",
      "sha-384",
      "sha-512"
    ],
    getMacs: () => [...CANONICAL_HASHES],
    getCurves: () => [],
    getCiphers: () => [],
    getSSLCiphers: () => [],
    getCipherInfo: () => {
      return;
    },
    secureHeapUsed: () => {
      return;
    },
    getOpenSSLSecLevelCrypto: () => -1,
    isKeyAlgorithmAvailable: () => false,
    isKeyObject: () => false,
    isCryptoKey: () => false,
    isX509Certificate: () => false,
    setupFipsIndicatorChannel: () => {},
    resetRootCertStore: () => {},
    startLoadingCertificatesOffThread: () => Promise.resolve(),
    getBundledRootCertificates: () => [],
    getExtraCACertificates: () => [],
    getSystemCACertificates: () => [],
    getUserRootCertificates: () => [],
    getCertificateCompressionAlgorithms: () => [],
    Hash: CryptoHash,
    Hmac: CryptoHmac,
    HashJob,
    PBKDF2Job,
    oneShotDigest(algorithm, _id, _cache, data, outputEncoding, _enc, outputLength) {
      if (outputLength !== undefined && outputLength !== null) {
        throw new Error("OpenContainer: XOF digests (outputLength) are not supported");
      }
      const impl = lookupHash(algorithm)();
      impl.update(toBytes(data));
      const out = toBuffer(impl.digest());
      if (typeof outputEncoding === "string" && outputEncoding) {
        return out.toString(outputEncoding);
      }
      return out;
    },
    setEngine: unsupported("setEngine"),
    certExportChallenge: unsupported("Certificate.exportChallenge"),
    certExportPublicKey: unsupported("Certificate.exportPublicKey"),
    certVerifySpkac: unsupported("Certificate.verifySpkac"),
    privateDecrypt: unsupported("privateDecrypt"),
    privateEncrypt: unsupported("privateEncrypt"),
    publicDecrypt: unsupported("publicDecrypt"),
    publicEncrypt: unsupported("publicEncrypt"),
    parsePKCS12: unsupported("parsePKCS12"),
    CipherBase: unsupportedClass("CipherBase (createCipheriv/Decipheriv)"),
    KeyObjectHandle: unsupportedClass("KeyObjectHandle (key generation/export)"),
    Sign: unsupportedClass("Sign (createSign)"),
    Verify: unsupportedClass("Verify (createVerify)"),
    Mac: unsupportedClass("Mac (createMac)"),
    DiffieHellman: unsupportedClass("DiffieHellman"),
    DiffieHellmanGroup: unsupportedClass("DiffieHellmanGroup (modp groups)"),
    ECDH: unsupportedClass("ECDH"),
    ECDHConvertKey: unsupportedClass("ECDHConvertKey"),
    SecureContext: unsupportedClass("SecureContext (TLS)"),
    createCryptoKeyClass,
    createNativeKeyObjectClass,
    createX509CertificateClass,
    RandomPrimeJob: todoJob("generatePrime"),
    CheckPrimeJob: todoJob("checkPrime"),
    ScryptJob: todoJob("scrypt"),
    HKDFJob: todoJob("hkdf"),
    HmacJob: todoJob("WebCrypto HMAC (subtle.sign)"),
    SignJob: todoJob("sign/verify (public-key crypto)"),
    RSACipherJob: todoJob("RSA cipher"),
    AESCipherJob: todoJob("AES cipher"),
    ChaCha20Poly1305CipherJob: todoJob("ChaCha20-Poly1305 cipher"),
    DHBitsJob: todoJob("diffieHellman bits"),
    Argon2Job: todoJob("argon2"),
    KmacJob: todoJob("KMAC"),
    KangarooTwelveJob: todoJob("KangarooTwelve"),
    TurboShakeJob: todoJob("TurboShake"),
    KEMEncapsulateJob: todoJob("KEM encapsulate"),
    KEMDecapsulateJob: todoJob("KEM decapsulate"),
    DhKeyPairGenJob: todoJob("DH key generation"),
    DsaKeyPairGenJob: todoJob("DSA key generation"),
    EcKeyPairGenJob: todoJob("EC key generation"),
    NamedKeyPairGenJob: todoJob("key generation"),
    RsaKeyPairGenJob: todoJob("RSA key generation"),
    SecretKeyGenJob: todoJob("createSecretKey"),
    kCryptoJobAsync: K_MODE_ASYNC,
    kCryptoJobSync: K_MODE_SYNC,
    kCryptoJobWebCrypto: K_MODE_WEBCRYPTO,
    kSignJobModeSign: 0,
    kSignJobModeVerify: 1,
    kSigEncDER: 0,
    kSigEncP1363: 1,
    kKeyEncodingPKCS1: 1,
    kKeyEncodingPKCS8: 2,
    kKeyEncodingSEC1: 3,
    kKeyEncodingSPKI: 4,
    kKeyFormatDER: 1,
    kKeyFormatPEM: 2,
    kKeyFormatJWK: 3,
    kKeyFormatRawPrivate: 4,
    kKeyFormatRawPublic: 5,
    kKeyFormatRawSeed: 6,
    kKeyFormatStore: 7,
    kKeyTypeSecret: 0,
    kKeyTypePublic: 1,
    kKeyTypePrivate: 2,
    kKeyVariantAES_CBC_128: 0,
    kKeyVariantAES_CBC_192: 1,
    kKeyVariantAES_CBC_256: 2,
    kKeyVariantAES_CTR_128: 3,
    kKeyVariantAES_CTR_192: 4,
    kKeyVariantAES_CTR_256: 5,
    kKeyVariantAES_GCM_128: 6,
    kKeyVariantAES_GCM_192: 7,
    kKeyVariantAES_GCM_256: 8,
    kKeyVariantAES_KW_128: 9,
    kKeyVariantAES_KW_192: 10,
    kKeyVariantAES_KW_256: 11,
    kKeyVariantAES_OCB_128: 12,
    kKeyVariantAES_OCB_192: 13,
    kKeyVariantAES_OCB_256: 14,
    kKeyVariantRSA_OAEP: 15,
    kKeyVariantRSA_PSS: 16,
    kKeyVariantRSA_SSA_PKCS1_v1_5: 17,
    kWebCryptoCipherEncrypt: 0,
    kWebCryptoCipherDecrypt: 1,
    kWebCryptoKeyFormatRaw: 0,
    kWebCryptoKeyFormatSPKI: 1,
    kWebCryptoKeyFormatPKCS8: 2,
    kTypeArgon2d: 0,
    kTypeArgon2i: 1,
    kTypeArgon2id: 2,
    OPENSSL_EC_EXPLICIT_CURVE: 0,
    OPENSSL_EC_NAMED_CURVE: 1,
    RSA_PKCS1_PSS_PADDING: 6,
    X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT: 1,
    X509_CHECK_FLAG_NO_WILDCARDS: 2,
    X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS: 4,
    X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS: 8,
    X509_CHECK_FLAG_NEVER_CHECK_SUBJECT: 16,
    X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS: 32
  };
}

// src/packages/opencontainer/kernel/natives/contextify.ts
var CJS_PARAMS = ["exports", "require", "module", "__filename", "__dirname"];
var DYN_IMPORT_TEST = /(?<![.\w$])import\s*\(/;
var DYN_IMPORT_REWRITE = /(?<![.\w$])import\s*\(/g;
if (typeof globalThis.__ocShimImport !== "function") {
  globalThis.__ocShimImport = (dir, spec) => {
    const dyn = globalThis.__ocDynImport;
    if (typeof dyn === "function")
      return dyn(dir, spec);
    return Promise.reject(new Error(`OpenContainer: dynamic import(${JSON.stringify(spec)}) from CJS at ${dir} ` + `requires the kernel ESM transport (no __ocDynImport wired)`));
  };
}
function containsModuleSyntaxImpl(content) {
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return /(^|[\n;})])\s*(import\s+[\s({'"]|import\s*\.|export\s+(default|{|\*|const|let|var|function|class|async|type|interface|declare|enum|abstract)\b|export\s*{)/.test(cleaned);
}
var contextifiedObjects = new WeakSet;
function stripBOMAndShebang(content) {
  if (content.charCodeAt(0) === 65279)
    content = content.slice(1);
  if (content.charCodeAt(0) === 35) {
    const nl = content.indexOf(`
`);
    content = nl === -1 ? "" : content.slice(nl);
  }
  return content;
}
function makeContextifyBinding() {

  class ContextifyScript {
    fn = null;
    sourceWithMap = "";
    sourceMapURL;
    sourceURL;
    constructor(code, filename, lineOffset, columnOffset, cachedData, produceCachedData, parsingContext, hostDefinedOptionId) {
      this.sourceURL = filename;
      this[hostDefinedOptionSymbol] = hostDefinedOptionId;
      const sourcemapMatch = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(code);
      this.sourceMapURL = sourcemapMatch?.[1];
      try {
        this.sourceWithMap = `${code}
//# sourceURL=${filename ?? "<anonymous>"}`;
        this.fn = new Function(`return eval(${JSON.stringify(this.sourceWithMap)});`);
      } catch (err) {
        if (err instanceof SyntaxError && filename) {
          try {
            err.message = `${err.message} at ${filename}`;
          } catch {}
        }
        throw err;
      }
    }
    runInContext(sandbox, _timeout, _displayErrors, _breakOnSigint, _breakOnFirstLine) {
      if (!this.fn)
        throw new Error("Script is not compiled");
      if (sandbox && typeof sandbox === "object") {
        const withFn = new Function("sandbox", `with (sandbox) { return eval(${JSON.stringify(this.sourceWithMap)}); }`);
        return withFn(sandbox);
      }
      return this.fn();
    }
    runInThisContext(_options) {
      return this.runInContext(null, -1, true, false, false);
    }
  }
  return {
    kMakeContexts: Symbol("nodejs.make_contexts"),
    ContextifyScript,
    compileFunctionForCJSLoader(content, filename, isSeaMain, shouldDetectModule) {
      let source = stripBOMAndShebang(content);
      if (DYN_IMPORT_TEST.test(source)) {
        source = source.replace(DYN_IMPORT_REWRITE, "__ocShimImport(__dirname, ");
      }
      let fn;
      try {
        fn = new Function(...CJS_PARAMS, `${source}
//# sourceURL=${filename}`);
      } catch (err) {
        if (err instanceof SyntaxError) {
          try {
            err.message = `${err.message} at ${filename}`;
          } catch {}
        }
        throw err;
      }
      const result = { __proto__: null, function: fn, sourceMapURL: undefined, sourceURL: filename };
      if (shouldDetectModule) {
        result.canParseAsESM = containsModuleSyntaxImpl(content);
      }
      return result;
    },
    containsModuleSyntax(content, _filename) {
      return containsModuleSyntaxImpl(content);
    },
    makeContext(sandbox, options) {
      const ctx = { ...sandbox ?? {} };
      Object.defineProperty(ctx, contextifyContextPrivateSymbol, {
        __proto__: null,
        configurable: true,
        enumerable: false,
        writable: true,
        value: { context: true }
      });
      contextifiedObjects.add(ctx);
      return ctx;
    },
    isContext(sandbox) {
      if (contextifiedObjects.has(sandbox))
        return true;
      try {
        return sandbox?.[contextifyContextPrivateSymbol] !== undefined;
      } catch {
        return false;
      }
    },
    constants: {
      measureMemory: {
        mode: { SUMMARY: 0, DETAILED: 1 },
        execution: { DEFAULT: 0, EAGER: 1 }
      }
    },
    measureMemory(_options) {
      const mem = globalThis.performance?.memory;
      return Promise.resolve({
        total: {
          jsMemoryEstimate: mem?.usedJSHeapSize ?? 0,
          jsMemoryRange: [0, mem?.jsHeapSizeLimit ?? 0]
        }
      });
    },
    startSigintWatchdog() {
      return true;
    },
    stopSigintWatchdog() {
      return false;
    },
    compileFunction(code, filename, lineOffset, columnOffset, cachedData, produceCachedData, parsingContext, contextExtensions, params, hostDefinedOptionId) {
      const args = params ?? [];
      let fn;
      try {
        fn = new Function(...args, `${code}
//# sourceURL=${filename ?? "<anonymous>"}`);
      } catch (err) {
        if (err instanceof SyntaxError && filename) {
          try {
            err.message = `${err.message} at ${filename}`;
          } catch {}
        }
        throw err;
      }
      if (hostDefinedOptionId !== undefined) {
        try {
          fn[hostDefinedOptionSymbol] = hostDefinedOptionId;
        } catch {}
      }
      const result = {
        __proto__: null,
        function: fn,
        cachedDataProduced: false,
        cachedData,
        cachedDataRejected: cachedData !== undefined,
        sourceMapURL: undefined,
        sourceURL: filename
      };
      return result;
    },
    runInThisContext(code, options) {
      return new ContextifyScript(code, options?.filename).runInThisContext();
    },
    scriptOriginOptions: undefined
  };
}

// src/packages/opencontainer/kernel/natives/module_wrap.ts
function makeModuleWrapBinding() {
  const callbacks = new WeakMap;
  let importModuleDynamicallyCallback = null;
  let initializeImportMetaObjectCallback = null;
  let importMetaResolveInitializer = null;
  return {
    kUninitialized: 0,
    kUninstantiated: 1,
    kInstantiating: 2,
    kInstantiated: 3,
    kEvaluating: 4,
    kEvaluated: 5,
    kErrored: 6,
    kSourcePhase: "source",
    kEvaluationPhase: "evaluation",
    kDeferPhase: "defer",
    ModuleWrap: class ModuleWrap {
      constructor(...args) {
        throw new Error("OpenContainer: native ESM ModuleWrap is not implemented yet (CJS runtime first; ESM lands in S5). " + "If you see this during npm flows, file the command that triggered it.");
      }
    },
    kEvaluatedSymbol: Symbol("nodejs.module.evaluate"),
    createRequiredModuleFacade() {
      throw new Error("OpenContainer: require(esm) facade not implemented yet (S5).");
    },
    registerESMLoader() {},
    compileSourceTextModule() {
      throw new Error("OpenContainer: ESM compile not implemented yet (S5).");
    },
    setPromiseHooks() {},
    callbackMap: callbacks,
    setImportModuleDynamicallyCallback(cb) {
      importModuleDynamicallyCallback = cb;
    },
    setInitializeImportMetaObjectCallback(cb) {
      initializeImportMetaObjectCallback = cb;
    },
    setImportMetaResolveInitializer(cb) {
      importMetaResolveInitializer = cb;
    },
    getImportModuleDynamicallyCallback() {
      return importModuleDynamicallyCallback;
    },
    getInitializeImportMetaObjectCallback() {
      return initializeImportMetaObjectCallback;
    },
    getImportMetaResolveInitializer() {
      return importMetaResolveInitializer;
    },
    throwIfPromiseRejected(promiseLike) {
      if (promiseLike && typeof promiseLike.then === "function") {
        promiseLike.then(undefined, (err) => {
          queueMicrotask(() => {
            throw err;
          });
        });
      }
    }
  };
}

// src/packages/opencontainer/kernel/natives/v8.ts
var kHeapSpaces = [
  "read_only_space",
  "new_space",
  "old_space",
  "code_space",
  "shared_space",
  "trusted_space",
  "new_large_object_space",
  "old_large_object_space",
  "code_large_object_space",
  "shared_large_object_space",
  "trusted_large_object_space"
];
var kTotalHeapSizeIndex = 0;
var kTotalHeapSizeExecutableIndex = 1;
var kTotalPhysicalSizeIndex = 2;
var kTotalAvailableSizeIndex = 3;
var kUsedHeapSizeIndex = 4;
var kHeapSizeLimitIndex = 5;
var kMallocedMemoryIndex = 6;
var kPeakMallocedMemoryIndex = 7;
var kDoesZapGarbageIndex = 8;
var kExternalMemoryIndex = 9;
var kExternalMemoryLimitIndex = 10;
var kMaxExternalMemoryIndex = 11;
var kHeapStatisticsCount = 16;
var kSpaceSizeIndex = 0;
var kSpaceUsedSizeIndex = 1;
var kSpaceAvailableSizeIndex = 2;
var kPhysicalSpaceSizeIndex = 3;
var kCodeAndMetadataSizeIndex = 0;
var kExternalScriptSourceSizeIndex = 1;
var kCpuProfilerMetaDataSizeIndex = 2;
var kEmbedderHeapTracerTypeIndex = 3;
function makeV8Binding(_ctx) {
  const heapStatisticsBuffer = new Float64Array(kHeapStatisticsCount);
  const heapSpaceStatisticsBuffer = new Float64Array(kHeapSpaces.length * 4);
  const heapCodeStatisticsBuffer = new Float64Array(4);
  const perfMemory = () => globalThis.performance?.memory;
  function fillHeapStats() {
    const mem = perfMemory();
    const used = mem?.usedJSHeapSize ?? 0;
    const total = mem?.totalJSHeapSize ?? used;
    const limit = mem?.jsHeapSizeLimit ?? 2147483648;
    heapStatisticsBuffer.fill(0);
    heapStatisticsBuffer[kTotalHeapSizeIndex] = total;
    heapStatisticsBuffer[kTotalHeapSizeExecutableIndex] = 0;
    heapStatisticsBuffer[kTotalPhysicalSizeIndex] = total;
    heapStatisticsBuffer[kTotalAvailableSizeIndex] = Math.max(0, limit - used);
    heapStatisticsBuffer[kUsedHeapSizeIndex] = used;
    heapStatisticsBuffer[kHeapSizeLimitIndex] = limit;
    heapStatisticsBuffer[kDoesZapGarbageIndex] = 0;
    heapStatisticsBuffer[kExternalMemoryIndex] = 0;
  }
  function fillHeapSpaceStats() {
    heapSpaceStatisticsBuffer.fill(0);
    const mem = perfMemory();
    const used = mem?.usedJSHeapSize ?? 0;
    const oldUsed = used;
    heapSpaceStatisticsBuffer[kSpaceSizeIndex + 2 * 4] = oldUsed;
    heapSpaceStatisticsBuffer[kSpaceUsedSizeIndex + 2 * 4] = oldUsed;
    heapSpaceStatisticsBuffer[kSpaceAvailableSizeIndex + 2 * 4] = 0;
    heapSpaceStatisticsBuffer[kPhysicalSpaceSizeIndex + 2 * 4] = oldUsed;
  }
  fillHeapStats();
  fillHeapSpaceStats();
  return {
    setFlagsFromString(_flags) {},
    setFlagsFromStringSafe(_flags) {},
    heapStatisticsBuffer,
    heapSpaceStatisticsBuffer,
    heapCodeStatisticsBuffer,
    updateHeapStatisticsBuffer: fillHeapStats,
    updateHeapSpaceStatisticsBuffer: fillHeapSpaceStats,
    updateHeapCodeStatisticsBuffer() {
      heapCodeStatisticsBuffer.fill(0);
    },
    getHeapStatistics() {
      fillHeapStats();
      const out = {};
      for (let i = 0;i < kHeapStatisticsCount; i++)
        out[i] = heapStatisticsBuffer[i];
      return out;
    },
    getHeapSpaceStatistics() {
      fillHeapSpaceStats();
      return kHeapSpaces.map((name, i) => ({
        space_name: name,
        space_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceSizeIndex],
        space_used_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceUsedSizeIndex],
        space_available_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceAvailableSizeIndex],
        physical_space_size: heapSpaceStatisticsBuffer[i * 4 + kPhysicalSpaceSizeIndex]
      }));
    },
    getHeapCodeStatistics() {
      return {
        code_and_metadata_size: 0,
        cpu_profiler_metadata_size: 0,
        external_script_source_size: 0,
        embedder_heap_tracer_type: 0
      };
    },
    getCppHeapStatistics() {
      return { cpp_heap_size: 0, external_memory: 0 };
    },
    getMemorySavingsForStrings() {
      return 0;
    },
    kTotalHeapSizeIndex,
    kTotalHeapSizeExecutableIndex,
    kTotalPhysicalSizeIndex,
    kTotalAvailableSizeIndex,
    kUsedHeapSizeIndex,
    kHeapSizeLimitIndex,
    kMallocedMemoryIndex,
    kPeakMallocedMemoryIndex,
    kDoesZapGarbageIndex,
    kExternalMemoryIndex,
    kExternalMemoryLimitIndex,
    kMaxExternalMemoryIndex,
    kHeapSpaces,
    kSpaceSizeIndex,
    kSpaceUsedSizeIndex,
    kSpaceAvailableSizeIndex,
    kPhysicalSpaceSizeIndex,
    kCodeAndMetadataSizeIndex,
    kExternalScriptSourceSizeIndex,
    kCpuProfilerMetaDataSizeIndex,
    kEmbedderHeapTracerTypeIndex,
    startCpuProfile: undefined,
    stopCpuProfile: undefined,
    startHeapProfile: undefined,
    stopHeapProfile: undefined,
    startSamplingHeapProfiler() {
      throw new Error("v8.startSamplingHeapProfiler is not supported in the browser");
    },
    stopSamplingHeapProfiler() {},
    setHeapSnapshotNearHeapLimit() {},
    setHeapProfileNearHeapLimit() {},
    getHeapSnapshot() {
      throw new Error("v8.getHeapSnapshot is not supported in the browser");
    },
    getHeapSnapshotStream() {
      throw new Error("not supported");
    },
    triggerHeapSnapshot: undefined,
    isStringOneByteRepresentation(str) {
      for (let i = 0;i < str.length; i++) {
        if (str.charCodeAt(i) > 255)
          return false;
      }
      return true;
    },
    cachedDataVersionTag: () => 0,
    setHooksFromBinding() {},
    terminateExecution() {},
    _setFlagsFromStringNoop: true,
    startupSnapshot: undefined,
    detailLevel: 0,
    kSamplingNoFlags: 0,
    kSamplingForceGC: 1,
    kSamplingIncludeObjectsCollectedByMajorGC: 2,
    kSamplingIncludeObjectsCollectedByMinorGC: 4,
    measureMemory: async () => ({
      total: { jsMemoryEstimate: perfMemory()?.usedJSHeapSize ?? 0, jsMemoryRange: [0, perfMemory()?.jsHeapSizeLimit ?? 0] }
    })
  };
}

// src/packages/opencontainer/kernel/natives/timers.ts
function makeTimersBinding() {
  const g = globalThis;
  const hostSetTimeout = globalThis.setTimeout?.bind(globalThis) ?? ((cb, ms) => setTimeout(cb, ms));
  const hostClearTimeout = globalThis.clearTimeout?.bind(globalThis) ?? ((t) => clearTimeout(t));
  const immediateInfo = new Float64Array(4);
  const timeoutInfo = new Int32Array(1);
  let armedTimer = null;
  let armedAt = Infinity;
  function getLibuvNow() {
    return g.performance?.now?.() ?? Date.now();
  }
  function scheduleTimer(msecs) {
    const at = getLibuvNow() + Math.max(0, msecs);
    if (armedTimer !== null && armedAt <= at)
      return;
    if (armedTimer !== null)
      hostClearTimeout(armedTimer);
    armedAt = at;
    armedTimer = hostSetTimeout(() => {
      armedTimer = null;
      armedAt = Infinity;
      try {
        g.__ocProcessTimers?.();
      } catch (e) {
        g.__ocDebugHook?.("[processTimers error] " + String(e));
      }
    }, Math.ceil(Math.max(0, msecs)));
  }
  const immediateScheduled = { scheduled: false };
  function toggleImmediateRef(ref) {
    if (ref && !immediateScheduled.scheduled) {
      immediateScheduled.scheduled = true;
      hostSetTimeout(() => {
        immediateScheduled.scheduled = false;
        try {
          g.__ocProcessImmediate?.();
        } catch (e) {
          g.__ocDebugHook?.("[processImmediate error] " + String(e));
        }
      }, 0);
    }
  }
  return {
    kTimeout: Symbol("nodejs.timeout"),
    kRefed: Symbol("nodejs.timeout.refed"),
    kUnrefed: Symbol("nodejs.timeout.unrefed"),
    immediateInfo,
    timeoutInfo,
    timerListMap: new Map,
    getLibuvNow,
    scheduleTimer,
    toggleTimerRef(_ref) {},
    toggleImmediateRef,
    getActiveTimerCount() {
      return timeoutInfo[0];
    },
    getActiveImmediateCount() {
      return immediateInfo[1];
    }
  };
}

// src/packages/opencontainer/kernel/natives/stream-state.ts
var kReadBytesOrError = 0;
var kArrayBufferOffset = 1;
var kBytesWritten = 2;
var kLastWriteWasAsync = 3;
var kLastWriteErr = 4;
var kUvErrno = 5;
var kIsBigEndian = 6;
var UV_EOF = -4095;
var streamBaseState = new Int32Array(16);
function getStreamBaseState() {
  return streamBaseState;
}
var utf8Encoder = new TextEncoder;
function encodeChunk(chunk, encoding) {
  if (chunk instanceof Uint8Array)
    return chunk;
  const str = typeof chunk === "string" ? chunk : String(chunk);
  const enc = typeof encoding === "string" ? encoding.toLowerCase() : "utf8";
  if (enc === "latin1" || enc === "binary") {
    const out = new Uint8Array(str.length);
    for (let i = 0;i < str.length; i++)
      out[i] = str.charCodeAt(i) & 255;
    return out;
  }
  if (enc === "ascii") {
    const out = new Uint8Array(str.length);
    for (let i = 0;i < str.length; i++)
      out[i] = str.charCodeAt(i) & 127;
    return out;
  }
  if (enc === "ucs2" || enc === "utf16le" || enc === "utf-16le") {
    const out = new Uint8Array(str.length * 2);
    for (let i = 0;i < str.length; i++) {
      const code = str.charCodeAt(i);
      out[i * 2] = code & 255;
      out[i * 2 + 1] = code >> 8;
    }
    return out;
  }
  return utf8Encoder.encode(str);
}
function encodeWritevList(chunks, allBuffers) {
  const parts = [];
  if (allBuffers) {
    for (const c of chunks)
      parts.push(encodeChunk(c));
  } else {
    for (let i = 0;i + 1 < chunks.length; i += 2) {
      parts.push(encodeChunk(chunks[i], chunks[i + 1]));
    }
    if (chunks.length % 2 === 1)
      parts.push(encodeChunk(chunks[chunks.length - 1]));
  }
  let size = 0;
  for (const p of parts)
    size += p.byteLength;
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

// src/packages/opencontainer/kernel/natives/tty_wrap.ts
function makeTtyBinding(ctx) {
  class TtyHandle {
    fd;
    onread = null;
    reading = false;
    rawMode = false;
    constructor(fd, _ctx) {
      this.fd = fd;
      const handle = this;
      if (fd === 0)
        stdinHandle = handle;
    }
    get owner() {
      return this[OWNER];
    }
    writeUtf8String(req, data, cb) {
      ctx.hooks.onStdio(this.fd, data);
      cb?.(null);
      return 0;
    }
    writeBuffer(req, data) {
      ctx.hooks.onStdio(this.fd, data);
      return 0;
    }
    writeLatin1String(req, data) {
      ctx.hooks.onStdio(this.fd, data);
      return 0;
    }
    writeAsciiString(req, data) {
      ctx.hooks.onStdio(this.fd, data);
      return 0;
    }
    writeUcs2String(req, data) {
      ctx.hooks.onStdio(this.fd, data);
      return 0;
    }
    writev(req, chunks, allBuffers) {
      const data = encodeWritevList(chunks, allBuffers);
      ctx.hooks.onStdio(this.fd, data);
      return 0;
    }
    readStart() {
      this.reading = true;
    }
    readStop() {
      this.reading = false;
    }
    shutdown(req) {
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close() {
      if (stdinHandle === this)
        stdinHandle = null;
    }
    ref() {}
    unref() {}
    setRawMode(mode) {
      this.rawMode = mode !== 0;
      return 0;
    }
    setBlocking(_blocking) {
      return 0;
    }
    get isTTY() {
      return true;
    }
    get columns() {
      return globalThis.__oc?.terminalSize?.cols ?? 80;
    }
    get rows() {
      return globalThis.__oc?.terminalSize?.rows ?? 24;
    }
    getWindowSize(winSize) {
      winSize[0] = globalThis.__oc?.terminalSize?.cols ?? 80;
      winSize[1] = globalThis.__oc?.terminalSize?.rows ?? 24;
      return 0;
    }
    getsockname() {
      return { address: "127.0.0.1", port: 0, family: 2 };
    }
    getpeername() {
      return { address: "127.0.0.1", port: 0, family: 2 };
    }
  }
  const OWNER = Symbol("nodejs.stream.owner");
  let stdinHandle = null;
  const pendingChunks = [];
  let eofDelivered = false;
  let proc = null;
  function raiseSigint() {
    ctx.hooks.onStdio(1, `^C
`);
    try {
      if (proc && typeof proc.listenerCount === "function" && proc.listenerCount("SIGINT") > 0) {
        proc.emit("SIGINT", "SIGINT");
        return;
      }
      proc?.exit?.(130);
    } catch (e) {
      globalThis.__ocDebugHook?.("[sigint raise error] " + String(e));
    }
  }
  function deliverChunk(bytes) {
    const handle = stdinHandle;
    if (!handle || typeof handle.onread !== "function" || !handle.reading) {
      pendingChunks.push(bytes);
      return;
    }
    const state = getStreamBaseState();
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(ab);
    } catch (e) {
      globalThis.__ocDebugHook?.(`[stdin onread error] ${e?.stack ?? String(e)}`);
    }
  }
  function flushPending() {
    while (pendingChunks.length > 0) {
      const handle = stdinHandle;
      if (!handle || !handle.reading || typeof handle.onread !== "function")
        return;
      deliverChunk(pendingChunks.shift());
    }
  }
  const origReadStart = TtyHandle.prototype.readStart;
  TtyHandle.prototype.readStart = function() {
    origReadStart.call(this);
    flushPending();
  };
  function feedStdin(data) {
    if (eofDelivered)
      return;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.byteLength === 0)
      return;
    if (!stdinHandle?.rawMode) {
      const idx = bytes.indexOf(3);
      if (idx >= 0) {
        const before = bytes.subarray(0, idx);
        if (before.byteLength > 0)
          deliverChunk(before);
        raiseSigint();
        const after = bytes.subarray(idx + 1);
        if (after.byteLength > 0)
          deliverChunk(after);
        return;
      }
    }
    deliverChunk(bytes);
  }
  function sendStdinEof() {
    if (eofDelivered)
      return;
    eofDelivered = true;
    const handle = stdinHandle;
    if (!handle || typeof handle.onread !== "function")
      return;
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    try {
      handle.onread(new ArrayBuffer(0));
    } catch {}
  }
  function resetStdin() {
    eofDelivered = false;
    pendingChunks.length = 0;
  }
  return {
    TTY: TtyHandle,
    isTTY(fd) {
      if (fd !== 0 && fd !== 1 && fd !== 2)
        return false;
      const mode = ctx.stdio?.[fd];
      return !mode || mode.type === "tty";
    },
    getWindowWidth: (fd) => globalThis.__oc?.terminalSize?.cols ?? 80,
    getWindowHeight: (fd) => globalThis.__oc?.terminalSize?.rows ?? 24,
    UV_TTY_MODE_NORMAL: 0,
    UV_TTY_MODE_RAW: 1,
    UV_TTY_MODE_IO: 2,
    UV_TTY_MODE_RAW_VT: 3,
    ownerSymbol: OWNER,
    feedStdin,
    sendStdinEof,
    resetStdin,
    attachProcess(p) {
      proc = p;
    },
    stdinReading() {
      return stdinHandle?.reading === true;
    }
  };
}

// src/packages/opencontainer/kernel/natives/stream_wrap.ts
function makeStreamWrapBinding() {
  const streamBaseState2 = getStreamBaseState();
  return {
    streamBaseState: streamBaseState2,
    ShutdownWrap: class ShutdownWrap {
    },
    WriteWrap: class WriteWrap {
    },
    ConnectWrap: class ConnectWrap {
    },
    kReadBytesOrError,
    kArrayBufferOffset,
    kBytesWritten,
    kLastWriteWasAsync,
    kLastWriteErr,
    kUvErrno,
    kIsBigEndian,
    constants: {
      kReadBytesOrError,
      kArrayBufferOffset,
      kBytesWritten,
      kLastWriteWasAsync,
      kLastWriteErr,
      kUvErrno,
      kIsBigEndian
    },
    kStreamOwner: sharedSymbol("nodejs.stream.owner"),
    kStreamBaseField: sharedSymbol("nodejs.stream.base.field"),
    kReadStop: sharedSymbol("nodejs.stream.read.stop"),
    kReadStart: sharedSymbol("nodejs.stream.read.start"),
    kWriteGeneric: sharedSymbol("nodejs.stream.write.generic"),
    kUpdateTimer: sharedSymbol("nodejs.stream.update.timer"),
    kSetSimulated: sharedSymbol("nodejs.stream.set.simulated"),
    kAfterAttachedWriteDone: sharedSymbol("nodejs.stream.after.attached.write.done"),
    kTimeout: sharedSymbol("nodejs.stream.timeout"),
    kBufBase: sharedSymbol("nodejs.stream.buf_base"),
    kAsyncIdField: sharedSymbol("nodejs.stream.async_id_field"),
    shutdown(req, _handle) {
      queueMicrotask(() => req?.oncomplete?.(0));
    },
    StreamBase: class StreamBase {
      close() {}
      ref() {}
      unref() {}
    },
    writev(_req, _chunks, _cb) {
      return 0;
    },
    LibuvStreamWrap: class LibuvStreamWrap {
      constructor(..._a) {}
    },
    providers: {}
  };
}

// src/packages/opencontainer/kernel/natives/encoding.ts
function makeEncodingBinding() {
  const decoderCache = new Map;
  function getDecoder(enc) {
    let d = decoderCache.get(enc);
    if (!d) {
      try {
        d = new TextDecoder(enc);
      } catch {
        d = new TextDecoder("utf-8");
      }
      decoderCache.set(enc, d);
    }
    return d;
  }
  return {
    TextDecoder: class BindingTextDecoder {
      decode(buf, opts) {
        return getDecoder(this.encoding ?? "utf-8").decode(buf, opts);
      }
    },
    kEndOfBuffer: Symbol("nodejs.stringdecoder.end_of_buffer"),
    encodings: ["utf8", "utf16le", "latin1", "ascii", "base64", "hex"],
    getDecoder: (enc) => getDecoder(enc),
    encodingNames: ["utf8", "utf-8", "latin1", "binary", "base64", "hex", "ucs2", "utf16le"],
    internalEndOfStream: Symbol("nodejs.stringdecoder.eos")
  };
}

// src/packages/opencontainer/kernel/natives/string_decoder.ts
var kIncompleteCharactersStart = 0;
var kIncompleteCharactersEnd = 4;
var kMissingBytes = 4;
var kBufferedBytes = 5;
var kEncodingField = 6;
var kNumFields = 7;
var kSize = 7;
var ENCODINGS = [
  "ascii",
  "utf8",
  "base64",
  "base64url",
  "utf16le",
  "hex",
  "buffer",
  "latin1"
];
var states = new WeakMap;
function stateFor(sd) {
  let st = states.get(sd);
  if (!st) {
    st = { carry: new Uint8Array(0), td: null };
    states.set(sd, st);
  }
  return st;
}
function tdFor(st, name) {
  if (!st.td || st.td.__enc !== name) {
    const td = name === "utf16le" ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
    td.__enc = name;
    st.td = td;
  }
  return st.td;
}
function concat(a, b) {
  if (a.length === 0)
    return b;
  if (b.length === 0)
    return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function utf8TrailingIncomplete(bytes) {
  const n = bytes.length;
  if (n === 0)
    return 0;
  for (let back = 1;back <= Math.min(4, n); back++) {
    const b = bytes[n - back];
    if (b < 128)
      return 0;
    if (b >= 192) {
      const need = b >= 240 ? 4 : b >= 224 ? 3 : 2;
      if (back < need)
        return back;
      return 0;
    }
  }
  return 0;
}
function encodingOf(sd) {
  const idx = sd[kEncodingField] ?? 1;
  return ENCODINGS[idx] ?? "utf8";
}
function decode(sd, buf) {
  if (buf === undefined || buf === null)
    return "";
  const st = stateFor(sd);
  const enc = encodingOf(sd);
  const input = concat(st.carry, buf instanceof Uint8Array ? buf : new Uint8Array(0));
  st.carry = new Uint8Array(0);
  if (input.length === 0) {
    sd[kMissingBytes] = 0;
    sd[kBufferedBytes] = 0;
    return "";
  }
  switch (enc) {
    case "utf8":
    case "utf16le": {
      let pending;
      if (enc === "utf8")
        pending = utf8TrailingIncomplete(input);
      else
        pending = input.length % 2;
      const completeLen = input.length - pending;
      let out = "";
      if (completeLen > 0) {
        out = tdFor(st, enc).decode(input.subarray(0, completeLen), { stream: pending > 0 });
      }
      if (pending > 0)
        st.carry = input.slice(completeLen);
      sd[kMissingBytes] = pending;
      sd[kBufferedBytes] = pending;
      return out;
    }
    case "ascii":
    case "latin1":
    case "buffer": {
      let out = "";
      const CH = 32768;
      for (let i = 0;i < input.length; i += CH) {
        out += String.fromCharCode.apply(null, Array.from(input.subarray(i, i + CH)));
      }
      sd[kMissingBytes] = 0;
      sd[kBufferedBytes] = 0;
      return out;
    }
    case "hex": {
      const complete = input.length & ~1;
      let out = "";
      for (let i = 0;i < complete; i += 2) {
        out += HEX_CHARS[input[i] >> 4] + HEX_CHARS[input[i] & 15];
      }
      if (input.length & 1)
        st.carry = input.slice(complete);
      sd[kMissingBytes] = st.carry.length;
      sd[kBufferedBytes] = st.carry.length;
      return out;
    }
    case "base64":
    case "base64url": {
      const url = enc === "base64url";
      let s = "";
      const CH = 32768;
      for (let i = 0;i < input.length; i += CH) {
        s += String.fromCharCode.apply(null, Array.from(input.subarray(i, i + CH)));
      }
      if (url)
        s = s.replace(/-/g, "+").replace(/_/g, "/");
      s = s.replace(/[\t\n\f\r ]/g, "");
      const carryLen = s.length % 4 === 1 ? s.length - 1 : s.length - s.length % 4;
      const decodable = s.slice(0, carryLen);
      let out = "";
      if (decodable.length > 0) {
        try {
          out = atob(decodable);
        } catch {
          out = "";
        }
      }
      const carried = s.slice(carryLen);
      if (carried.length > 0) {
        const bytes = new Uint8Array(carried.length);
        for (let i = 0;i < carried.length; i++)
          bytes[i] = carried.charCodeAt(i);
        st.carry = bytes;
      }
      sd[kMissingBytes] = carried.length;
      sd[kBufferedBytes] = carried.length;
      let outStr = "";
      for (let i = 0;i < out.length; i += CH) {
        outStr += out.slice(i, i + CH);
      }
      return outStr;
    }
    default:
      return "";
  }
}
var HEX_CHARS = "0123456789abcdef";
function flush(sd) {
  const st = states.get(sd);
  if (!st || st.carry.length === 0) {
    sd[kMissingBytes] = 0;
    sd[kBufferedBytes] = 0;
    return "";
  }
  const enc = encodingOf(sd);
  const carry = st.carry;
  st.carry = new Uint8Array(0);
  sd[kMissingBytes] = 0;
  sd[kBufferedBytes] = 0;
  if (enc === "utf8" || enc === "utf16le") {
    try {
      return tdFor(st, enc).decode(carry);
    } catch {
      return "�".repeat(enc === "utf16le" ? Math.ceil(carry.length / 2) : carry.length);
    }
  }
  if (enc === "hex" && carry.length === 1) {
    return HEX_CHARS[carry[0] >> 4];
  }
  if (enc === "base64" || enc === "base64url") {
    let s = "";
    for (let i = 0;i < carry.length; i++)
      s += String.fromCharCode(carry[i]);
    if (enc === "base64url")
      s = s.replace(/-/g, "+").replace(/_/g, "/");
    try {
      return atob(s);
    } catch {
      return "";
    }
  }
  return "";
}
function makeStringDecoderBinding() {
  return {
    kIncompleteCharactersStart,
    kIncompleteCharactersEnd,
    kMissingBytes,
    kBufferedBytes,
    kEncodingField,
    kNumFields,
    kSize,
    encodings: [...ENCODINGS],
    decode,
    flush
  };
}

// src/packages/opencontainer/kernel/natives/types.ts
function makeTypesBinding() {
  const HAS_SAB = typeof SharedArrayBuffer !== "undefined";
  return {
    isAsyncFunction(fn) {
      return typeof fn === "function" && fn.constructor?.name === "AsyncFunction";
    },
    isArgumentsObject(v) {
      return false;
    },
    isBigIntObject(v) {
      return v instanceof BigInt;
    },
    isBooleanObject(v) {
      return v instanceof Boolean;
    },
    isBoolean(v) {
      return typeof v === "boolean";
    },
    isDate(v) {
      return v instanceof Date;
    },
    isNativeError(v) {
      if (typeof v !== "object" || v === null)
        return false;
      let cur = v;
      while (cur) {
        if (typeof cur === "function")
          break;
        cur = Object.getPrototypeOf(cur);
        if (cur?.constructor?.name === "Error")
          return true;
      }
      return false;
    },
    isFunction(v) {
      return typeof v === "function";
    },
    isNumberObject(v) {
      return v instanceof Number;
    },
    isNumber(v) {
      return typeof v === "number";
    },
    isPromise(v) {
      return v instanceof Promise;
    },
    isRegExp(v) {
      return v instanceof RegExp;
    },
    isString(v) {
      return typeof v === "string";
    },
    isStringObject(v) {
      return v instanceof String;
    },
    isSymbolObject(v) {
      return v instanceof Symbol;
    },
    isSymbol(v) {
      return typeof v === "symbol";
    },
    isPrimitive(v) {
      return v === null || typeof v !== "object" && typeof v !== "function";
    },
    isAnyArrayBuffer(v) {
      return v instanceof ArrayBuffer || HAS_SAB && v instanceof SharedArrayBuffer;
    },
    isArrayBuffer(v) {
      return v instanceof ArrayBuffer;
    },
    isSharedArrayBuffer(v) {
      return HAS_SAB && v instanceof SharedArrayBuffer;
    },
    isArrayBufferDetached(v) {
      return v instanceof ArrayBuffer && v.byteLength === 0 && v.__detached === true;
    },
    isArrayBufferView(v) {
      return ArrayBuffer.isView(v);
    },
    isDataView(v) {
      return v instanceof DataView;
    },
    isTypedArray(v) {
      return ArrayBuffer.isView(v) && !(v instanceof DataView);
    },
    isUint8Array(v) {
      return v instanceof Uint8Array;
    },
    isUint8ClampedArray(v) {
      return v instanceof Uint8ClampedArray;
    },
    isInt8Array(v) {
      return v instanceof Int8Array;
    },
    isUint16Array(v) {
      return v instanceof Uint16Array;
    },
    isInt16Array(v) {
      return v instanceof Int16Array;
    },
    isUint32Array(v) {
      return v instanceof Uint32Array;
    },
    isInt32Array(v) {
      return v instanceof Int32Array;
    },
    isFloat32Array(v) {
      return v instanceof Float32Array;
    },
    isFloat64Array(v) {
      return v instanceof Float64Array;
    },
    isBigInt64Array(v) {
      return v instanceof BigInt64Array;
    },
    isBigUint64Array(v) {
      return v instanceof BigUint64Array;
    },
    isKeyObject(v) {
      return false;
    },
    isCryptoKey(v) {
      return typeof CryptoKey !== "undefined" && v instanceof CryptoKey;
    },
    isWeakMap(v) {
      return v instanceof WeakMap;
    },
    isMap(v) {
      return v instanceof Map;
    },
    isSet(v) {
      return v instanceof Set;
    },
    isWeakSet(v) {
      return v instanceof WeakSet;
    },
    isMapIterator(v) {
      return false;
    },
    isSetIterator(v) {
      return false;
    },
    isWeakCollection() {
      return false;
    },
    isProxy(v) {
      return false;
    },
    isBoxedPrimitive(v) {
      return v instanceof Boolean || v instanceof Number || v instanceof String || v instanceof Symbol || v instanceof BigInt;
    },
    isExternal(v) {
      return false;
    },
    isModuleNamespaceObject(v) {
      if (typeof v !== "object" || v === null)
        return false;
      const desc = Object.getOwnPropertyDescriptor(v, Symbol.toStringTag);
      return desc?.value === "Module";
    },
    isJSReceiver(v) {
      return typeof v === "object" && v !== null || typeof v === "function";
    },
    isJSProxy() {
      return false;
    },
    isRegExpExecFast() {
      return false;
    },
    isUint32() {
      return false;
    },
    getPromiseDetails(p) {
      return;
    },
    getProxyDetails(p) {
      return;
    },
    previewEntries(v) {
      return;
    }
  };
}

// src/packages/opencontainer/kernel/natives/cjs_lexer.ts
function makeCjsLexerBinding() {
  function parse(source) {
    const exportNames = new Set;
    const reexports = [];
    const memberRe = /(?:^|[\n;])\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
    let m;
    while (m = memberRe.exec(source))
      exportNames.add(m[1]);
    const objectRe = /(?:^|[\n;])\s*module\.exports\s*=\s*\{([^}]*)\}/g;
    while (m = objectRe.exec(source)) {
      for (const raw of m[1].split(",")) {
        const part = raw.trim();
        if (!part)
          continue;
        const simple = /^([A-Za-z_$][\w$]*)\s*:$/.exec(part);
        const renamed = /^([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*$/.exec(part);
        const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(part);
        const name = simple?.[1] ?? renamed?.[1] ?? shorthand?.[1];
        if (name)
          exportNames.add(name);
      }
    }
    const reexportRe = /(?:^|[\n;])\s*module\.exports\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while (m = reexportRe.exec(source))
      reexports.push(m[1]);
    return [exportNames, reexports];
  }
  return {
    parse,
    detectModuleSyntax: (source) => /(^|[\n;})])\s*(import\s+[\s({'"]|import\s*\.|export\s+(default|{|\*|const|let|var|function|class|async)\b)/.test(source)
  };
}

// src/packages/opencontainer/kernel/natives/misc.ts
function makeMiscBindings() {
  return {
    diagnostics_channel: (() => {
      const subscribers = [];
      const channels = new Map;
      return {
        channelCount: 0,
        subscribers,
        channel(name) {
          let c = channels.get(name);
          if (!c) {
            c = { name, _subscribers: [] };
            channels.set(name, c);
          }
          return c;
        },
        hasSubscribers(name) {
          return channels.has(name);
        },
        subscribe(name, onMessage) {
          const c = this.channel(name);
          c._subscribers.push(onMessage);
        },
        unsubscribe(name, onMessage) {
          const c = this.channel(name);
          c._subscribers = c._subscribers.filter((s) => s !== onMessage);
        },
        linkNativeChannel(link) {
          return (name, index) => {
            const linked = this.channel(name);
            linked._index = index;
            subscribers[index] = linked._subscribers?.length ?? 0;
            return linked;
          };
        }
      };
    })(),
    async_context_frame: {
      currentAsyncFrame() {
        return null;
      },
      captureAsyncFrame(fn) {
        return fn;
      },
      setAsyncFrame() {},
      kAsyncContextFrame: Symbol("nodejs.async_context_frame")
    },
    async_wrap: (() => {
      const async_hook_fields = new Uint32Array(8);
      const async_id_fields = new Float64Array(8);
      const async_ids_stack = new Float64Array(32);
      const execution_async_resources = [];
      let stackTop = 0;
      return {
        async_hook_fields,
        async_id_fields,
        async_ids_stack,
        execution_async_resources,
        setCallbackTrampoline() {},
        setupHooks(hooks) {},
        pushAsyncContext(executionAsyncId, triggerAsyncId) {
          stackTop += 2;
          if (stackTop >= async_ids_stack.length)
            return false;
          async_ids_stack[stackTop - 2] = executionAsyncId;
          async_ids_stack[stackTop - 1] = triggerAsyncId;
          return true;
        },
        popAsyncContext(executionAsyncId) {
          if (async_ids_stack[stackTop - 2] === executionAsyncId) {
            stackTop -= 2;
            return true;
          }
          return false;
        },
        clearAsyncIdStack() {
          stackTop = 0;
        },
        executionAsyncResource() {
          return execution_async_resources[execution_async_resources.length - 1] ?? Object.create(null);
        },
        constants: {
          kInit: 0,
          kBefore: 1,
          kAfter: 2,
          kDestroy: 3,
          kTotals: 4,
          kPromiseResolve: 5,
          kCheck: 6,
          kExecutionAsyncId: 0,
          kAsyncIdCounter: 1,
          kTriggerAsyncId: 2,
          kDefaultTriggerAsyncId: 3,
          kStackLength: 4,
          kUsesExecutionAsyncResource: 5
        },
        registerDestroyHook(resource, asyncId) {},
        queueDestroyAsyncId(asyncId) {},
        destroyIdsInList() {},
        emitBeforeNative(asyncId) {},
        emitAfterNative(asyncId) {},
        emitInitNative(asyncId, type, triggerAsyncId, resource) {},
        emitDestroyNative(asyncId) {},
        enableHooks() {},
        disableHooks() {},
        resetDefaultTriggerAsyncId() {},
        setDefaultTriggerAsyncId(id) {},
        setPromiseHooks(init, before, after, settled) {},
        Providers: { NONE: 0, DIRHANDLE: 1, PIPE: 2, PROCESS: 3, SIGNAL: 4, TCP: 5, TTY: 6, UDP: 7, FILELOAD: 8, FSREQ: 9, STATS: 10, CRYPTO: 11 }
      };
    })(),
    blob: {
      createBlob: () => null,
      BlobDataHandle: class {
      }
    },
    sea: {
      isSea: false,
      getSeaAssetOrAssetSync() {
        throw Object.assign(new Error("not in a sea executable"), { code: "ERR_NOT_IN_SEA" });
      },
      getRawAssetKeys: () => []
    },
    inspector: {
      callAndPauseOnStart() {},
      enabled: false,
      registerAsyncHook() {},
      asyncTaskCanceled() {},
      asyncTaskFinished() {},
      asyncTaskScheduled() {
        return 0;
      },
      asyncTaskStarted() {},
      console: {},
      consoleCall() {},
      emitProtocolEvent() {},
      isEnabled: () => false,
      open() {
        throw new Error("inspector is not supported in OpenContainer");
      },
      url: undefined,
      waitForDebugger() {},
      Connection: class Connection {
      },
      MainThreadConnection: class MainThreadConnection {
      },
      setupNetworkTracking() {},
      putNetworkResource() {},
      setConsoleExtensionInstaller() {}
    },
    profiler: {
      startProfiler: undefined,
      stopProfiler: undefined
    },
    trace_events: (() => {
      const categoryBuffer = new Uint8Array(32);

      class CategorySet {
        categories;
        constructor(categories = []) {
          this.categories = categories;
        }
        enable() {}
        disable() {}
      }
      return {
        traceEventEnabled: false,
        emit: () => {},
        trace: () => {},
        hasAgent: () => false,
        usePerfetto: false,
        isTraceCategoryEnabled: (_category) => false,
        getEnabledCategories: () => "",
        CategorySet,
        getCategoryEnabledBuffer(_category) {
          return categoryBuffer;
        },
        setTraceCategoryStateUpdateHandler() {}
      };
    })(),
    messaging: (() => {
      return {
        DOMException: globalThis.DOMException ?? class DOMException extends Error {
          constructor(msg, name) {
            super(msg);
            this.name = name ?? "DOMException";
          }
        },
        kTransfer: Symbol("nodejs.messaging.transfer"),
        kClone: Symbol("nodejs.messaging.clone"),
        kDeserialize: Symbol("nodejs.messaging.deserialize"),
        kTransferHelper: Symbol("nodejs.messaging.transfer_helper"),
        kCloneHelper: Symbol("nodejs.messaging.clone_helper"),
        kDeserializeHelper: Symbol("nodejs.messaging.deserialize_helper"),
        kMessageChannel: Symbol("nodejs.messaging.message_channel"),
        kInspect: Symbol("nodejs.messaging.inspect"),
        kToArrayBuffer: Symbol("nodejs.messaging.to_array_buffer"),
        kIsDetached: Symbol("nodejs.messaging.is_detached"),
        kUntransferable: Symbol("nodejs.messaging.untransferable"),
        kDeserializePrimitive: Symbol("nodejs.messaging.deserialize_primitive"),
        MessagePort: EmuPort,
        MessageChannel: EmuMessageChannel,
        broadcastChannel: globalThis.BroadcastChannel ?? class {
        },
        drainMessagePort() {},
        stopMessagePort() {},
        moveMessagePortToContext() {
          throw new Error("OpenContainer: worker_threads context move is not supported");
        },
        receiveMessageOnPort() {
          throw new Error("OpenContainer: synchronous receiveMessageOnPort() is not supported (browser MessagePort has no synchronous read)");
        }
      };
    })(),
    js_stream: {
      JSStream: class JSStream {
      }
    },
    serdes: {
      Serializer: class {
      },
      Deserializer: class {
      }
    },
    ipc_serdes: {},
    spawn_sync: {
      spawn(_options) {
        const err = new Error("OpenContainer: child_process sync execution (execSync/execFileSync/spawnSync) " + "is not supported — async spawn/execFile work");
        err.code = "ENOSYS";
        throw err;
      }
    },
    signal_wrap: {
      Signal: class Signal {
        start() {
          return 0;
        }
        stop() {
          return 0;
        }
        close() {}
        ref() {}
        unref() {}
      }
    },
    udp_wrap: {
      UDP: class UDP {
        constructor() {
          throw new Error("OpenContainer: UDP sockets (dgram) are not supported — TCP virtual sockets only");
        }
      },
      SendWrap: class {
      },
      constants: {
        UV_UDP_IPV6ONLY: 1,
        UV_UDP_REUSEADDR: 4,
        UV_UDP_REUSEPORT: 8,
        UV_UDP_MMSG_CHUNK: 128,
        UV_UDP_MMSG_FREE: 256,
        UV_UDP_LRECVCAPACITY: 512,
        UV_UDP_LSENDCAPACITY: 1024
      }
    },
    cares_wrap: {
      getaddrinfo(req, hostname, family, _hints, _order) {
        const wantV6 = family === 6;
        const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "::" || hostname === "0.0.0.0" || hostname === "localhost" && wantV6;
        queueMicrotask(() => {
          if (local) {
            const ip = wantV6 || hostname === "::1" || hostname === "::" ? "::1" : "127.0.0.1";
            req.oncomplete?.(null, [ip]);
          } else {
            const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
            err.code = "ENOTFOUND";
            err.errno = -3008;
            err.syscall = "getaddrinfo";
            err.hostname = hostname;
            req.oncomplete?.(err);
          }
        });
      },
      cares_getaddrinfo(req, hostname, family, hints, order) {
        this.getaddrinfo(req, hostname, family, hints, order);
      },
      cares_query: undefined,
      ChannelWrap: class ChannelWrap {
        timeout;
        tries;
        maxTimeout;
        constructor(timeout, tries, maxTimeout) {
          this.timeout = timeout;
          this.tries = tries;
          this.maxTimeout = maxTimeout;
        }
      },
      Channel: class Channel {
      },
      GetAddrInfoReqWrap: class GetAddrInfoReqWrap {
      },
      strerror(code) {
        return `c-ares error ${code}`;
      }
    },
    tls_wrap: {
      TLSCallbacks: {},
      TLSWrap: class {
      }
    },
    quic: {},
    wasm_web_api: {
      setImplementation(_fn) {}
    },
    dtls: {},
    ffi: {},
    wasi: {},
    webstorage: {
      localStorage: undefined,
      sessionStorage: undefined
    },
    watchdog: {
      start: () => {},
      stop: () => {},
      TraceSigintWatchdog: class TraceSigintWatchdog {
        start() {
          return true;
        }
        stop() {
          return false;
        }
      }
    },
    mksnapshot: {
      isBuildingSnapshotBuffer: new Uint8Array([0]),
      setSerializeCallback() {},
      setDeserializeCallback() {},
      setDeserializeMainFunction() {},
      startupSnapshot: {
        namespace: {
          addSerializeCallback() {},
          addDeserializeCallback() {},
          isBuildingSnapshot: () => false,
          addSerializeHooksToEmbedder() {}
        },
        runDeserializeCallbacks() {}
      }
    },
    report: {
      getReport: () => "",
      writeReport: () => "",
      getCompact: () => false,
      getDirectory: () => "",
      getExcludeEnv: () => "",
      getExcludeNetwork: () => false,
      getFilename: () => "",
      getSignal: () => "SIGUSR2",
      setCompact(_v) {},
      setDirectory(_v) {},
      setExcludeEnv(_v) {},
      setExcludeNetwork(_v) {},
      setFilename(_v) {},
      setReportOnFatalError(_v) {},
      setReportOnSignal(_v) {},
      setReportOnUncaughtException(_v) {},
      setSignal(_v) {},
      shouldReportOnFatalError: () => false,
      shouldReportOnSignal: () => false,
      shouldReportOnUncaughtException: () => false
    },
    permission: { isEnabled: () => false, isEnabledWhenHasNestedLookup: () => false },
    locks: {},
    heap_utils: {},
    internal_only_v8: {},
    sqlite: {
      DatabaseSync: class DatabaseSync {
        constructor() {
          throw new Error("node:sqlite is not supported in OpenContainer (S5 candidate via sql.js)");
        }
      }
    },
    icu: {},
    block_list: {
      BlockList: class BlockList {
        addSubnet() {}
        addRange() {}
        addAddress() {}
      }
    }
  };
}

// src/packages/opencontainer/kernel/natives/zlib.ts
init_browser();
var zlibPending = 0;
function zlibPendingCount() {
  return zlibPending;
}
var Z_SYNC_FLUSH = 2;
var Z_FULL_FLUSH = 3;
var Z_FINISH = 4;
var Z_BLOCK = 5;
var Z_TREES = 6;
var MODE_DEFLATE = 1;
var MODE_INFLATE = 2;
var MODE_GZIP = 3;
var MODE_GUNZIP = 4;
var MODE_DEFLATERAW = 5;
var MODE_INFLATERAW = 6;
var MODE_UNZIP = 7;
var EMPTY = new Uint8Array(0);
function makeUnzipAutoStream() {
  const wrapper = {
    ondata: null,
    _buf: [],
    _bufLen: 0,
    _inner: null,
    push(chunk, final) {
      if (this._inner)
        return this._inner.push(chunk, final);
      if (chunk.length > 0) {
        this._buf.push(chunk);
        this._bufLen += chunk.length;
      }
      if (this._bufLen < 2) {
        if (final) {
          const inner2 = new Unzlib;
          inner2.ondata = (d) => {
            if (d && d.length)
              wrapper.ondata?.(d);
          };
          this._inner = inner2;
          for (const c of this._buf)
            inner2.push(c, false);
          inner2.push(EMPTY, true);
        }
        return;
      }
      const head = new Uint8Array(2);
      let n = 0;
      for (const c of this._buf) {
        const take = Math.min(c.length, 2 - n);
        head.set(c.subarray(0, take), n);
        n += take;
        if (n >= 2)
          break;
      }
      const inner = head[0] === 31 && head[1] === 139 ? new Gunzip : new Unzlib;
      inner.ondata = (d) => {
        if (d && d.length)
          wrapper.ondata?.(d);
      };
      this._inner = inner;
      for (const c of this._buf)
        inner.push(c, false);
      if (final)
        inner.push(EMPTY, true);
    }
  };
  return wrapper;
}
var CRC_TABLE = new Uint32Array(256);
for (let n = 0;n < 256; n++) {
  let c = n;
  for (let k = 0;k < 8; k++)
    c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data, value = 0) {
  let crc2 = value >>> 0 ^ 4294967295;
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  for (let i2 = 0;i2 < bytes.length; i2++) {
    crc2 = CRC_TABLE[(crc2 ^ bytes[i2]) & 255] ^ crc2 >>> 8;
  }
  return (crc2 ^ 4294967295) >>> 0;
}
var BROTLI_ZSTD_STUB = "OpenContainer: node:zlib Brotli/Zstd streams are not implemented (no " + "browser-side brotli/zstd codec is vendored). DEFLATE/GZIP/RAW/UNZIP are real.";
function makeZlibBinding() {
  const zerr = (e) => {
    const message = String(e?.message ?? e ?? "zlib error");
    return { message: `OpenContainer: ${message}`, errno: -3, code: "Z_DATA_ERROR" };
  };

  class HandleBase {
    onerror = null;
    writeState = null;
    processCb = null;
    rejectGarbageAfterEnd = false;
    pending = [];
    finished = false;
    closed = false;
    init(_windowBits, _level, _memLevel, _strategy, writeState, processCallback, _dictionary, rejectGarbageAfterEnd) {
      this.writeState = writeState;
      this.processCb = processCallback;
      this.rejectGarbageAfterEnd = rejectGarbageAfterEnd === true;
    }
    drain(out, outOff, outLen) {
      let copied = 0;
      while (this.pending.length > 0 && copied < outLen) {
        const head = this.pending[0];
        const take = Math.min(head.length, outLen - copied);
        if (take === head.length) {
          out.set(head, outOff + copied);
          this.pending.shift();
        } else {
          out.set(head.subarray(0, take), outOff + copied);
          this.pending[0] = head.subarray(take);
        }
        copied += take;
      }
      if (this.writeState) {
        this.writeState[0] = outLen - copied;
        this.writeState[1] = 0;
      }
    }
    raise(e) {
      const { message, errno, code } = zerr(e);
      this.onerror?.(message, errno, code);
      const err2 = new Error(message);
      err2.errno = errno;
      err2.code = code;
      throw err2;
    }
    close() {
      this.closed = true;
      this.pending = [];
    }
    reset() {
      this.pending = [];
      this.finished = false;
    }
    params(_level, _strategy) {}
  }

  class ZlibHandle extends HandleBase {
    mode;
    stream = null;
    opts;
    constructor(mode) {
      super();
      this.mode = mode;
    }
    init(windowBits, level, memLevel, strategy, writeState, processCallback, dictionary, rejectGarbageAfterEnd) {
      super.init(windowBits, level, memLevel, strategy, writeState, processCallback, dictionary, rejectGarbageAfterEnd);
      const opts = {};
      if (typeof level === "number" && level >= 0 && level <= 9)
        opts.level = level;
      if (dictionary && dictionary.byteLength > 0) {
        opts.dictionary = dictionary instanceof Uint8Array ? dictionary : new Uint8Array(dictionary);
      }
      this.opts = opts;
      this.stream = this.makeStream(opts);
    }
    makeStream(opts) {
      let stream;
      switch (this.mode) {
        case MODE_DEFLATE:
          stream = new Zlib(opts);
          break;
        case MODE_INFLATE:
          stream = new Unzlib(opts);
          break;
        case MODE_GZIP:
          stream = new Gzip(opts);
          break;
        case MODE_GUNZIP:
          stream = new Gunzip(opts);
          break;
        case MODE_DEFLATERAW:
          stream = new Deflate(opts);
          break;
        case MODE_INFLATERAW:
          stream = new Inflate(opts);
          break;
        case MODE_UNZIP:
          stream = makeUnzipAutoStream();
          break;
        default: {
          const err2 = new Error(`OpenContainer: unsupported zlib mode ${this.mode}`);
          err2.code = "ENOSYS";
          throw err2;
        }
      }
      stream.ondata = (data) => {
        if (data && data.length > 0)
          this.pending.push(data);
      };
      return stream;
    }
    process(flushFlag, in_, inOff, inLen) {
      if (this.closed || !this.stream)
        return;
      const chunk = inLen > 0 ? in_.subarray(inOff, inOff + inLen) : EMPTY;
      if (this.finished) {
        if (chunk.length > 0 && this.rejectGarbageAfterEnd) {
          this.onerror?.("OpenContainer: trailing junk after end of stream", -3, "ERR_TRAILING_JUNK_AFTER_STREAM_END");
        }
        return;
      }
      const final = flushFlag === Z_FINISH;
      try {
        if (final) {
          this.stream.push(chunk, true);
          this.finished = true;
        } else if (chunk.length > 0) {
          this.stream.push(chunk, false);
        }
        if (!final && this.mode !== MODE_INFLATE && this.mode !== MODE_GUNZIP && this.mode !== MODE_INFLATERAW && this.mode !== MODE_UNZIP && (flushFlag === Z_SYNC_FLUSH || flushFlag === Z_FULL_FLUSH || flushFlag === Z_BLOCK || flushFlag === Z_TREES) && typeof this.stream.flush === "function") {
          this.stream.flush(flushFlag === Z_SYNC_FLUSH);
        }
      } catch (e) {
        this.finished = true;
        this.raise(e);
      }
    }
    write(flushFlag, in_, inOff, inLen, out, outOff, outLen) {
      try {
        this.process(flushFlag, in_, inOff, inLen);
      } catch {
        this.drain(out, outOff, 0);
        this.writeState[0] = outLen;
        this.writeState[1] = 0;
        const cb2 = this.processCb;
        if (cb2) {
          zlibPending++;
          queueMicrotask(() => {
            zlibPending--;
            cb2.call(this);
          });
        }
        return;
      }
      this.drain(out, outOff, outLen);
      const cb = this.processCb;
      if (cb) {
        zlibPending++;
        queueMicrotask(() => {
          zlibPending--;
          cb.call(this);
        });
      }
    }
    writeSync(flushFlag, in_, inOff, inLen, out, outOff, outLen) {
      this.process(flushFlag, in_, inOff, inLen);
      this.drain(out, outOff, outLen);
    }
    reset() {
      super.reset();
      if (this.opts !== undefined)
        this.stream = this.makeStream(this.opts);
    }
    params(level, _strategy) {
      if (this.stream?.o && typeof level === "number")
        this.stream.o.level = level;
    }
  }

  class EnosysHandle {
    onerror = null;
    init(..._args) {
      const err2 = new Error(BROTLI_ZSTD_STUB);
      err2.code = "ENOSYS";
      err2.errno = 38;
      throw err2;
    }
  }
  return {
    crc32,
    Zlib: ZlibHandle,
    BrotliDecoder: EnosysHandle,
    BrotliEncoder: EnosysHandle,
    ZstdCompress: EnosysHandle,
    ZstdDecompress: EnosysHandle
  };
}

// src/packages/opencontainer/kernel/natives/process_wrap.ts
function makeProcessWrapBinding(ctx) {
  const hooks = ctx.hooks;
  const children = new Map;
  const liveProcesses = new Set;
  let pidCounter = globalThis.__ocPidBase ?? 100;
  let pipeIdCounter = globalThis.__ocPipeIdBase ?? 1;
  function resolveExecutable(file, env) {
    if (file.includes("/")) {
      const abs = file.startsWith("/") ? file : ctx.cwd() + "/" + file;
      try {
        ctx.vfs.stat(abs);
      } catch {
        return -2;
      }
      return abs;
    }
    const path = (env.PATH ?? "").split(":").filter(Boolean);
    for (const dir of path) {
      const candidate = dir.endsWith("/") ? dir + file : dir + "/" + file;
      try {
        ctx.vfs.stat(candidate);
        return candidate;
      } catch {}
    }
    return -2;
  }
  function parseShebang(path) {
    let head = "";
    try {
      head = new TextDecoder().decode(ctx.vfs.readFile(path).subarray(0, 256));
    } catch {
      return null;
    }
    const m = /^#!([^\n\r]*)/.exec(head);
    if (!m)
      return null;
    const parts = m[1].trim().split(/\s+/);
    let interp = parts[0] ?? "";
    if (interp.split("/").pop() === "env" || interp === "/usr/bin/env" || interp === "env") {
      const rest = parts.slice(1);
      const program = rest.find((p) => !p.startsWith("-")) ?? "";
      if (program)
        interp = program;
    }
    return { interpreter: interp, arg: parts[1] };
  }
  function interpreterKind(interp) {
    const base = interp.split("/").pop() ?? interp;
    if (base === "node" || base === "node.exe" || interp === "/usr/local/bin/node" || interp === "/usr/bin/node")
      return "node";
    if (base === "sh" || base === "bash" || base === "dash" || base === "zsh")
      return "sh";
    return "unsupported";
  }
  const NODE_BIN = new Set(["/usr/local/bin/node", "/usr/bin/node", "/bin/node"]);

  class Process {
    onexit = null;
    pid = 0;
    myPid = null;
    constructor() {
      liveProcesses.add(this);
    }
    spawn(file, args, cwd, envPairs, stdio, _flags, _uid, _gid) {
      if (!file)
        return -2;
      if (stdio && stdio.some((s) => s && s.ipc)) {
        throw new Error("OpenContainer: child_process IPC channels (fork()/stdio:'ipc') are not supported — " + "spawn with pipe/inherit/ignore stdio works");
      }
      const env = {};
      for (const pair of envPairs ?? []) {
        const eq = pair.indexOf("=");
        if (eq > 0)
          env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      if (envPairs === undefined) {
        Object.assign(env, globalThis.__ocEnv?.() ?? {});
      }
      const resolved = resolveExecutable(file, env);
      if (typeof resolved === "number") {
        queueMicrotask(() => this.onexit?.(resolved, null));
        return 0;
      }
      const argv = args ?? [];
      const realArgs = argv.length > 0 ? argv.slice(1) : [];
      let script = null;
      let nodeArgs = [];
      if (NODE_BIN.has(resolved)) {
        nodeArgs = realArgs;
        script = null;
      } else {
        const shebang = parseShebang(resolved);
        const kind = shebang ? interpreterKind(shebang.interpreter) : "unsupported";
        if (shebang && kind === "node") {
          script = resolved;
        } else if (shebang && kind === "sh") {
          script = shebang.interpreter.startsWith("/") ? shebang.interpreter : resolveExecutable(shebang.interpreter, env);
          if (typeof script !== "string") {
            queueMicrotask(() => this.onexit?.(-8, null));
            return 0;
          }
        } else if (!shebang) {
          queueMicrotask(() => this.onexit?.(-8, null));
          return 0;
        } else {
          queueMicrotask(() => this.onexit?.(-8, null));
          return 0;
        }
      }
      const childStdio = [];
      const handles = [];
      if (stdio) {
        for (const s of stdio) {
          if (!s) {
            childStdio.push({ type: "ignore" });
            continue;
          }
          if (s.type === "pipe" || s.type === "overlapped") {
            const pipeId = pipeIdCounter++;
            childStdio.push({ type: "pipe", pipeId });
            if (s.handle) {
              s.handle.pipeId = pipeId;
              handles.push(s.handle);
              const pipeB = globalThis.getInternalBinding?.("pipe_wrap");
              pipeB?.__registerHandle?.(pipeId, s.handle);
            }
          } else if (s.type === "inherit" || s.type === "fd" && s.fd !== undefined && s.fd >= 0 && s.fd <= 2) {
            childStdio.push({ type: "inherit" });
          } else {
            childStdio.push({ type: "ignore" });
          }
        }
      } else {
        childStdio.push({ type: "ignore" }, { type: "ignore" }, { type: "ignore" });
      }
      const pid = pidCounter++;
      this.pid = pid;
      this.myPid = pid;
      children.set(pid, { file: resolved, alive: true });
      const req = {
        pid,
        file: script,
        args: script === null ? [] : realArgs,
        interpreter: "node",
        cwd: cwd || ctx.cwd(),
        env,
        stdio: childStdio,
        nodeArgs
      };
      globalThis.__ocFlushVfsDeltas?.();
      hooks.onChildSpawn?.(req);
      return 0;
    }
    kill(signal) {
      const pid = this.myPid;
      if (pid === null)
        return 0;
      const child = children.get(pid);
      if (!child || !child.alive)
        return -3;
      hooks.onChildKill?.(pid, typeof signal === "string" ? signal : signalName(Number(signal)));
      return 0;
    }
    close() {
      liveProcesses.delete(this);
      if (this.myPid !== null && children.get(this.myPid)?.alive === false) {
        children.delete(this.myPid);
      }
    }
    ref() {}
    unref() {}
  }
  function signalName(n) {
    const names = { 2: "SIGINT", 9: "SIGKILL", 15: "SIGTERM" };
    return names[n] ?? "SIGTERM";
  }
  return {
    Process,
    constants: {
      kProcessFlagDetached: 1,
      kProcessFlagWindowsHide: 2,
      kProcessFlagWindowsVerbatimArguments: 4
    },
    getEnvPairs() {
      const env = globalThis.__ocEnv?.() ?? {};
      return Object.entries(env).map(([k, v]) => `${k}=${v}`);
    },
    notifyChildExit(pid, exitCode, signalCode) {
      const child = children.get(pid);
      if (child)
        child.alive = false;
      for (const p of liveProcesses) {
        if (p.myPid === pid) {
          p.onexit?.(exitCode, signalCode);
        }
      }
    },
    activeChildCount() {
      let n = 0;
      for (const c of children.values())
        if (c.alive)
          n++;
      return n;
    },
    __setPipeIdBase(base) {
      pipeIdCounter = base;
    }
  };
}

// src/packages/opencontainer/kernel/natives/pipe_wrap.ts
var asyncIdCounter = 0;
function nextAsyncId() {
  return ++asyncIdCounter + 1000;
}
function makePipeWrapBinding(ctx) {
  const hooks = ctx.hooks;
  const registry3 = new Map;
  const eofSeen = new Set;
  const PIPE_SOCKET = 1;
  const PIPE_SERVER = 0;
  const PIPE_IPC = 2;

  class Pipe {
    pipeType;
    onread = null;
    reading = false;
    fd = -1;
    pipeId = null;
    pending = [];
    constructor(pipeType = PIPE_SOCKET) {
      this.pipeType = pipeType;
      if (pipeType === PIPE_IPC) {
        throw new Error("OpenContainer: pipe_wrap IPC handles (fork()/stdio:'ipc') are not supported");
      }
    }
    getAsyncId() {
      return nextAsyncId();
    }
    open(fd2) {
      this.fd = fd2;
      const mode = ctx.stdio?.[fd2];
      if (mode && mode.type === "pipe" && mode.pipeId !== undefined) {
        this.pipeId = mode.pipeId;
        registry3.set(this.pipeId, this);
        if (eofSeen.has(this.pipeId)) {
          eofSeen.delete(this.pipeId);
          deliverEof(this);
        }
      }
      return 0;
    }
    out(data) {
      if (this.pipeId !== null)
        hooks.onPipeWrite?.(this.pipeId, data);
    }
    writeUtf8String(req, data, cb) {
      this.out(new TextEncoder().encode(data));
      cb?.(null);
      return 0;
    }
    writeBuffer(req, data) {
      this.out(data);
      return 0;
    }
    writeLatin1String(req, data) {
      const bytes = new Uint8Array(data.length);
      for (let i2 = 0;i2 < data.length; i2++)
        bytes[i2] = data.charCodeAt(i2) & 255;
      this.out(bytes);
      return 0;
    }
    writeAsciiString(req, data) {
      this.writeLatin1String(req, data);
      return 0;
    }
    writeUcs2String(req, data) {
      this.out(new TextEncoder().encode(data));
      return 0;
    }
    writev(req, chunks, allBuffers) {
      const data = encodeWritevList(chunks, allBuffers);
      this.out(data);
      return 0;
    }
    readStart() {
      this.reading = true;
      while (this.pending.length > 0 && this.reading && typeof this.onread === "function") {
        deliver(this, this.pending.shift());
      }
    }
    readStop() {
      this.reading = false;
    }
    shutdown(req) {
      if (this.pipeId !== null)
        hooks.onPipeClose?.(this.pipeId, "shutdown");
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close(cb) {
      if (this.pipeId !== null) {
        if (registry3.get(this.pipeId) === this)
          registry3.delete(this.pipeId);
        hooks.onPipeClose?.(this.pipeId, "close");
      }
      if (typeof cb === "function")
        queueMicrotask(() => cb());
    }
    ref() {}
    unref() {}
    getsockname() {
      return { address: "127.0.0.1", port: 0, family: 2 };
    }
    getpeername() {
      return { address: "127.0.0.1", port: 0, family: 2 };
    }
    setBlocking(_b2) {
      return 0;
    }
    bind(name, _flags) {
      return uvErr("EACCES", `pipe bind(${name}) — unix domain sockets are not supported`);
    }
    connect(req, _name) {
      const err2 = uvErr("EACCES", "pipe connect — unix domain sockets are not supported");
      queueMicrotask(() => req?.oncomplete?.(err2));
      return 0;
    }
    fchmod(_mode) {
      return 0;
    }
  }
  function uvErr(name, message) {
    globalThis.__ocDebugHook?.(`[pipe_wrap] ${message}`);
    return -13;
  }
  function deliver(handle, bytes) {
    if (typeof handle.onread !== "function" || !handle.reading) {
      handle.pending.push(bytes);
      return;
    }
    const state = getStreamBaseState();
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(ab);
    } catch (e) {
      globalThis.__ocDebugHook?.(`[pipe onread error] ${e?.stack ?? e}`);
    }
  }
  function deliverEof(handle) {
    if (typeof handle.onread !== "function")
      return;
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(new ArrayBuffer(0));
    } catch {}
  }
  return {
    Pipe,
    PipeConnectWrap: class {
    },
    constants: {
      SOCKET: PIPE_SOCKET,
      SERVER: PIPE_SERVER,
      IPC: PIPE_IPC,
      UV_READABLE: 16,
      UV_WRITABLE: 32
    },
    kOwnedByPipe: Symbol("nodejs.pipe.owned"),
    __registerHandle(pipeId, handle) {
      registry3.set(Number(pipeId), handle);
      if (eofSeen.has(Number(pipeId))) {
        eofSeen.delete(Number(pipeId));
        deliverEof(handle);
      }
    },
    deliverPipeData(pipeId, bytes) {
      const handle = registry3.get(pipeId);
      if (!handle)
        return;
      deliver(handle, bytes);
    },
    deliverPipeEof(pipeId) {
      const handle = registry3.get(pipeId);
      if (handle)
        deliverEof(handle);
      else
        eofSeen.add(Number(pipeId));
    },
    activePipeCount() {
      let n = 0;
      for (const h of registry3.values()) {
        if (h && h.reading === true)
          n++;
      }
      return n;
    },
    __pipeIds() {
      return [...registry3.keys()];
    }
  };
}

// src/packages/opencontainer/kernel/natives/tcp_wrap.ts
var TCP_SOCKET = 0;
var TCP_SERVER = 1;
var LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);
var tcpAsyncId = 0;
function makeTcpWrapBinding(ctx) {
  const hooks = ctx.hooks;
  const sockets = new Map;
  const servers = new Map;
  const pendingConnects = new Map;
  let listenIdCounter = 1;
  let connIdCounter = globalThis.__ocConnIdBase ?? 1;
  let reqIdCounter = 1;
  let portsInUse = new Set;

  class TCP {
    handleType;
    onread = null;
    onconnection = null;
    reading = false;
    connId = null;
    listenId = null;
    localPort = 0;
    localHost = "0.0.0.0";
    remotePort = 0;
    closed = false;
    pending = [];
    constructor(handleType = TCP_SOCKET) {
      this.handleType = handleType;
    }
    getAsyncId() {
      return ++tcpAsyncId + 2000;
    }
    bind(address, port, _flags) {
      return this.bindInternal(address, port);
    }
    bind6(address, port, _flags) {
      return this.bindInternal(address, port);
    }
    bindInternal(address, port) {
      if (port > 0 && portsInUse.has(port)) {
        return -98;
      }
      this.localHost = address;
      this.localPort = port;
      return 0;
    }
    listen(backlog) {
      if (this.handleType !== TCP_SERVER)
        return -9;
      let port = this.localPort;
      if (port === 0) {
        for (let i2 = 0;i2 < 200; i2++) {
          const candidate = 40000 + Math.floor(Math.random() * 20000);
          if (!portsInUse.has(candidate)) {
            port = candidate;
            break;
          }
        }
        if (port === 0)
          return -98;
        this.localPort = port;
      }
      portsInUse.add(port);
      const listenId = listenIdCounter++;
      this.listenId = listenId;
      servers.set(listenId, this);
      hooks.onTcpListen?.({ listenId, port, host: this.localHost, backlog });
      return 0;
    }
    __listenFailed(listenId) {
      const server = servers.get(Number(listenId));
      if (!server)
        return;
      servers.delete(Number(listenId));
      portsInUse.delete(server.localPort);
      const owner = server[OWNER];
      const err2 = new Error(`listen EADDRINUSE :::${server.localPort}`);
      err2.code = "EADDRINUSE";
      err2.errno = -98;
      err2.syscall = "listen";
      owner?.emit?.("error", err2);
    }
    connect(req, address, port) {
      return this.connectInternal(req, address, port);
    }
    connect6(req, address, port) {
      return this.connectInternal(req, address, port);
    }
    connectInternal(req, address, port) {
      if (!LOCAL_HOSTS.has(address)) {
        return -38;
      }
      const connId = connIdCounter++;
      const reqId = reqIdCounter++;
      this.connId = connId;
      this.remotePort = port;
      this.localPort = 0;
      sockets.set(connId, this);
      pendingConnects.set(reqId, { req, handle: this });
      hooks.onTcpConnect?.({ connId, reqId, port, host: address });
      return 0;
    }
    __connectComplete(reqId, status) {
      const entry = pendingConnects.get(Number(reqId));
      if (!entry)
        return;
      pendingConnects.delete(Number(reqId));
      const { req, handle } = entry;
      if (status !== 0) {
        sockets.delete(handle.connId);
        handle.connId = null;
      }
      queueMicrotask(() => req?.oncomplete?.(status, handle, req, status === 0, status === 0));
    }
    __accept(connId, remotePort) {
      const client = new TCP(TCP_SOCKET);
      client.connId = connId;
      client.remotePort = remotePort;
      client.localPort = this.localPort;
      sockets.set(connId, client);
      return client;
    }
    out(data) {
      if (this.connId !== null && !this.closed)
        hooks.onTcpWrite?.(this.connId, data);
    }
    writeUtf8String(req, data, cb) {
      this.out(new TextEncoder().encode(data));
      cb?.(null);
      return 0;
    }
    writeBuffer(req, data) {
      this.out(data);
      return 0;
    }
    writeLatin1String(req, data) {
      const bytes = new Uint8Array(data.length);
      for (let i2 = 0;i2 < data.length; i2++)
        bytes[i2] = data.charCodeAt(i2) & 255;
      this.out(bytes);
      return 0;
    }
    writeAsciiString(req, data) {
      return this.writeLatin1String(req, data);
    }
    writeUcs2String(req, data) {
      this.out(new TextEncoder().encode(data));
      return 0;
    }
    writev(req, chunks, allBuffers) {
      const data = encodeWritevList(chunks, allBuffers);
      this.out(data);
      return 0;
    }
    readStart() {
      this.reading = true;
      while (this.pending.length > 0 && this.reading && typeof this.onread === "function") {
        deliverChunk(this, this.pending.shift());
      }
    }
    readStop() {
      this.reading = false;
    }
    shutdown(req) {
      if (this.connId !== null)
        hooks.onTcpShutdown?.(this.connId);
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close(cb) {
      this.closed = true;
      if (this.connId !== null) {
        if (sockets.get(this.connId) === this)
          sockets.delete(this.connId);
        hooks.onTcpClose?.(this.connId);
        this.connId = null;
      }
      if (this.listenId !== null) {
        const id = this.listenId;
        this.listenId = null;
        const server = servers.get(id);
        if (server === this) {
          servers.delete(id);
          portsInUse.delete(this.localPort);
          hooks.onTcpUnlisten?.(id, this.localPort);
        }
      }
      if (typeof cb === "function")
        queueMicrotask(() => cb());
    }
    ref() {}
    unref() {}
    setNoDelay(_v) {
      return 0;
    }
    setKeepAlive(_v, _d) {
      return 0;
    }
    setSimultaneousAccepts(_v) {
      return 0;
    }
    getsockname(out) {
      const info = {
        address: this.localHost || "127.0.0.1",
        port: this.localPort || 0,
        family: this.localHost?.includes(":") ? 10 : 2
      };
      if (out && typeof out === "object") {
        out.address = info.address;
        out.port = info.port;
        out.family = info.family;
      }
      return info;
    }
    getpeername(out) {
      const info = { address: "127.0.0.1", port: this.remotePort || 0, family: 2 };
      if (out && typeof out === "object") {
        out.address = info.address;
        out.port = info.port;
        out.family = info.family;
      }
      return info;
    }
    open(_fd) {
      return 0;
    }
  }
  function deliverChunk(handle, bytes) {
    if (typeof handle.onread !== "function" || !handle.reading) {
      handle.pending.push(bytes);
      return;
    }
    const state = getStreamBaseState();
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(ab);
    } catch (e) {
      globalThis.__ocDebugHook?.(`[tcp onread error] ${e?.stack ?? e}`);
    }
  }
  function deliverEof(handle) {
    if (typeof handle.onread !== "function")
      return;
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(new ArrayBuffer(0));
    } catch {}
  }
  const OWNER = Symbol("nodejs.stream.owner");
  return {
    TCP,
    TCPConnectWrap: class {
    },
    ConnectWrap: class {
    },
    constants: {
      SOCKET: TCP_SOCKET,
      SERVER: TCP_SERVER,
      UV_TCP_IPV6ONLY: 1,
      UV_TCP_REUSEPORT: 2
    },
    ownerSymbol: OWNER,
    deliverTcpData(connId, bytes) {
      const handle = sockets.get(Number(connId));
      globalThis.__ocDebugHook?.(`[tcp deliver] connId=${connId} handle=${handle ? "yes" : "MISSING"} reading=${handle?.reading} onread=${typeof handle?.onread}`);
      if (handle)
        deliverChunk(handle, bytes);
    },
    deliverTcpEof(connId) {
      const handle = sockets.get(Number(connId));
      if (handle)
        deliverEof(handle);
    },
    __connectComplete(reqId, status) {
      const entry = pendingConnects.get(Number(reqId));
      if (!entry)
        return;
      pendingConnects.delete(Number(reqId));
      const { req, handle } = entry;
      if (status !== 0) {
        sockets.delete(handle.connId);
        handle.connId = null;
      }
      queueMicrotask(() => req?.oncomplete?.(status, handle, req, status === 0, status === 0));
    },
    __listenFailed(listenId) {
      const server = servers.get(Number(listenId));
      if (!server)
        return;
      servers.delete(Number(listenId));
      portsInUse.delete(server.localPort);
      const owner = server[OWNER];
      const err2 = new Error(`listen EADDRINUSE :::${server.localPort}`);
      err2.code = "EADDRINUSE";
      err2.errno = -98;
      err2.syscall = "listen";
      try {
        owner?.emit?.("error", err2);
      } catch {}
    },
    acceptConnection(port, connId, remotePort) {
      for (const server of servers.values()) {
        if (server.localPort === port) {
          const client = server.__accept(connId, remotePort);
          globalThis.__ocDebugHook?.(`[tcp accept] port=${port} connId=${connId} onconnection=${typeof server.onconnection}`);
          server.onconnection?.(0, client);
          globalThis.__ocDebugHook?.(`[tcp accept done] client.reading=${client.reading} onread=${typeof client.onread}`);
          return true;
        }
      }
      return false;
    },
    setPortsInUse(ports) {
      portsInUse = new Set(ports.map(Number));
    },
    activeTcpCount() {
      return sockets.size + servers.size;
    },
    listeningPorts() {
      return [...servers.values()].map((s) => s.localPort).filter((p) => p > 0);
    },
    __connIds() {
      return [...sockets.keys()];
    }
  };
}

// src/packages/opencontainer/kernel/natives/http_parser.ts
var METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "COPY",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PROPFIND",
  "PROPPATCH",
  "SEARCH",
  "UNLOCK",
  "BIND",
  "REBIND",
  "UNBIND",
  "ACL",
  "REPORT",
  "MKACTIVITY",
  "CHECKOUT",
  "MERGE",
  "M-SEARCH",
  "NOTIFY",
  "PATCH",
  "PURGE",
  "MKCALENDAR",
  "LINK",
  "UNLINK",
  "SOURCE",
  "MKREDIRECTREF",
  "QUERY",
  "SUBSCRIBE",
  "UNSUBSCRIBE"
];
var ALL_METHODS = [...METHODS, "PRI"];
var METHOD_INDEX = new Map(METHODS.map((m, i2) => [m, i2]));
var K_ON_MESSAGE_BEGIN = 0;
var K_ON_HEADERS = 1;
var K_ON_HEADERS_COMPLETE = 2;
var K_ON_BODY = 3;
var K_ON_MESSAGE_COMPLETE = 4;
var K_ON_EXECUTE = 5;
var K_ON_TIMEOUT = 6;
var S_IDLE = 0;
var S_HEADERS = 1;
var S_BODY_LEN = 2;
var S_BODY_CHUNK_SIZE = 3;
var S_BODY_CHUNK_DATA = 4;
var S_BODY_CHUNK_CRLF = 5;
var S_TRAILERS = 6;
var MAX_HEADER_BYTES_DEFAULT = 16 * 1024;
function parseError(code, message) {
  const err2 = new Error(message);
  err2.code = "HPE_" + code;
  return err2;
}
var latin1Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("latin1") : null;
function latin1Range(buf, from, to) {
  if (to <= from)
    return "";
  if (latin1Decoder) {
    try {
      return latin1Decoder.decode(buf.subarray(from, to));
    } catch {}
  }
  let out = "";
  for (let i2 = from;i2 < to; i2++)
    out += String.fromCharCode(buf[i2]);
  return out;
}

class HTTPParser {
  static REQUEST = 1;
  static RESPONSE = 2;
  static kOnMessageBegin = K_ON_MESSAGE_BEGIN;
  static kOnHeaders = K_ON_HEADERS;
  static kOnHeadersComplete = K_ON_HEADERS_COMPLETE;
  static kOnBody = K_ON_BODY;
  static kOnMessageComplete = K_ON_MESSAGE_COMPLETE;
  static kOnExecute = K_ON_EXECUTE;
  static kOnTimeout = K_ON_TIMEOUT;
  static kLenientNone = 0;
  static kLenientHeaderValueRelaxed = 1;
  static kLenientAll = 4294967295;
  type = 0;
  state = S_IDLE;
  partial = "";
  headerBytes = 0;
  maxHeaderSize = MAX_HEADER_BYTES_DEFAULT;
  method = 0;
  url = "";
  statusCode = 0;
  statusMessage = "";
  versionMajor = 1;
  versionMinor = 1;
  upgrade = false;
  shouldKeepAlive = true;
  contentLength = -1;
  bodyRemaining = 0;
  chunkRemaining = 0;
  messageDone = false;
  finished = false;
  currentBuffer = null;
  constructor() {}
  initialize(type, _resource, maxHeaderSize, _lenientFlags, _connections) {
    this.type = type;
    this.maxHeaderSize = maxHeaderSize && maxHeaderSize > 0 ? maxHeaderSize : MAX_HEADER_BYTES_DEFAULT;
    this.reset();
  }
  reset() {
    this.state = S_IDLE;
    this.partial = "";
    this.headerBytes = 0;
    this.method = 0;
    this.url = "";
    this.statusCode = 0;
    this.statusMessage = "";
    this.versionMajor = 1;
    this.versionMinor = 1;
    this.upgrade = false;
    this.shouldKeepAlive = true;
    this.contentLength = -1;
    this.bodyRemaining = 0;
    this.chunkRemaining = 0;
    this.messageDone = false;
    this.finished = false;
  }
  getCurrentBuffer() {
    return this.currentBuffer ?? new Uint8Array(0);
  }
  consume(_handle) {}
  unconsume() {}
  remove() {}
  free() {}
  close() {}
  resume() {}
  pause() {}
  timeout(_msecs, _cb) {}
  execute(buf) {
    if (this.finished)
      return 0;
    this.currentBuffer = buf;
    let pos = 0;
    let guard = 0;
    while (pos < buf.length || this.messageDone) {
      if (this.messageDone) {
        this.messageDone = false;
        if (this.upgrade) {
          const cb = this[K_ON_EXECUTE];
          if (typeof cb === "function") {
            try {
              cb.call(this, pos);
            } catch {}
          }
          return pos;
        }
        this.emitMessageComplete();
        if (this.state !== S_IDLE)
          continue;
        continue;
      }
      const before = pos;
      const r = this.step(buf, pos);
      if (r instanceof Error)
        return r;
      pos = r;
      if (pos === before && !this.messageDone)
        break;
      if (++guard > 1e6)
        return parseError("INVALID_STATE", "parser loop guard");
    }
    return pos;
  }
  finish() {
    if (this.messageDone) {
      this.messageDone = false;
      this.emitMessageComplete();
    }
    if (this.state === S_IDLE && this.partial === "") {
      this.finished = true;
      return 0;
    }
    if (this.state === S_BODY_LEN && this.bodyRemaining === Infinity) {
      this.finished = true;
      return 0;
    }
    return parseError("INVALID_EOF_STATE", "premature close");
  }
  step(buf, pos) {
    switch (this.state) {
      case S_IDLE: {
        const line = this.takeLine(buf, pos);
        if (line === null)
          return buf.length;
        if (!this.parseFirstLine(line.line)) {
          return parseError("INVALID_VERSION", "malformed HTTP start line");
        }
        this.state = S_HEADERS;
        this.headerBytes = 0;
        this.headersAccum = [];
        return line.nextPos;
      }
      case S_HEADERS: {
        const line = this.takeLine(buf, pos);
        if (line === null)
          return buf.length;
        if (line.line === "") {
          const err2 = this.completeHeaders();
          if (err2)
            return err2;
          return line.nextPos;
        }
        this.headerBytes += line.line.length + 2;
        if (this.headerBytes > this.maxHeaderSize) {
          return parseError("HEADER_OVERFLOW", "header size exceeds maximum");
        }
        this.pushHeader(line.line);
        return line.nextPos;
      }
      case S_BODY_LEN: {
        const available = buf.length - pos;
        if (available <= 0)
          return pos;
        if (this.bodyRemaining === Infinity) {
          this.emitBody(buf.subarray(pos));
          return buf.length;
        }
        const take = Math.min(available, this.bodyRemaining);
        if (take > 0)
          this.emitBody(buf.subarray(pos, pos + take));
        this.bodyRemaining -= take;
        if (this.bodyRemaining === 0)
          this.messageDone = true;
        return pos + take;
      }
      case S_BODY_CHUNK_SIZE: {
        const line = this.takeLine(buf, pos);
        if (line === null)
          return buf.length;
        const text = line.line.trim();
        const semi = text.indexOf(";");
        const sizeStr = semi >= 0 ? text.slice(0, semi) : text;
        const size = parseInt(sizeStr, 16);
        if (!/^[0-9a-fA-F]+$/.test(sizeStr) || !Number.isFinite(size)) {
          return parseError("INVALID_CHUNK_SIZE", "invalid chunk size");
        }
        if (size === 0) {
          this.state = S_TRAILERS;
        } else {
          this.chunkRemaining = size;
          this.state = S_BODY_CHUNK_DATA;
        }
        return line.nextPos;
      }
      case S_BODY_CHUNK_DATA: {
        const available = buf.length - pos;
        if (available <= 0)
          return pos;
        const take = Math.min(available, this.chunkRemaining);
        if (take > 0)
          this.emitBody(buf.subarray(pos, pos + take));
        this.chunkRemaining -= take;
        if (this.chunkRemaining === 0)
          this.state = S_BODY_CHUNK_CRLF;
        return pos + take;
      }
      case S_BODY_CHUNK_CRLF: {
        if (buf.length - pos < 2)
          return pos;
        if (buf[pos] !== 13 || buf[pos + 1] !== 10) {
          return parseError("INVALID_CHUNK", "missing CRLF after chunk data");
        }
        this.state = S_BODY_CHUNK_SIZE;
        return pos + 2;
      }
      case S_TRAILERS: {
        const line = this.takeLine(buf, pos);
        if (line === null)
          return buf.length;
        if (line.line === "") {
          this.messageDone = true;
          return line.nextPos;
        }
        return line.nextPos;
      }
      default:
        return parseError("INVALID_STATE", "unknown parser state");
    }
  }
  takeLine(buf, pos) {
    let idx = -1;
    for (let i2 = pos;i2 < buf.length; i2++) {
      if (buf[i2] !== 13)
        continue;
      if (i2 + 1 < buf.length) {
        if (buf[i2 + 1] === 10) {
          idx = i2;
          break;
        }
        continue;
      }
      break;
    }
    if (idx >= 0) {
      const line = this.partial + latin1Range(buf, pos, idx);
      this.partial = "";
      return { line, nextPos: idx + 2 };
    }
    this.partial += latin1Range(buf, pos, buf.length);
    return null;
  }
  parseFirstLine(line) {
    if (this.type === HTTPParser.REQUEST) {
      const sp1 = line.indexOf(" ");
      if (sp1 < 0)
        return false;
      const sp2 = line.indexOf(" ", sp1 + 1);
      if (sp2 < 0)
        return false;
      const method = line.slice(0, sp1);
      this.url = line.slice(sp1 + 1, sp2);
      const version = line.slice(sp2 + 1);
      const m = /^HTTP\/(\d)\.(\d)$/.exec(version);
      if (!m)
        return false;
      const idx = METHOD_INDEX.get(method);
      if (idx === undefined)
        return false;
      this.method = idx;
      this.versionMajor = Number(m[1]);
      this.versionMinor = Number(m[2]);
    } else {
      const m = /^HTTP\/(\d)\.(\d)\s+(\d{3})(?:\s(.*))?$/.exec(line);
      if (!m)
        return false;
      this.versionMajor = Number(m[1]);
      this.versionMinor = Number(m[2]);
      this.statusCode = Number(m[3]);
      this.statusMessage = m[4] ?? "";
    }
    return true;
  }
  pushHeader(line) {
    const colon = line.indexOf(":");
    if (colon < 0)
      return;
    this.headersAccum.push(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  headersAccum = [];
  headerValue(name) {
    const lower = name.toLowerCase();
    for (let i2 = 0;i2 + 1 < this.headersAccum.length; i2 += 2) {
      if (this.headersAccum[i2].toLowerCase() === lower)
        return this.headersAccum[i2 + 1];
    }
    return;
  }
  completeHeaders() {
    if (this.type === HTTPParser.REQUEST && this.upgradeRequested()) {
      this.upgrade = true;
    }
    const te2 = (this.headerValue("transfer-encoding") ?? "").toLowerCase();
    const isChunked = te2.includes("chunked");
    const clRaw = this.headerValue("content-length");
    const skip = this.dispatchHeadersComplete();
    if (skip !== 0) {
      this.messageDone = true;
      return null;
    }
    if (this.type === HTTPParser.REQUEST && this.upgrade) {
      this.messageDone = true;
      return null;
    }
    if (this.type === HTTPParser.RESPONSE) {
      const noBody = this.statusCode >= 100 && this.statusCode < 200 || this.statusCode === 204 || this.statusCode === 304;
      if (noBody) {
        this.messageDone = true;
        return null;
      }
    }
    if (isChunked) {
      this.state = S_BODY_CHUNK_SIZE;
    } else if (clRaw !== undefined) {
      const cl = parseInt(clRaw.trim(), 10);
      if (!Number.isFinite(cl) || cl < 0) {
        return parseError("INVALID_CONTENT_LENGTH", "invalid content-length");
      }
      this.contentLength = cl;
      this.bodyRemaining = cl;
      if (cl === 0)
        this.messageDone = true;
      else
        this.state = S_BODY_LEN;
    } else if (this.type === HTTPParser.RESPONSE) {
      this.bodyRemaining = Infinity;
      this.state = S_BODY_LEN;
    } else {
      this.messageDone = true;
    }
    return null;
  }
  upgradeRequested() {
    const conn = (this.headerValue("connection") ?? "").toLowerCase();
    return conn.includes("upgrade") && !!this.headerValue("upgrade");
  }
  dispatchHeadersComplete() {
    const cb = this[K_ON_HEADERS_COMPLETE];
    const conn = (this.headerValue("connection") ?? "").toLowerCase();
    this.shouldKeepAlive = this.versionMajor === 1 && this.versionMinor === 1 ? !conn.includes("close") : conn.includes("keep-alive");
    if (typeof cb !== "function") {
      this.headersAccum = [];
      return 0;
    }
    const headers = this.headersAccum;
    this.headersAccum = [];
    const result = cb.call(this, this.versionMajor, this.versionMinor, headers, this.type === HTTPParser.REQUEST ? this.method : undefined, this.type === HTTPParser.REQUEST ? this.url : undefined, this.type === HTTPParser.RESPONSE ? this.statusCode : undefined, this.type === HTTPParser.RESPONSE ? this.statusMessage : undefined, this.upgrade, this.shouldKeepAlive);
    return typeof result === "number" ? result : 0;
  }
  emitMessageComplete() {
    this.state = S_IDLE;
    this.partial = "";
    const cb = this[K_ON_MESSAGE_COMPLETE];
    if (typeof cb === "function") {
      try {
        cb.call(this);
      } catch {}
    }
  }
  emitBody(bytes) {
    const cb = this[K_ON_BODY];
    if (typeof cb !== "function")
      return;
    const B = globalThis.Buffer;
    const chunk = B && typeof B.from === "function" ? B.from(bytes) : bytes;
    try {
      cb.call(this, chunk);
    } catch {}
  }
}

class ConnectionsList {
  connections = new Set;
  addConnection(connection) {
    this.connections.add(connection);
  }
  removeConnection(connection) {
    this.connections.delete(connection);
  }
  idle() {
    return [...this.connections].filter((c) => c.writable && !c.writableEnded);
  }
  all() {
    return [...this.connections];
  }
  expired(_headersTimeout, _requestTimeout) {
    return [];
  }
}
function makeHttpParserBinding(_ctx) {
  return {
    HTTPParser,
    ConnectionsList,
    methods: METHODS,
    allMethods: ALL_METHODS,
    modes: { lenient: 1, strict: 0 },
    version: "9.1.0",
    isHeaderFieldValueValid(value) {
      return !/[^\t\x20-\x7e\x80-\xff]/.test(value);
    }
  };
}

// src/packages/opencontainer/kernel/natives/http2.ts
var HEADER_LITERALS = {
  HTTP2_HEADER_AUTHORITY: ":authority",
  HTTP2_HEADER_METHOD: ":method",
  HTTP2_HEADER_PATH: ":path",
  HTTP2_HEADER_SCHEME: ":scheme",
  HTTP2_HEADER_STATUS: ":status"
};
function headerNameOf(name) {
  if (HEADER_LITERALS[name] !== undefined)
    return HEADER_LITERALS[name];
  return name.slice("HTTP2_HEADER_".length).toLowerCase().replace(/_/g, "-");
}
var NUMERIC = {
  HTTP_STATUS_SWITCHING_PROTOCOLS: 101,
  HTTP_STATUS_PROCESSING: 102,
  HTTP_STATUS_EARLY_HINTS: 103,
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_CREATED: 201,
  HTTP_STATUS_ACCEPTED: 202,
  HTTP_STATUS_NO_CONTENT: 204,
  HTTP_STATUS_RESET_CONTENT: 205,
  HTTP_STATUS_PARTIAL_CONTENT: 206,
  HTTP_STATUS_MULTIPLE_CHOICES: 300,
  HTTP_STATUS_MOVED_PERMANENTLY: 301,
  HTTP_STATUS_FOUND: 302,
  HTTP_STATUS_SEE_OTHER: 303,
  HTTP_STATUS_NOT_MODIFIED: 304,
  HTTP_STATUS_USE_PROXY: 305,
  HTTP_STATUS_TEMPORARY_REDIRECT: 307,
  HTTP_STATUS_PERMANENT_REDIRECT: 308,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_PAYMENT_REQUIRED: 402,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
  HTTP_STATUS_NOT_ACCEPTABLE: 406,
  HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED: 407,
  HTTP_STATUS_REQUEST_TIMEOUT: 408,
  HTTP_STATUS_CONFLICT: 409,
  HTTP_STATUS_GONE: 410,
  HTTP_STATUS_LENGTH_REQUIRED: 411,
  HTTP_STATUS_PRECONDITION_FAILED: 412,
  HTTP_STATUS_PAYLOAD_TOO_LARGE: 413,
  HTTP_STATUS_URI_TOO_LONG: 414,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE: 415,
  HTTP_STATUS_RANGE_NOT_SATISFIABLE: 416,
  HTTP_STATUS_EXPECTATION_FAILED: 417,
  HTTP_STATUS_MISDIRECTED_REQUEST: 421,
  HTTP_STATUS_UNPROCESSABLE_ENTITY: 422,
  HTTP_STATUS_TOO_MANY_REQUESTS: 429,
  HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_IMPLEMENTED: 501,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED: 505,
  HTTP_STATUS_INSUFFICIENT_STORAGE: 507,
  HTTP_STATUS_LOOP_DETECTED: 508,
  HTTP2_METHOD_CONNECT: "CONNECT",
  HTTP2_METHOD_DELETE: "DELETE",
  HTTP2_METHOD_GET: "GET",
  HTTP2_METHOD_HEAD: "HEAD",
  NGHTTP2_NO_ERROR: 0,
  NGHTTP2_INTERNAL_ERROR: 2,
  NGHTTP2_CANCEL: 8,
  NGHTTP2_REFUSED_STREAM: 7,
  NGHTTP2_DEFAULT_WEIGHT: 16,
  NGHTTP2_FLAG_END_STREAM: 1,
  NGHTTP2_FLAG_NONE: 0,
  NGHTTP2_NV_FLAG_NONE: 0,
  NGHTTP2_NV_FLAG_NO_INDEX: 1,
  NGHTTP2_HCAT_HEADERS: 0,
  NGHTTP2_HCAT_PUSH_RESPONSE: 1,
  NGHTTP2_HCAT_RESPONSE: 2,
  NGHTTP2_HCAT_REQUEST: 3,
  NGHTTP2_SESSION_CLIENT: 0,
  NGHTTP2_SESSION_SERVER: 1,
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE: 1,
  NGHTTP2_SETTINGS_ENABLE_PUSH: 2,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS: 3,
  NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE: 4,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE: 5,
  NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE: 6,
  NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL: 8,
  NGHTTP2_ERR_INVALID_ARGUMENT: -501,
  NGHTTP2_ERR_NOMEM: -901,
  NGHTTP2_ERR_STREAM_CLOSED: -515,
  NGHTTP2_ERR_STREAM_ID_NOT_AVAILABLE: -509,
  HTTP2_ERROR: 1,
  HTTP2_SESSION_ERROR: 2,
  HTTP2_STREAM_ERROR: 3,
  HTTP2_HEADERS_SENT: 4,
  HTTP2_HEADERS_AFTER_RESPOND: 5,
  HTTP2_INFO_STATUS_NOT_ALLOWED: 6,
  HTTP2_INVALID_HEADER_VALUE: 7,
  HTTP2_INVALID_INFO_STATUS: 8,
  HTTP2_INVALID_PACKED_SETTINGS_LENGTH: 9,
  HTTP2_INVALID_PSEUDOHEADER: 10,
  HTTP2_INVALID_SESSION: 11,
  HTTP2_INVALID_SETTING_VALUE: 12,
  HTTP2_INVALID_STREAM: 13,
  HTTP2_MAX_PENDING_SETTINGS_ACK: 14,
  HTTP2_NESTED_PUSH: 15,
  HTTP2_NO_MEM: 16,
  HTTP2_NO_SOCKET_MANIPULATION: 17,
  HTTP2_ORIGIN_LENGTH: 18,
  HTTP2_OUT_OF_STREAMS: 19,
  HTTP2_PAYLOAD_FORBIDDEN: 20,
  HTTP2_PING_CANCEL: 21,
  HTTP2_PING_LENGTH: 22,
  HTTP2_PUSH_DISABLED: 23,
  HTTP2_SEND_FILE: 24,
  HTTP2_SEND_FILE_NOSEEK: 25,
  HTTP2_SETTINGS_CANCEL: 26,
  HTTP2_SOCKET_BOUND: 27,
  HTTP2_SOCKET_UNBOUND: 28,
  HTTP2_STATUS_101: 29,
  HTTP2_STATUS_INVALID: 30,
  HTTP2_STREAM_CANCEL: 31,
  HTTP2_STREAM_SELF_DEPENDENCY: 32,
  HTTP2_TOO_MANY_CUSTOM_SETTINGS: 33,
  HTTP2_TOO_MANY_ORIGINS: 34,
  HTTP2_TRAILERS_ALREADY_SENT: 35,
  HTTP2_TRAILERS_NOT_READY: 36,
  HTTP2_UNSUPPORTED_PROTOCOL: 37,
  HTTP2_INVALID_CONNECTION_HEADERS: 38,
  HTTP2_CONNECT_AUTHORITY: 39,
  HTTP2_CONNECT_PATH: 40,
  HTTP2_CONNECT_SCHEME: 41,
  HTTP2_ALTSVC_INVALID_ORIGIN: 42,
  HTTP2_ALTSVC_LENGTH: 43,
  HTTP2_GOAWAY_SESSION: 44,
  PADDING_STRATEGY_NONE: 0,
  PADDING_STRATEGY_MAX: 1,
  PADDING_STRATEGY_ALIGNED: 2,
  HTTP2_PADDING_BUF_SIZE: 256
};
var HEADER_CONST_NAMES = [
  "HTTP2_HEADER_ACCEPT",
  "HTTP2_HEADER_ACCEPT_CHARSET",
  "HTTP2_HEADER_ACCEPT_ENCODING",
  "HTTP2_HEADER_ACCEPT_LANGUAGE",
  "HTTP2_HEADER_ACCEPT_RANGES",
  "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS",
  "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS",
  "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS",
  "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN",
  "HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS",
  "HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE",
  "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS",
  "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD",
  "HTTP2_HEADER_AGE",
  "HTTP2_HEADER_ALLOW",
  "HTTP2_HEADER_AUTHORITY",
  "HTTP2_HEADER_AUTHORIZATION",
  "HTTP2_HEADER_CACHE_CONTROL",
  "HTTP2_HEADER_CONNECTION",
  "HTTP2_HEADER_CONTENT_DISPOSITION",
  "HTTP2_HEADER_CONTENT_ENCODING",
  "HTTP2_HEADER_CONTENT_LANGUAGE",
  "HTTP2_HEADER_CONTENT_LENGTH",
  "HTTP2_HEADER_CONTENT_LOCATION",
  "HTTP2_HEADER_CONTENT_MD5",
  "HTTP2_HEADER_CONTENT_RANGE",
  "HTTP2_HEADER_CONTENT_TYPE",
  "HTTP2_HEADER_COOKIE",
  "HTTP2_HEADER_DATE",
  "HTTP2_HEADER_DNT",
  "HTTP2_HEADER_EARLY_DATA",
  "HTTP2_HEADER_ETAG",
  "HTTP2_HEADER_EXPECT",
  "HTTP2_HEADER_EXPIRES",
  "HTTP2_HEADER_FROM",
  "HTTP2_HEADER_HOST",
  "HTTP2_HEADER_HTTP2_SETTINGS",
  "HTTP2_HEADER_IF_MATCH",
  "HTTP2_HEADER_IF_MODIFIED_SINCE",
  "HTTP2_HEADER_IF_NONE_MATCH",
  "HTTP2_HEADER_IF_RANGE",
  "HTTP2_HEADER_IF_UNMODIFIED_SINCE",
  "HTTP2_HEADER_KEEP_ALIVE",
  "HTTP2_HEADER_LAST_MODIFIED",
  "HTTP2_HEADER_LINK",
  "HTTP2_HEADER_LOCATION",
  "HTTP2_HEADER_MAX_FORWARDS",
  "HTTP2_HEADER_METHOD",
  "HTTP2_HEADER_PATH",
  "HTTP2_HEADER_PROTOCOL",
  "HTTP2_HEADER_PROXY_AUTHENTICATE",
  "HTTP2_HEADER_PROXY_AUTHORIZATION",
  "HTTP2_HEADER_PROXY_CONNECTION",
  "HTTP2_HEADER_RANGE",
  "HTTP2_HEADER_REFERER",
  "HTTP2_HEADER_RETRY_AFTER",
  "HTTP2_HEADER_SCHEME",
  "HTTP2_HEADER_SERVER",
  "HTTP2_HEADER_SET_COOKIE",
  "HTTP2_HEADER_STATUS",
  "HTTP2_HEADER_STRICT_TRANSPORT_SECURITY",
  "HTTP2_HEADER_TE",
  "HTTP2_HEADER_TIMING_ALLOW_ORIGIN",
  "HTTP2_HEADER_TK",
  "HTTP2_HEADER_TRAILER",
  "HTTP2_HEADER_TRANSFER_ENCODING",
  "HTTP2_HEADER_UPGRADE",
  "HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS",
  "HTTP2_HEADER_USER_AGENT",
  "HTTP2_HEADER_VARY",
  "HTTP2_HEADER_VIA",
  "HTTP2_HEADER_WARNING",
  "HTTP2_HEADER_WWW_AUTHENTICATE",
  "HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS",
  "HTTP2_HEADER_X_FRAME_OPTIONS",
  "HTTP2_HEADER_X_XSS_PROTECTION",
  "HTTP2_HEADER_SINGLE_VALUE"
];
var NGHTTP2_ERROR_STRINGS = {
  0: "No error",
  [-1]: "Protocol error",
  [-2]: "Internal error",
  [-501]: "Invalid argument",
  [-509]: "Stream ID is not available",
  [-515]: "Stream closed",
  [-901]: "Out of memory"
};
var constants = { __proto__: null };
for (const name of HEADER_CONST_NAMES) {
  if (name === "HTTP2_HEADER_SINGLE_VALUE")
    continue;
  constants[name] = headerNameOf(name);
}
constants.HTTP2_HEADER_SINGLE_VALUE = new Set([
  ":authority",
  "content-length",
  "content-type",
  "cookie",
  "date",
  "dnt",
  "expect",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "max-forwards",
  "referer",
  "user-agent"
]);
for (const [k, v] of Object.entries(NUMERIC)) {
  if (typeof v === "string")
    continue;
  constants[k] = v;
}
constants.HTTP2_METHOD_CONNECT = "CONNECT";
constants.HTTP2_METHOD_DELETE = "DELETE";
constants.HTTP2_METHOD_GET = "GET";
constants.HTTP2_METHOD_HEAD = "HEAD";
var sessionCallbacks = [];
function makeHttp2Binding() {
  return {
    constants,
    nameForErrorCode(code) {
      return NGHTTP2_ERROR_STRINGS[code];
    },
    nghttp2ErrorString(code) {
      return NGHTTP2_ERROR_STRINGS[code] ?? "Unknown error code";
    },
    setCallbackFunctions(...fns) {
      sessionCallbacks = fns;
    },
    refreshDefaultSettings() {
      return { __proto__: null };
    },
    packSettings() {
      return new Uint8Array(0);
    },
    unpackSettings(buf) {
      return { __proto__: null };
    },
    Http2Session: class Http2Session {
      constructor(_type) {
        const err2 = new Error("HTTP/2 sessions are not implemented in the browser runtime");
        err2.code = "ERR_HTTP2_SUPPORT";
        throw err2;
      }
    },
    Http2Stream: class Http2Stream {
      constructor() {
        const err2 = new Error("HTTP/2 sessions are not implemented in the browser runtime");
        err2.code = "ERR_HTTP2_SUPPORT";
        throw err2;
      }
    }
  };
}

// src/packages/opencontainer/kernel/natives/stream_pipe.ts
function makeStreamPipeBinding() {
  return {
    StreamPipe: class StreamPipe {
      constructor() {
        const err2 = new Error("stream_pipe: StreamPipe is not implemented in the browser runtime " + "(only reachable from HTTP/2 session piping, which requires sockets)");
        err2.code = "ERR_NOT_IMPLEMENTED";
        throw err2;
      }
    }
  };
}

// src/packages/opencontainer/kernel/natives/index.ts
class Natives {
  ctx;
  bindings = new Map;
  constructor(ctx) {
    this.ctx = ctx;
    const reg = (name, make) => {
      this.bindings.set(name, make());
    };
    reg("errors", () => makeErrorsBinding(ctx));
    reg("config", () => makeConfigBinding());
    reg("constants", () => makeConstantsBinding());
    reg("symbols", () => makeSymbolsBinding());
    reg("task_queue", () => makeTaskQueueBinding(ctx));
    reg("process_methods", () => makeProcessMethodsBinding(ctx));
    reg("uv", () => makeUvBinding());
    reg("fs", () => makeFsBinding(ctx));
    reg("fs_dir", () => makeFsDirBinding(ctx));
    reg("fs_event_wrap", () => makeFsEventBinding(ctx));
    reg("buffer", () => makeBufferBinding());
    reg("util", () => makeUtilBinding());
    reg("options", () => makeOptionsBinding(ctx));
    reg("builtins", () => makeBuiltinsBinding());
    reg("modules", () => makeModulesBinding(ctx));
    reg("url", () => makeUrlBinding());
    reg("url_pattern", () => makeUrlPatternBinding());
    reg("performance", () => makePerformanceBinding(ctx));
    reg("worker", () => makeWorkerBinding());
    reg("credentials", () => makeCredentialsBinding(ctx));
    reg("os", () => makeOsBinding());
    reg("crypto", () => makeCryptoBinding());
    reg("zlib", () => makeZlibBinding());
    reg("contextify", () => makeContextifyBinding());
    reg("module_wrap", () => makeModuleWrapBinding());
    reg("v8", () => makeV8Binding(ctx));
    reg("timers", () => makeTimersBinding());
    reg("tty_wrap", () => makeTtyBinding(ctx));
    reg("stream_wrap", () => makeStreamWrapBinding());
    reg("process_wrap", () => makeProcessWrapBinding(ctx));
    reg("pipe_wrap", () => makePipeWrapBinding(ctx));
    reg("tcp_wrap", () => makeTcpWrapBinding(ctx));
    reg("http_parser", () => makeHttpParserBinding(ctx));
    reg("http2", () => makeHttp2Binding());
    reg("stream_pipe", () => makeStreamPipeBinding());
    reg("encoding_binding", () => makeEncodingBinding());
    reg("string_decoder", () => makeStringDecoderBinding());
    reg("types", () => makeTypesBinding());
    reg("cjs_lexer", () => makeCjsLexerBinding());
    for (const [name, binding] of Object.entries(makeMiscBindings())) {
      if (binding !== undefined)
        this.bindings.set(name, binding);
    }
  }
  get(name) {
    const b = this.bindings.get(name);
    if (!b) {
      const missing = {};
      return new Proxy({}, {
        get(_t, prop) {
          if (prop === Symbol.toPrimitive)
            return () => `[missing binding: ${name}]`;
          missing[String(prop)] = true;
          throw new Error(`OpenContainer: internalBinding('${name}') is not implemented yet ` + `(accessed .${String(prop)}). Bindings seen so far: ${[...Object.keys(missing)].join(", ")}`);
        }
      });
    }
    return b;
  }
}

// src/packages/opencontainer/kernel/module-registry.ts
var REALM_ID = "internal/bootstrap/realm";

class ModuleRegistry {
  store;
  rt;
  realmExports = null;
  _realmLoaded = false;
  constructor(store, rt) {
    this.store = store;
    this.rt = rt;
    const g = globalThis;
    if (typeof g.__ocWireBuiltinCompile === "function") {
      g.__ocWireBuiltinCompile(resolveModuleFile, (file) => this.store.get(file));
    }
  }
  require = (id) => {
    if (id === REALM_ID && !this._realmLoaded) {
      this.loadRealm();
    }
    if (this._realmLoaded) {
      const realmRequire = globalThis.__ocRealmRequire;
      if (typeof realmRequire === "function") {
        return realmRequire(id);
      }
    }
    throw new Error(`OpenContainer: cannot require '${id}' before the realm bootstrap is loaded`);
  };
  has(id) {
    return resolveModuleFile(id) !== null;
  }
  get(id) {
    return this.require(id);
  }
  loadRealm() {
    const file = resolveModuleFile(REALM_ID);
    const source = this.store.get(file);
    const fn = new Function("exports", "require", "module", "process", `'use strict';
${source}
//# sourceURL=opencontainer://${REALM_ID}`);
    const mod = { id: REALM_ID, exports: {}, loaded: false };
    fn(mod.exports, this.require, mod, this.rt.process);
    mod.loaded = true;
    const realmRequire = globalThis.__ocRealmRequire;
    if (realmRequire) {
      const loaderExports = realmRequire(REALM_ID);
      if (typeof loaderExports.internalBinding === "function") {
        this.rt.internalBinding = loaderExports.internalBinding;
      }
    }
    this._realmLoaded = true;
  }
}
function loadPrimordials(store) {
  const file = resolveModuleFile("internal/per_context/primordials");
  const source = store.get(file);
  const primordials = Object.create(null);
  const fn = new Function("primordials", `'use strict';
${source}
//# sourceURL=opencontainer://internal/per_context/primordials.js`);
  fn(primordials);
  return primordials;
}

// src/packages/opencontainer/kernel/esm-graph.ts
function moduleNotFound(spec, parent) {
  const err2 = new Error(`Cannot find module '${spec}' imported from ${parent}`);
  err2.code = "ERR_MODULE_NOT_FOUND";
  return err2;
}
function packagePathNotExported(spec, parent) {
  const err2 = new Error(`Package subpath '${spec}' is not defined by "exports" in its package.json, imported from ${parent}`);
  err2.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
  return err2;
}
function invalidModuleSpecifier(spec, reason) {
  const err2 = new Error(`Invalid module specifier '${spec}' ${reason}`);
  err2.code = "ERR_INVALID_MODULE_SPECIFIER";
  return err2;
}
function dirnameOf(p) {
  const i2 = p.lastIndexOf("/");
  if (i2 <= 0)
    return "/";
  return p.slice(0, i2);
}
function normalizeJoin(base, rel) {
  const out = [];
  for (const seg of `${base}/${rel}`.split("/")) {
    if (seg === "" || seg === ".")
      continue;
    if (seg === "..")
      out.pop();
    else
      out.push(seg);
  }
  return `/${out.join("/")}`;
}
function encodePath(p) {
  return p.split("/").map((s) => encodeURIComponent(s)).join("/");
}
function fileUrlOf(p) {
  return `file://${encodePath(p)}`;
}
var RESERVED = new Set([
  "default",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public"
]);
function isSafeIdent(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED.has(k);
}
var packageBaseCache = new Map;
function packageBaseOf(readPjson, modulePath) {
  const hit = packageBaseCache.get(modulePath);
  if (hit !== undefined)
    return hit;
  let dir = dirnameOf(modulePath);
  let base = "";
  for (;; ) {
    const pj = readPjson(dir);
    if (pj && typeof pj === "object") {
      base = dir;
      break;
    }
    if (dir === "/")
      break;
    dir = dirnameOf(dir);
  }
  packageBaseCache.set(modulePath, base);
  return base;
}

class Resolver {
  deps;
  pjsonCache = new Map;
  constructor(deps) {
    this.deps = deps;
  }
  read(p) {
    try {
      const bytes = this.deps.vfs.readFile(p);
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }
  existsFile(p) {
    try {
      return (this.deps.vfs.stat(p).mode & 61440) !== 16384;
    } catch {
      return false;
    }
  }
  isDir(p) {
    try {
      return this.deps.vfs.isDirectory(p);
    } catch {
      return false;
    }
  }
  readPjson(p) {
    return this.pjsonAt(p);
  }
  resolveImports(imports, base, spec, parentPath) {
    const conditions = ["node", "import", "module-sync", "default"];
    const expandTarget = (target, captured) => {
      if (typeof target === "string") {
        return captured !== null ? target.replace(/\*/g, captured) : target;
      }
      if (target && typeof target === "object" && !Array.isArray(target)) {
        for (const cond of conditions) {
          if (cond in target) {
            const t = expandTarget(target[cond], captured);
            if (t !== null)
              return t;
          }
        }
      }
      return null;
    };
    const toResolution = (target) => {
      const p = target.startsWith("/") ? target : normalizeJoin(base, target);
      if (this.existsFile(p))
        return { kind: this.formatOf(p), path: p };
      const probed = this.loadAsFileOrDirectory(p);
      if (probed)
        return probed;
      throw moduleNotFound(spec, parentPath);
    };
    if (spec in imports) {
      const t = expandTarget(imports[spec], null);
      if (t === null) {
        throw invalidModuleSpecifier(spec, '(matched "imports" target has no compatible condition)');
      }
      return toResolution(t);
    }
    let best = null;
    for (const key of Object.keys(imports)) {
      const starIdx = key.indexOf("*");
      if (starIdx < 0)
        continue;
      const keyBase = key.slice(0, starIdx);
      const keyTail = key.slice(starIdx + 1);
      if (!spec.startsWith(keyBase) || !spec.endsWith(keyTail))
        continue;
      if (best === null || keyBase.length > best.key.slice(0, best.starIdx).length) {
        best = { key, starIdx };
      }
    }
    if (best) {
      const keyBase = best.key.slice(0, best.starIdx);
      const keyTail = best.key.slice(best.starIdx + 1);
      const captured = spec.slice(keyBase.length, spec.length - keyTail.length);
      const t = expandTarget(imports[best.key], captured);
      if (t === null) {
        throw invalidModuleSpecifier(spec, '(matched "imports" target has no compatible condition)');
      }
      return toResolution(t);
    }
    throw invalidModuleSpecifier(spec, `("imports" does not define '${spec}')`);
  }
  pjsonAt(p) {
    if (this.pjsonCache.has(p))
      return this.pjsonCache.get(p);
    const text = this.read(`${p}/package.json`);
    let parsed = null;
    if (text !== null) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    this.pjsonCache.set(p, parsed);
    return parsed;
  }
  formatOf(p) {
    if (p.endsWith(".mjs") || p.endsWith(".mts"))
      return "esm";
    if (p.endsWith(".cjs") || p.endsWith(".cts"))
      return "cjs";
    if (p.endsWith(".json"))
      return "json";
    let dir = dirnameOf(p);
    for (;; ) {
      const pj = this.pjsonAt(dir);
      if (pj && typeof pj === "object")
        return pj.type === "module" ? "esm" : "cjs";
      if (dir === "/")
        return "cjs";
      dir = dirnameOf(dir);
    }
  }
  isBuiltin(spec) {
    if (spec.startsWith("node:"))
      return true;
    return this.deps.builtinModules.includes(spec);
  }
  resolveFromDir(spec, parentDir) {
    return this.resolve(spec, `${parentDir}/<module>`);
  }
  resolve(spec, parentPath) {
    if (spec.startsWith("node:")) {
      const id = spec.slice(5);
      if (!this.deps.builtinModules.includes(id))
        throw moduleNotFound(spec, parentPath);
      return { kind: "builtin", id };
    }
    if (this.deps.builtinModules.includes(spec))
      return { kind: "builtin", id: spec };
    if (spec.startsWith("data:") || spec.startsWith("file:")) {
      throw invalidModuleSpecifier(spec, "(data:/file: URL specifiers are not supported in OpenContainer)");
    }
    if (spec.startsWith("#")) {
      const base = packageBaseOf((p) => this.pjsonAt(p), parentPath);
      if (base === "") {
        throw invalidModuleSpecifier(spec, '(no ancestor package.json defines "imports")');
      }
      const pj = this.pjsonAt(base);
      const imports = pj && typeof pj === "object" ? pj.imports : undefined;
      if (!imports || typeof imports !== "object") {
        throw invalidModuleSpecifier(spec, `("imports" not defined in ${base}/package.json)`);
      }
      return this.resolveImports(imports, base, spec, parentPath);
    }
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
      const base = spec.startsWith("/") ? normalizeJoin("", spec) : normalizeJoin(dirnameOf(parentPath), spec);
      const found = this.loadAsFileOrDirectory(base);
      if (!found)
        throw moduleNotFound(spec, parentPath);
      return found;
    }
    const resolved = this.resolvePackage(spec, dirnameOf(parentPath));
    if (!resolved)
      throw moduleNotFound(spec, parentPath);
    return resolved;
  }
  loadAsFileOrDirectory(base) {
    if (this.existsFile(base))
      return { kind: this.formatOf(base), path: base };
    for (const ext of [".mjs", ".cjs", ".js"]) {
      const p = `${base}${ext}`;
      if (this.existsFile(p))
        return { kind: this.formatOf(p), path: p };
    }
    if (this.isDir(base)) {
      const pj = this.pjsonAt(base);
      if (pj && typeof pj.main === "string") {
        const viaMain = this.loadAsFileOrDirectory(normalizeJoin(base, pj.main));
        if (viaMain)
          return viaMain;
      }
      for (const idx of ["index.mjs", "index.js", "index.cjs"]) {
        const p = `${base}/${idx}`;
        if (this.existsFile(p))
          return { kind: this.formatOf(p), path: p };
      }
    }
    return null;
  }
  resolvePackage(spec, fromDir) {
    let pkgName = spec;
    let subpath = "";
    if (spec.startsWith("@")) {
      const i2 = spec.indexOf("/");
      const j = i2 >= 0 ? spec.indexOf("/", i2 + 1) : -1;
      if (j >= 0) {
        pkgName = spec.slice(0, j);
        subpath = spec.slice(j + 1);
      }
    } else {
      const i2 = spec.indexOf("/");
      if (i2 >= 0) {
        pkgName = spec.slice(0, i2);
        subpath = spec.slice(i2 + 1);
      }
    }
    let dir = fromDir;
    for (;; ) {
      const nmRoot = dir === "/" ? "/node_modules" : `${dir}/node_modules`;
      const pkgDir = `${nmRoot}/${pkgName}`;
      if (this.isDir(pkgDir)) {
        const pj = this.pjsonAt(pkgDir);
        if (pj && typeof pj === "object" && pj.exports !== undefined) {
          return this.resolveExports(pj.exports, pkgDir, spec, subpath, fromDir);
        }
        const target = subpath ? this.loadAsFileOrDirectory(`${pkgDir}/${subpath}`) : this.loadAsFileOrDirectory(pj && typeof pj.main === "string" ? normalizeJoin(pkgDir, pj.main) : `${pkgDir}/index.js`) ?? this.loadAsFileOrDirectory(`${pkgDir}/index.js`);
        if (target)
          return target;
        throw moduleNotFound(spec, fromDir);
      }
      if (dir === "/")
        break;
      dir = dirnameOf(dir);
    }
    return null;
  }
  resolveExports(exports, pkgDir, spec, subpath, fromDir) {
    const conditions = ["node", "import", "default"];
    const expandTarget = (target, captured) => {
      if (typeof target === "string") {
        if (!target.startsWith("./"))
          return null;
        return captured !== null ? target.replace(/\*/g, captured) : target;
      }
      if (target && typeof target === "object" && !Array.isArray(target)) {
        for (const cond of conditions) {
          if (cond in target) {
            const t = expandTarget(target[cond], captured);
            if (t !== null)
              return t;
          }
        }
      }
      return null;
    };
    const toResolution = (target) => {
      const p = normalizeJoin(pkgDir, target);
      if (this.existsFile(p))
        return { kind: this.formatOf(p), path: p };
      const probed = this.loadAsFileOrDirectory(p);
      if (probed)
        return probed;
      throw moduleNotFound(spec, fromDir);
    };
    const matchKey = subpath ? `./${subpath}` : ".";
    const isDotShorthand = typeof exports === "string" || exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).length > 0 && Object.keys(exports).every((k) => !k.startsWith("."));
    if (isDotShorthand) {
      const t = expandTarget(exports, null);
      if (t === null)
        throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    if (typeof exports !== "object" || exports === null || Array.isArray(exports)) {
      throw packagePathNotExported(spec, fromDir);
    }
    if (matchKey in exports) {
      const t = expandTarget(exports[matchKey], null);
      if (t === null)
        throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    let best = null;
    for (const key of Object.keys(exports)) {
      const starIdx = key.indexOf("*");
      if (starIdx < 0 || !key.startsWith("./"))
        continue;
      const base = key.slice(0, starIdx);
      const tail = key.slice(starIdx + 1);
      if (!matchKey.startsWith(base) || !matchKey.endsWith(tail))
        continue;
      if (best === null || base.length > key.slice(0, best.starIdx).length) {
        best = { key, starIdx };
      }
    }
    if (best) {
      const base = best.key.slice(0, best.starIdx);
      const tail = best.key.slice(best.starIdx + 1);
      const captured = matchKey.slice(base.length, matchKey.length - tail.length);
      const t = expandTarget(exports[best.key], captured);
      if (t === null)
        throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    throw packagePathNotExported(spec, fromDir);
  }
}
function makeEsmGraphImporter(deps) {
  const resolver = new Resolver(deps);
  const { acorn, serving, vfs } = deps;
  const builtinShimPath = (id) => `/__oc_builtin/${id}.mjs`;
  const cjsShimPath = (p) => `/__oc_cjs${p}.mjs`;
  const jsonShimPath = (p) => `/__oc_json${p}.mjs`;
  const processNonce = Math.random().toString(36).slice(2, 12);
  const prefix = serving.prefix(processNonce);
  const published = new Set;
  const urlOf = (p) => `${prefix}${encodePath(p)}`;
  const readUtf8 = (p) => {
    try {
      return new TextDecoder().decode(vfs.readFile(p));
    } catch {
      throw moduleNotFound(p, "(entry)");
    }
  };
  function parseModule(source, path) {
    try {
      return acorn.Parser.parse(source, {
        __proto__: null,
        ecmaVersion: "latest",
        sourceType: "module",
        allowAwaitOutsideFunction: true
      });
    } catch (e) {
      const loc = e?.loc ? `:${e.loc.line}:${e.loc.column}` : "";
      const err2 = new Error(`${path}${loc}: ${e?.message ?? String(e)}`);
      err2.code = "ERR_MODULE_SYNTAX";
      throw err2;
    }
  }
  function collectStaticSpecifiers(ast) {
    const out = [];
    for (const node of ast.body) {
      const srcNode = node.type === "ImportDeclaration" ? node.source : node.type === "ExportNamedDeclaration" ? node.source : node.type === "ExportAllDeclaration" ? node.source : null;
      if (srcNode && typeof srcNode.value === "string") {
        out.push({ value: srcNode.value, node: srcNode, isStaticDecl: true, declNode: node });
      }
    }
    return out;
  }
  function rewriteModule(mod, urlFor2) {
    const src = mod.source;
    const edits = [];
    let metaUsed = false;
    for (const s of collectStaticSpecifiers(mod.ast)) {
      const r = resolver.resolve(s.value, mod.path);
      const isRelative = s.value.startsWith("./") || s.value.startsWith("../");
      if (r.kind === "esm" && isRelative) {
        continue;
      }
      const url = urlFor2(r, s.value);
      if (r.kind === "json" && s.isStaticDecl) {
        edits.push({ start: s.node.start, end: s.declNode.end, text: JSON.stringify(url) });
      } else {
        edits.push({ start: s.node.start, end: s.node.end, text: JSON.stringify(url) });
      }
    }
    const walk = (node) => {
      if (!node || typeof node.type !== "string")
        return;
      if (node.type === "ImportExpression") {
        const arg = node.source ?? node.argument;
        const argText = arg ? src.slice(arg.start, arg.end) : "";
        edits.push({
          start: node.start,
          end: node.end,
          text: `globalThis.__ocDynImport(${JSON.stringify(dirnameOf(mod.path))}, ${argText})`
        });
      } else if (node.type === "MetaProperty" && node.meta?.name === "import" && node.property?.name === "meta") {
        metaUsed = true;
        edits.push({ start: node.start, end: node.end, text: "__ocImportMeta" });
      }
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v)) {
          for (const c of v)
            if (c && typeof c === "object")
              walk(c);
        } else if (v && typeof v === "object" && typeof v.type === "string")
          walk(v);
      }
    };
    walk(mod.ast);
    edits.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits)
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    if (out.startsWith("#!")) {
      const nl = out.indexOf(`
`);
      out = nl < 0 ? "" : out.slice(nl);
    }
    if (metaUsed) {
      out = `const __ocImportMeta = globalThis.__ocMetaFor(${JSON.stringify(mod.path)});
` + out;
    }
    return out;
  }
  function exportKeysOf(load) {
    try {
      const m = load();
      if (m !== null && m !== undefined && (typeof m === "object" || typeof m === "function")) {
        return Object.keys(m).filter(isSafeIdent);
      }
    } catch {}
    return [];
  }
  function builtinShimText(id) {
    let keys = [];
    try {
      const m = deps.requireBuiltin(id);
      if (m !== null && m !== undefined && (typeof m === "object" || typeof m === "function")) {
        keys = Object.keys(m).filter(isSafeIdent);
      }
    } catch {}
    let text = `const __m = globalThis.__ocEsmBuiltin(${JSON.stringify(id)});
export default __m;
`;
    for (const k of keys)
      text += `export const ${k} = __m[${JSON.stringify(k)}];
`;
    return text;
  }
  function cjsShimText(p) {
    const keys = exportKeysOf(() => deps.requireCjs(p));
    let text = `const __m = globalThis.__ocEsmCjs(${JSON.stringify(p)});
export default __m;
`;
    for (const k of keys)
      text += `export const ${k} = __m[${JSON.stringify(k)}];
`;
    return text;
  }
  function jsonShimText(p) {
    let data;
    try {
      data = JSON.parse(readUtf8(p));
    } catch (e) {
      const err2 = new Error(`Cannot parse JSON module '${p}': ${e?.message ?? e}`);
      err2.code = "ERR_INVALID_JSON";
      throw err2;
    }
    const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).filter(isSafeIdent) : [];
    let text = `const __j = globalThis.__ocEsmJson(${JSON.stringify(p)});
export default __j;
`;
    for (const k of keys)
      text += `export const ${k} = __j[${JSON.stringify(k)}];
`;
    return text;
  }
  async function buildGraph(entryPath) {
    if (published.has(entryPath))
      return urlOf(entryPath);
    const modules = new Map;
    const shimPaths = new Set;
    const stack = [entryPath];
    while (stack.length > 0) {
      const path = stack.pop();
      if (modules.has(path) || published.has(path))
        continue;
      const source = readUtf8(path);
      const ast = parseModule(source, path);
      modules.set(path, { path, source, ast });
      for (const s of collectStaticSpecifiers(ast)) {
        const r = resolver.resolve(s.value, path);
        if (r.kind === "esm") {
          if (!modules.has(r.path) && !published.has(r.path))
            stack.push(r.path);
        } else if (r.kind === "builtin") {
          shimPaths.add(builtinShimPath(r.id));
        } else if (r.kind === "cjs") {
          shimPaths.add(cjsShimPath(r.path));
        } else if (r.kind === "json") {
          shimPaths.add(jsonShimPath(r.path));
        }
      }
    }
    const publish = new Map;
    for (const mod of modules.values()) {
      publish.set(mod.path, rewriteModule(mod, urlFor));
    }
    for (const shimPath of shimPaths) {
      if (published.has(shimPath))
        continue;
      if (shimPath.startsWith("/__oc_builtin/")) {
        const id = shimPath.slice("/__oc_builtin/".length, -".mjs".length);
        publish.set(shimPath, builtinShimText(id));
      } else if (shimPath.startsWith("/__oc_cjs/")) {
        const real = shimPath.slice("/__oc_cjs".length, -".mjs".length);
        publish.set(shimPath, cjsShimText(real));
      } else if (shimPath.startsWith("/__oc_json/")) {
        const real = shimPath.slice("/__oc_json".length, -".mjs".length);
        publish.set(shimPath, jsonShimText(real));
      }
    }
    if (publish.size > 0) {
      await serving.publish(processNonce, publish);
      for (const p of publish.keys())
        published.add(p);
    }
    return urlOf(entryPath);
  }
  function urlFor(r) {
    const shim = r.kind === "builtin" ? builtinShimPath(r.id) : r.kind === "cjs" ? cjsShimPath(r.path) : r.kind === "json" ? jsonShimPath(r.path) : null;
    return urlOf(shim ?? r.path);
  }
  let pendingImports = 0;
  let keepAliveTimer = null;
  function armImport() {
    pendingImports++;
    if (keepAliveTimer === null && typeof globalThis.setInterval === "function") {
      keepAliveTimer = globalThis.setInterval(() => {}, 1000);
    }
  }
  function disarmImport() {
    pendingImports = Math.max(0, pendingImports - 1);
    if (pendingImports === 0 && keepAliveTimer !== null) {
      globalThis.clearInterval?.(keepAliveTimer);
      keepAliveTimer = null;
    }
  }
  async function importEntry(entryPath) {
    const url = await buildGraph(entryPath);
    armImport();
    try {
      await import(url);
    } catch (err2) {
      if (err2 instanceof SyntaxError || /Invalid or unexpected token|Unexpected token|is not defined/.test(String(err2?.message ?? ""))) {
        const better = new SyntaxError(`${err2.message} [while evaluating module ${url}]`);
        better.code = err2?.code;
        better.cause = err2;
        throw better;
      }
      throw err2;
    } finally {
      disarmImport();
    }
  }
  async function dynamicImport(parentDir, spec) {
    armImport();
    try {
      const r = resolver.resolveFromDir(spec, parentDir);
      if (r.kind === "builtin") {
        return await import(await ensureShim(builtinShimPath(r.id), builtinShimText(r.id)));
      }
      if (r.kind === "cjs") {
        return await import(await ensureShim(cjsShimPath(r.path), cjsShimText(r.path)));
      }
      if (r.kind === "json") {
        return await import(await ensureShim(jsonShimPath(r.path), jsonShimText(r.path)));
      }
      const url = await buildGraph(r.path);
      return await import(url);
    } finally {
      disarmImport();
    }
  }
  async function ensureShim(shimPath, text) {
    if (published.has(shimPath))
      return urlOf(shimPath);
    const entries = new Map;
    entries.set(shimPath, text);
    await serving.publish(processNonce, entries);
    published.add(shimPath);
    return urlOf(shimPath);
  }
  return { importEntry, dynamicImport };
}

// src/packages/opencontainer/kernel/net-pending.ts
var pending = 0;
function netPendingCount() {
  return pending;
}
function wrapFetchForNetPending(fetchImpl) {
  const wrapped = (input, init) => {
    pending++;
    let p;
    try {
      p = Promise.resolve(fetchImpl(input, init));
    } catch (err2) {
      pending--;
      throw err2;
    }
    return p.finally(() => {
      pending--;
    });
  };
  wrapped.__ocNetCounted = true;
  return wrapped;
}
function installNetPendingGlobalFetch() {
  const g = globalThis;
  if (typeof g.fetch !== "function")
    return;
  if (g.fetch.__ocNetCounted)
    return;
  g.fetch = wrapFetchForNetPending(g.fetch);
}

// src/packages/opencontainer/kernel/http-fetch-client.ts
var REGISTRY_HOSTS = new Set(["registry.npmjs.org", "registry.npmjs.com"]);
function defaultOutboundRewrite(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && REGISTRY_HOSTS.has(u.hostname)) {
      return `/api/oc-net?u=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}
var LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "::"
]);
function defaultIsLoopback(host) {
  return LOOPBACK_HOSTS.has(String(host).trim().toLowerCase());
}
var encoder = new TextEncoder;
function toBytes2(chunk, encoding) {
  if (chunk === null || chunk === undefined)
    return null;
  if (typeof chunk === "string") {
    const enc = String(encoding ?? "utf8").toLowerCase();
    if (enc === "latin1" || enc === "binary") {
      const out = new Uint8Array(chunk.length);
      for (let i2 = 0;i2 < chunk.length; i2++)
        out[i2] = chunk.charCodeAt(i2) & 255;
      return out;
    }
    if (enc === "base64") {
      const bin = atob(chunk);
      const out = new Uint8Array(bin.length);
      for (let i2 = 0;i2 < bin.length; i2++)
        out[i2] = bin.charCodeAt(i2);
      return out;
    }
    if (enc === "hex") {
      const out = new Uint8Array(chunk.length >> 1);
      for (let i2 = 0;i2 < out.length; i2++) {
        out[i2] = parseInt(chunk.slice(i2 * 2, i2 * 2 + 2), 16) || 0;
      }
      return out;
    }
    return encoder.encode(chunk);
  }
  if (chunk instanceof Uint8Array)
    return chunk;
  if (chunk instanceof ArrayBuffer)
    return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return encoder.encode(String(chunk));
}
function concatBytes(chunks) {
  let len = 0;
  for (const c of chunks)
    len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
function nodeError(code, message) {
  const err2 = new Error(message);
  err2.code = code;
  return err2;
}
function mapFetchError(err2, url) {
  if (globalThis.__ocHttpDebug) {
    try {
      globalThis.__ocHttpDebug("fetch-reject " + url + " :: " + String(err2?.stack ?? err2));
    } catch {}
  }
  const e = err2;
  const name = String(e?.name ?? "");
  const message = String(e?.message ?? err2 ?? "network error");
  if (name === "TimeoutError") {
    return nodeError("ETIMEDOUT", `network timeout at: ${url}`);
  }
  if (name === "AbortError") {
    return nodeError("ECONNABORTED", `The user aborted a request: ${url}`);
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|dns|resolve|lookup/i.test(message)) {
    return nodeError("ENOTFOUND", `request to ${url} failed, reason: getaddrinfo ENOTFOUND (${message})`);
  }
  return nodeError("ECONNRESET", `request to ${url} failed, reason: ${message}`);
}
var DROPPED_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via"
]);
function isDroppedRequestHeader(name) {
  const n = name.toLowerCase();
  return DROPPED_REQUEST_HEADERS.has(n) || n.startsWith("proxy-") || n.startsWith("sec-");
}

class TinyEmitter {
  _listeners = Object.create(null);
  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }
  once(event, fn) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }
  addListener(event, fn) {
    return this.on(event, fn);
  }
  off(event, fn) {
    const list = this._listeners[event];
    if (list) {
      const i2 = list.indexOf(fn);
      if (i2 >= 0)
        list.splice(i2, 1);
    }
    return this;
  }
  removeListener(event, fn) {
    return this.off(event, fn);
  }
  removeAllListeners(event) {
    if (event)
      delete this._listeners[event];
    else
      this._listeners = Object.create(null);
    return this;
  }
  listenerCount(event) {
    return (this._listeners[event] ?? []).length;
  }
  emit(event, ...args) {
    const list = this._listeners[event];
    if (!list || list.length === 0) {
      if (event === "error") {
        const err2 = args[0];
        console.error(`http-fetch-client: unhandled 'error' event:`, err2?.code ?? "", err2?.message ?? err2);
      }
      return false;
    }
    for (const fn of [...list]) {
      try {
        fn(...args);
      } catch (e) {
        console.error("http-fetch-client: response listener threw:", e);
      }
    }
    return true;
  }
}

class FakeSocket extends TinyEmitter {
  remoteAddress;
  remotePort;
  destroyed = false;
  constructor(remoteAddress, remotePort) {
    super();
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.emit("close");
  }
  ref() {}
  unref() {}
  setNoDelay(_msecs) {}
  setKeepAlive(_enable, _initialDelay) {}
  setTimeout(_msecs, _cb) {}
}

class FetchIncomingMessage extends TinyEmitter {
  statusCode;
  statusMessage;
  headers;
  rawHeaders;
  httpVersion = "1.1";
  url;
  method;
  complete = false;
  socket;
  trailers = {};
  req;
  _reader;
  _queue = [];
  _flowing = false;
  _pumpScheduled = false;
  _pumping = false;
  _destroyed = false;
  _gate = null;
  _gateResolve = null;
  _touch = null;
  constructor(response, init) {
    super();
    this.statusCode = response.status;
    this.statusMessage = String(init.statusCodes?.[response.status] ?? "");
    this.method = init.method;
    this.url = init.url;
    this.socket = init.socket;
    const folded = Object.create(null);
    const raw = [];
    if (response.headers) {
      response.headers.forEach((value, name) => {
        const n = name.toLowerCase();
        if (n === "content-encoding" || n === "content-length")
          return;
        (folded[n] ??= []).push(value);
        raw.push(n, value);
      });
    }
    const headers = Object.create(null);
    for (const key of Object.keys(folded)) {
      headers[key] = folded[key].join(", ");
    }
    this.headers = headers;
    this.rawHeaders = raw;
    this._reader = response.body ? response.body.getReader() : null;
  }
  _start() {
    if (this._destroyed)
      return;
    if (this._reader === null) {
      this._finish();
      return;
    }
    if (this._flowing)
      this._schedulePump();
  }
  on(event, fn) {
    super.on(event, fn);
    if (event === "data") {
      this._flowing = true;
      this._releaseGate();
      queueMicrotask(() => {
        this._drainQueue();
        this._schedulePump();
      });
    } else if (event === "end" || event === "readable") {
      queueMicrotask(() => this._schedulePump());
    }
    return this;
  }
  resume() {
    this._flowing = true;
    this._releaseGate();
    queueMicrotask(() => {
      this._drainQueue();
      this._schedulePump();
    });
  }
  pause() {
    this._flowing = false;
    if (!this._gate)
      this._gate = new Promise((r) => this._gateResolve = r);
  }
  read() {
    if (this._queue.length === 0 && this._reader && !this._pumping && !this._destroyed) {
      this._schedulePump();
    }
    return this._queue.shift() ?? null;
  }
  pipe(dest) {
    this.on("data", (chunk) => {
      const ok = dest.write(chunk);
      if (!ok)
        this.pause();
    });
    if (typeof dest.on === "function") {
      dest.on("drain", () => this.resume());
    }
    this.on("end", () => {
      if (typeof dest.end === "function")
        dest.end();
    });
    this.on("error", (err2) => {
      if (typeof dest.emit === "function")
        dest.emit("error", err2);
      else if (typeof dest.destroy === "function")
        dest.destroy(err2);
    });
    return dest;
  }
  destroy(err2) {
    if (this._destroyed)
      return;
    this._destroyed = true;
    const reader = this._reader;
    this._reader = null;
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {}
    }
    if (err2)
      this.emit("error", err2);
    if (!this.complete) {
      this.emit("aborted");
    }
    this.emit("close");
  }
  _releaseGate() {
    if (this._gateResolve) {
      const r = this._gateResolve;
      this._gate = null;
      this._gateResolve = null;
      r();
    }
  }
  _drainQueue() {
    while (this._queue.length > 0 && this._flowing) {
      const chunk = this._queue.shift();
      this.emit("data", chunk);
    }
  }
  _schedulePump() {
    if (this._pumpScheduled)
      return;
    this._pumpScheduled = true;
    queueMicrotask(() => {
      this._pumpScheduled = false;
      this._pump();
    });
  }
  async _pump() {
    if (this._pumping)
      return;
    if (!this._reader || this._destroyed)
      return;
    this._pumping = true;
    try {
      for (;; ) {
        if (this._gate)
          await this._gate;
        if (this._destroyed || !this._reader)
          return;
        const { done, value } = await this._reader.read();
        if (this._destroyed || !this._reader)
          return;
        if (done)
          break;
        const raw = value;
        let bytes;
        if (raw instanceof Uint8Array)
          bytes = raw;
        else if (typeof raw === "string")
          bytes = encoder.encode(raw);
        else if (raw?.buffer)
          bytes = new Uint8Array(raw.buffer, raw.byteOffset ?? 0, raw.byteLength ?? raw.buffer.byteLength);
        else
          bytes = encoder.encode(String(raw ?? ""));
        this._touch?.();
        if (this._flowing)
          this.emit("data", bytes);
        else
          this._queue.push(bytes);
      }
      this._finish();
    } catch (err2) {
      if (this._destroyed)
        return;
      this._reader = null;
      this.emit("error", mapFetchError(err2, this.url || ""));
      this.emit("close");
    } finally {
      this._pumping = false;
    }
  }
  _finish() {
    if (this.complete)
      return;
    this._reader = null;
    this.complete = true;
    this._drainQueue();
    this.emit("end");
    this.emit("close");
  }
}

class FetchClientRequest extends TinyEmitter {
  aborted = false;
  destroyed = false;
  finished = false;
  headersSent = false;
  res = null;
  socket = null;
  method;
  path;
  host;
  port;
  protocol;
  _init;
  _rewrite;
  _fetchImpl;
  _statusCodes;
  _headers;
  _bodyChunks = [];
  _started = false;
  _ended = false;
  _done = false;
  _errorEmitted = false;
  _destroyAfterResponse = false;
  _controller = new AbortController;
  _timeoutMs = 0;
  _timeoutCb = null;
  _idleTimer = null;
  _targetUrl = "";
  constructor(init, ctx) {
    super();
    this._init = init;
    this._rewrite = ctx.rewrite;
    this._fetchImpl = ctx.fetchImpl;
    this._statusCodes = ctx.statusCodes;
    this._headers = { ...init.headers };
    this.method = init.method;
    this.path = init.path;
    this.host = init.host;
    this.port = init.port;
    this.protocol = init.protocol;
    if (typeof init.timeout === "number" && init.timeout > 0) {
      this._timeoutMs = init.timeout;
    }
  }
  setHeader(name, value) {
    this._headers[name] = value;
    return this;
  }
  getHeader(name) {
    return this._headers[name];
  }
  getHeaders() {
    return { ...this._headers };
  }
  removeHeader(name) {
    delete this._headers[name];
    return this;
  }
  hasHeader(name) {
    return Object.prototype.hasOwnProperty.call(this._headers, name);
  }
  write(chunk, encoding, cb) {
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = undefined;
    }
    if (this._ended || this.destroyed) {
      const err2 = nodeError("ERR_STREAM_WRITE_AFTER_END", "write after end");
      if (globalThis.__ocHttpDebug) {
        try {
          globalThis.__ocHttpDebug("stream-error :: " + String(err2?.stack ?? err2));
        } catch {}
      }
      this.emit("error", err2);
      if (typeof cb === "function")
        queueMicrotask(() => cb(err2));
      return false;
    }
    const bytes = toBytes2(chunk, typeof encoding === "string" ? encoding : undefined);
    if (bytes)
      this._bodyChunks.push(bytes);
    if (typeof cb === "function")
      queueMicrotask(() => cb());
    return true;
  }
  end(chunk, encoding, cb) {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = undefined;
    }
    if (chunk !== null && chunk !== undefined) {
      const bytes = toBytes2(chunk, typeof encoding === "string" ? encoding : undefined);
      if (bytes && !this._ended)
        this._bodyChunks.push(bytes);
    }
    if (!this._ended) {
      this._ended = true;
      this.finished = true;
      queueMicrotask(() => this._startFetch());
    }
    if (typeof cb === "function") {
      if (this._done)
        queueMicrotask(() => cb());
      else
        this.once("close", () => cb());
    }
    return this;
  }
  flushHeaders() {
    if (this._started)
      return;
    if ((this.method === "GET" || this.method === "HEAD") && this._bodyChunks.length === 0) {
      this._ended = true;
      this.finished = true;
      queueMicrotask(() => this._startFetch());
    }
  }
  abort() {
    this._destroy(nodeError("ECONNABORTED", `The user aborted a request: ${this._targetUrl || this.path}`));
  }
  destroy(err2) {
    this._destroy(err2 ?? nodeError("ECONNABORTED", `The user aborted a request: ${this._targetUrl || this.path}`));
  }
  destroySoon() {
    if (!this._ended)
      this.end();
    this._destroyAfterResponse = true;
    if (this._done)
      this._destroyQuietly();
  }
  setTimeout(msecs, cb) {
    this._timeoutMs = msecs > 0 ? msecs : 0;
    this._timeoutCb = cb ?? null;
    if (this._started && this._timeoutMs)
      this._armIdle();
    return this;
  }
  setNoDelay(_noDelay) {
    return this;
  }
  setSocketKeepAlive(_enable, _initialDelay) {
    return this;
  }
  setAgent(_agent) {
    return this;
  }
  _armIdle() {
    if (!this._timeoutMs)
      return;
    if (this._idleTimer)
      clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._onTimeout(), this._timeoutMs);
  }
  _onTimeout() {
    if (this.destroyed || this._done)
      return;
    this.emit("timeout");
    if (this._timeoutCb) {
      try {
        this._timeoutCb();
      } catch (e) {
        this.emit("error", e);
      }
    }
    this._destroy(nodeError("ETIMEDOUT", `network timeout at: ${this._targetUrl || this._init.absoluteUrl}`));
  }
  _buildHeaders() {
    const out = new Headers;
    const apply = (name, value) => {
      if (isDroppedRequestHeader(name))
        return;
      if (value === null || value === undefined)
        return;
      try {
        if (Array.isArray(value)) {
          for (const v of value)
            out.append(name, String(v));
        } else {
          out.append(name, String(value));
        }
      } catch {}
    };
    for (const name of Object.keys(this._headers))
      apply(name, this._headers[name]);
    if (this._init.auth) {
      try {
        apply("authorization", `Basic ${btoa(this._init.auth)}`);
      } catch {}
    }
    return out;
  }
  _startFetch() {
    if (this._started || this.destroyed)
      return;
    this._started = true;
    this.headersSent = true;
    const absUrl = this._init.absoluteUrl;
    this._targetUrl = this._rewrite ? this._rewrite(absUrl) : absUrl;
    const headers = this._buildHeaders();
    let body;
    if (this.method !== "GET" && this.method !== "HEAD" && this._bodyChunks.length > 0) {
      body = concatBytes(this._bodyChunks);
    }
    const socket = new FakeSocket(this.host, this.port);
    this.socket = socket;
    this.emit("socket", socket);
    this._armIdle();
    const fetchFn = this._fetchImpl ?? globalThis.fetch;
    const opts = {
      method: this.method,
      headers,
      redirect: "manual",
      signal: this._controller.signal
    };
    if (body)
      opts.body = body;
    fetchFn(this._targetUrl, opts).then((response) => {
      if (this.destroyed) {
        try {
          response.body?.cancel().catch(() => {});
        } catch {}
        return;
      }
      this._armIdle();
      queueMicrotask(() => this._deliverResponse(response));
    }).catch((err2) => {
      if (this.destroyed || this._errorEmitted)
        return;
      const mapped = mapFetchError(err2, this._targetUrl || absUrl);
      queueMicrotask(() => this._emitError(mapped));
    });
  }
  _deliverResponse(response) {
    if (this.destroyed || this._done)
      return;
    const res = new FetchIncomingMessage(response, {
      method: this.method,
      url: this.path,
      socket: this.socket,
      statusCodes: this._statusCodes
    });
    res.req = this;
    res._touch = () => this._armIdle();
    this.res = res;
    this._watchResponse(res);
    this.emit("response", res);
    res._start();
  }
  _emitError(err2) {
    if (this._errorEmitted || this._done)
      return;
    this._errorEmitted = true;
    this.emit("error", err2);
    this._closeAll();
  }
  _destroy(err2) {
    if (this.destroyed)
      return;
    if (this._done) {
      this.destroyed = true;
      this.aborted = true;
      return;
    }
    this.destroyed = true;
    this.aborted = true;
    this.emit("abort");
    try {
      this._controller.abort();
    } catch {}
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    const res = this.res;
    if (res && !res.complete) {
      res.destroy();
    }
    if (err2 && !this._errorEmitted) {
      this._errorEmitted = true;
      this.emit("error", err2);
    }
    this._closeAll();
  }
  _destroyQuietly() {
    if (this.destroyed || this._done)
      return;
    this.destroyed = true;
    this.aborted = true;
    try {
      this._controller.abort();
    } catch {}
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (this.res && !this.res.complete)
      this.res.destroy();
    this.emit("close");
  }
  _closeAll() {
    this._done = true;
    this.emit("close");
    this.socket?.destroy();
  }
  _watchResponse(res) {
    res.once("close", () => {
      if (this._done || this.destroyed)
        return;
      this._done = true;
      if (this._destroyAfterResponse) {
        this.destroyed = true;
        this.aborted = true;
        try {
          this._controller.abort();
        } catch {}
        this.emit("close");
        this.socket?.destroy();
      } else {
        this.emit("close");
        this.socket?.destroy();
      }
    });
  }
}
function normalizeArgs(a, b, c) {
  let urlInput = null;
  let options = {};
  let cb = null;
  if (typeof a === "string" || a instanceof URL) {
    urlInput = a;
    if (typeof b === "function") {
      cb = b;
    } else if (b && typeof b === "object") {
      options = b;
      if (typeof c === "function")
        cb = c;
    }
  } else if (a && typeof a === "object") {
    options = a;
    if (typeof b === "function")
      cb = b;
  }
  return { urlInput, options: { ...options }, cb };
}
function urlToHttpOptions(u) {
  const o = {};
  o.protocol = u.protocol;
  o.hostname = u.hostname;
  o.host = u.host;
  o.auth = u.username || u.password ? `${u.username}:${u.password}` : "";
  if (u.port)
    o.port = u.port;
  o.path = `${u.pathname}${u.search}` || "/";
  return o;
}
function resolveTarget(urlInput, options, moduleDefaultProto) {
  const fromUrl = {};
  if (typeof urlInput === "string" && urlInput) {
    try {
      Object.assign(fromUrl, urlToHttpOptions(new URL(urlInput)));
    } catch {
      fromUrl.path = urlInput.startsWith("/") ? urlInput : `/${urlInput}`;
    }
  } else if (urlInput instanceof URL) {
    Object.assign(fromUrl, urlToHttpOptions(urlInput));
  }
  const protocol = String(options.protocol ?? fromUrl.protocol ?? `${moduleDefaultProto}:`).replace(/:$/, "");
  let host = String(options.hostname ?? options.host ?? fromUrl.hostname ?? fromUrl.host ?? "localhost");
  if (host.includes(":") && !host.startsWith("[")) {
    const idx = host.lastIndexOf(":");
    const maybePort = host.slice(idx + 1);
    if (/^\d+$/.test(maybePort)) {
      host = host.slice(0, idx);
      if (options.port === undefined && fromUrl.port === undefined)
        options.port = maybePort;
    } else if (protocol === "https" || protocol === "http") {
      host = `[${host}]`;
    }
  }
  const port = Number(options.port ?? fromUrl.port ?? 0) || (protocol === "https" ? 443 : 80);
  const path = String(options.path ?? fromUrl.path ?? "/");
  return { host, port, protocol, path };
}
function buildAbsoluteUrl(t) {
  let h = t.host;
  if (h.includes(":") && !h.startsWith("["))
    h = `[${h}]`;
  const defaultPort = t.protocol === "https" ? 443 : 80;
  const portPart = t.port && t.port !== defaultPort ? `:${t.port}` : "";
  const p = t.path.startsWith("/") ? t.path : `/${t.path}`;
  return `${t.protocol}://${h}${portPart}${p}`;
}
function installFetchHttpClient(opts) {
  const { http, https } = opts;
  if (!http || !https)
    throw new Error("installFetchHttpClient: `http` and `https` module objects are required");
  const rewrite = opts.rewrite;
  const fetchImpl = opts.fetchImpl;
  const isLoopback = opts.isLoopback ?? defaultIsLoopback;
  const statusCodes = http.STATUS_CODES ?? https.STATUS_CODES ?? {};
  const orig = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get
  };
  const ctx = { rewrite, fetchImpl, statusCodes };
  const makeRequest = (moduleDefaultProto) => function patchedRequest(a, b, c) {
    const { urlInput, options, cb } = normalizeArgs(a, b, c);
    let target;
    try {
      target = resolveTarget(urlInput, options, moduleDefaultProto);
    } catch {
      const fn = moduleDefaultProto === "https" ? orig.httpsRequest : orig.httpRequest;
      return fn.call(this, a, b, c);
    }
    const checkHost = target.host.replace(/^\[|\]$/g, "");
    if (isLoopback(checkHost, target.port)) {
      const fn = moduleDefaultProto === "https" ? orig.httpsRequest : orig.httpRequest;
      return fn.call(this, a, b, c);
    }
    const headers = {};
    const raw = options.headers;
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw) || raw instanceof Map || typeof raw[Symbol.iterator] === "function") {
        for (const pair of raw) {
          const [k, v] = Array.isArray(pair) ? pair : [String(pair), undefined];
          headers[k] = v;
        }
      } else {
        Object.assign(headers, raw);
      }
    }
    const init = {
      method: String(options.method ?? "GET").toUpperCase(),
      protocol: target.protocol,
      host: target.host,
      port: target.port,
      path: target.path,
      absoluteUrl: buildAbsoluteUrl(target),
      headers,
      auth: options.auth ?? undefined,
      timeout: typeof options.timeout === "number" ? options.timeout : undefined
    };
    const req = new FetchClientRequest(init, ctx);
    if (cb)
      req.once("response", cb);
    return req;
  };
  const httpRequest = makeRequest("http");
  const httpsRequest = makeRequest("https");
  const httpGet = function patchedGet(a, b, c) {
    const req = httpRequest.call(this, a, b, c);
    if (typeof req?.end === "function")
      req.end();
    return req;
  };
  const httpsGet = function patchedGetHttps(a, b, c) {
    const req = httpsRequest.call(this, a, b, c);
    if (typeof req?.end === "function")
      req.end();
    return req;
  };
  http.request = httpRequest;
  http.get = httpGet;
  https.request = httpsRequest;
  https.get = httpsGet;
  return {
    uninstall() {
      http.request = orig.httpRequest;
      http.get = orig.httpGet;
      https.request = orig.httpsRequest;
      https.get = orig.httpsGet;
    }
  };
}

// src/packages/opencontainer/kernel/esm-to-cjs.ts
class RequireAsyncModuleError extends Error {
  code;
  constructor(filename) {
    super(`Top-level await is not available in required ES modules ` + `(ESM file ${filename} uses top-level await).`);
    this.code = "ERR_REQUIRE_ASYNC_MODULE";
    this.name = "Error";
  }
}
var INTEROPHelper = 'const __ocDef = (m) => (m && m.__esModule && "default" in m) ? m.default : m;';
function transformEsmToCjs(source, filename, acorn, fileUrl) {
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      allowHashBang: true,
      locations: false,
      ranges: false
    });
  } catch (err2) {
    if (err2 instanceof SyntaxError) {
      try {
        err2.message = `${err2.message} at ${filename}`;
      } catch {}
    }
    throw err2;
  }
  if (hasTopLevelAwait(ast)) {
    throw new RequireAsyncModuleError(filename);
  }
  const prelude = [];
  const epilogue = [];
  const removals = [];
  const exportNames = [];
  let hasDefault = false;
  let modSeq = 0;
  const metaObj = `const __ocImportMeta = { url: ${JSON.stringify(fileUrl)}, ` + `filename: ${JSON.stringify(filename)}, dirname: ${JSON.stringify(dirOf(filename))} };`;
  const requireModule = (raw) => {
    const v = `__oc_m${modSeq++}`;
    prelude.push(`const ${v} = require(${JSON.stringify(raw)});`);
    return v;
  };
  for (const stmt of ast.body) {
    switch (stmt.type) {
      case "ImportDeclaration": {
        const src = stmt.source.value;
        const mvar = requireModule(src);
        for (const spec of stmt.specifiers) {
          if (spec.type === "ImportDefaultSpecifier") {
            prelude.push(`const ${localName(spec.local)} = __ocDef(${mvar});`);
          } else if (spec.type === "ImportNamespaceSpecifier") {
            prelude.push(`const ${localName(spec.local)} = ${mvar};`);
          } else {
            const imported = spec.imported.type === "Identifier" ? spec.imported.name : JSON.stringify(spec.imported.value);
            prelude.push(`const ${localName(spec.local)} = ${mvar}[${imported === "default" ? '"default"' : JSON.stringify(imported)}];`);
          }
        }
        removals.push({ start: stmt.start, end: stmt.end, replacement: "" });
        break;
      }
      case "ExportDefaultDeclaration": {
        hasDefault = true;
        const decl = stmt.declaration;
        if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
          let text = slice(source, stmt.start, decl.start) + slice(source, decl.start, stmt.end);
          text = text.replace(/^export\s+default\s+/, "");
          const name = decl.id?.name;
          removals.push({ start: stmt.start, end: stmt.end, replacement: text });
          epilogue.push(defineGetter("default", name ?? `__ocDefault_${exportNames.length}`));
          if (!name) {
            const patched = text.replace(/^(async\s+)?function\s*\(/, `$1function __ocDefault_${exportNames.length}(`).replace(/^class\s+\{/, `class __ocDefault_${exportNames.length} {`).replace(/^class\s*\{/, `class __ocDefault_${exportNames.length} {`);
            removals[removals.length - 1] = { start: stmt.start, end: stmt.end, replacement: patched };
          }
        } else {
          const exprText = slice(source, decl.start, decl.end);
          const v = `__ocDefault`;
          removals.push({
            start: stmt.start,
            end: stmt.end,
            replacement: `const ${v} = ${exprText};`
          });
          epilogue.push(defineGetter("default", v));
        }
        exportNames.push("default");
        break;
      }
      case "ExportNamedDeclaration": {
        const decl = stmt.declaration;
        const srcNode = stmt.source;
        if (decl) {
          const declText = slice(source, decl.start, decl.end);
          removals.push({ start: stmt.start, end: stmt.end, replacement: declText });
          if (decl.type === "VariableDeclaration") {
            for (const d of decl.declarations)
              collectPattern(d.id).forEach((n) => {
                exportNames.push(n);
                epilogue.push(defineGetter(n, n));
              });
          } else if (decl.id?.name) {
            exportNames.push(decl.id.name);
            epilogue.push(defineGetter(decl.id.name, decl.id.name));
          }
        } else if (srcNode) {
          const mvar = requireModule(srcNode.value);
          for (const spec of stmt.specifiers) {
            const exported = spec.exported.type === "Identifier" ? spec.exported.name : JSON.stringify(spec.exported.value);
            const imported = spec.imported.type === "Identifier" ? spec.imported.name : JSON.stringify(spec.imported.value);
            const acc = imported === "default" ? `${mvar}["default"]` : `${mvar}[${JSON.stringify(imported)}]`;
            exportNames.push(exported);
            epilogue.push(defineGetterExpr(exported, acc));
          }
          removals.push({ start: stmt.start, end: stmt.end, replacement: "" });
        } else {
          for (const spec of stmt.specifiers) {
            const exported = spec.exported.type === "Identifier" ? spec.exported.name : JSON.stringify(spec.exported.value);
            const local = spec.local.name;
            exportNames.push(exported);
            epilogue.push(defineGetter(exported, local));
          }
          removals.push({ start: stmt.start, end: stmt.end, replacement: "" });
        }
        break;
      }
      case "ExportAllDeclaration": {
        const src = stmt.source.value;
        const mvar = requireModule(src);
        if (stmt.exported) {
          const ns = stmt.exported.type === "Identifier" ? stmt.exported.name : stmt.exported.value;
          exportNames.push(ns);
          epilogue.push(defineGetterExpr(ns, mvar));
        } else {
          prelude.push(`for (const __k of Object.keys(${mvar})) { if (__k !== "default" && !(` + `Object.prototype.hasOwnProperty.call(exports, __k))) ` + `Object.defineProperty(exports, __k, { enumerable: true, ` + `configurable: true, get: () => ${mvar}[__k] }); }`);
        }
        removals.push({ start: stmt.start, end: stmt.end, replacement: "" });
        break;
      }
      default:
        break;
    }
  }
  removals.sort((a, b) => b.start - a.start);
  let out = source;
  for (const r of removals) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  if (out.includes("import.meta")) {
    out = out.split("import.meta").join("__ocImportMeta");
  }
  const head = `"use strict";
` + `${INTEROPHelper}
` + `${metaObj}
`;
  const body = prelude.length > 0 ? `
${prelude.join(`
`)}
` : "";
  const tail = epilogue.length > 0 ? `
${epilogue.join(`
`)}
` : "";
  const esModuleFlag = hasDefault ? `
exports.__esModule = true;
` : "";
  const code = head + `(function () {
` + body + out + tail + esModuleFlag + `
}).call(undefined);
`;
  return { code, exports: exportNames, hasDefault };
}
function slice(s, a, b) {
  return s.slice(a, b);
}
function localName(id) {
  return id.name;
}
function defineGetter(exported, local) {
  const key = JSON.stringify(exported);
  return `Object.defineProperty(exports, ${key}, { enumerable: true, configurable: true, ` + `get: () => ${local} });`;
}
function defineGetterExpr(exported, expr) {
  const key = JSON.stringify(exported);
  return `Object.defineProperty(exports, ${key}, { enumerable: true, configurable: true, ` + `get: () => (${expr}) });`;
}
function collectPattern(node, out = []) {
  if (!node)
    return out;
  if (node.type === "Identifier")
    out.push(node.name);
  else if (node.type === "ObjectPattern") {
    for (const p of node.properties) {
      collectPattern(p.value, out);
    }
  } else if (node.type === "ArrayPattern") {
    for (const el of node.elements)
      collectPattern(el, out);
  } else if (node.type === "AssignmentPattern") {
    collectPattern(node.left, out);
  } else if (node.type === "RestElement") {
    collectPattern(node.argument, out);
  }
  return out;
}
function dirOf(p) {
  const i2 = p.lastIndexOf("/");
  return i2 <= 0 ? "/" : p.slice(0, i2);
}
function hasTopLevelAwait(ast) {
  const fnTypes = new Set([
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ClassDeclaration",
    "ClassExpression"
  ]);
  let found = false;
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || found)
      return;
    if (typeof node.type !== "string") {
      if (Array.isArray(node)) {
        for (const n of node)
          visit(n, depth);
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === "type" || k.startsWith("_"))
          continue;
        visit(node[k], depth);
      }
      return;
    }
    if (node.type === "AwaitExpression") {
      found = true;
      return;
    }
    if (node.type === "ForOfStatement" && node.await) {
      found = true;
      return;
    }
    const enterFn = fnTypes.has(node.type);
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range" || k.startsWith("_"))
        continue;
      const v = node[k];
      if (v && typeof v === "object")
        visit(v, enterFn ? depth + 1 : depth);
    }
  };
  for (const stmt of ast.body) {
    if (found)
      break;
    visitTopLevel(stmt);
  }
  function visitTopLevel(node) {
    if (!node || typeof node !== "object" || found)
      return;
    if (typeof node.type !== "string") {
      if (Array.isArray(node)) {
        for (const n of node)
          visitTopLevel(n);
        return;
      }
      for (const k of Object.keys(node)) {
        if (k !== "type")
          visitTopLevel(node[k]);
      }
      return;
    }
    if (node.type === "AwaitExpression") {
      found = true;
      return;
    }
    if (node.type === "ForOfStatement" && node.await) {
      found = true;
      return;
    }
    if (fnTypes.has(node.type))
      return;
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range")
        continue;
      const v = node[k];
      if (v && typeof v === "object")
        visitTopLevel(v);
    }
  }
  return found;
}

// src/packages/opencontainer/kernel/boot.ts
var hostSetTimeout = globalThis.setTimeout?.bind(globalThis) ?? ((cb, ms) => setTimeout(cb, ms));
var hostSetInterval = globalThis.setInterval?.bind(globalThis) ?? ((cb, ms) => setInterval(cb, ms));
var hostClearInterval = globalThis.clearInterval?.bind(globalThis) ?? ((t) => clearInterval(t));
var pristineGlobals = (() => {
  const g = globalThis;
  return {
    process: g.process,
    console: g.console,
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    setImmediate: g.setImmediate,
    clearImmediate: g.clearImmediate,
    Buffer: g.Buffer,
    global: g.global
  };
})();
var realmGlobalsRestored = false;
function restoreHostGlobals() {
  if (realmGlobalsRestored)
    return;
  realmGlobalsRestored = true;
  const g = globalThis;
  for (const [key, value] of Object.entries(pristineGlobals)) {
    try {
      if (value === undefined)
        delete g[key];
      else
        g[key] = value;
    } catch {}
  }
}
async function bootKernel(opts) {
  const __stageT0 = Date.now();
  const __stage = (name) => {
    try {
      opts.onStage?.(name, Date.now() - __stageT0);
    } catch {}
  };
  const userOnExit = opts.hooks.onExit;
  realmGlobalsRestored = false;
  opts = {
    ...opts,
    hooks: {
      ...opts.hooks,
      onExit: (code) => {
        try {
          userOnExit?.(code);
        } finally {
          restoreHostGlobals();
        }
      }
    }
  };
  installNetPendingGlobalFetch();
  if (typeof globalThis.SharedArrayBuffer === "undefined") {
    globalThis.SharedArrayBuffer = ArrayBuffer;
  }
  const vfs = opts.vfs ?? new Vfs;
  const cwd = opts.cwd ?? "/home/project";
  vfs.mkdir("/home", true);
  vfs.mkdir(cwd, true);
  vfs.mkdir("/home/node", true);
  vfs.mkdir("/tmp", true);
  if (opts.hydrate) {
    vfs.importTree(opts.hydrate);
    __stage("hydrate");
  }
  {
    const mountPkg = (pkg) => {
      const files = opts.store.list?.(`${VENDOR_ROOT}/${pkg}/`) ?? [];
      if (files.length === 0)
        return 0;
      const root = `/usr/lib/node_modules/${pkg}`;
      let n = 0;
      for (const f of files) {
        const rel = f.slice(`${VENDOR_ROOT}/${pkg}/`.length);
        if (!/\.(js|cjs|mjs|json)$/.test(rel))
          continue;
        const dest = `${root}/${rel}`;
        vfs.mkdir(dest.slice(0, dest.lastIndexOf("/")), true);
        vfs.writeFile(dest, opts.store.get(f));
        n++;
      }
      return n;
    };
    mountPkg("npm-oc");
    mountPkg("pnpm-oc");
    mountPkg("semver");
    mountPkg("oc-sh");
    const binShim = (path, requirePath) => {
      vfs.mkdir(path.slice(0, path.lastIndexOf("/")), true);
      vfs.writeFile(path, `#!/usr/bin/env node
'use strict';
require(${JSON.stringify(requirePath)});
`);
    };
    vfs.mkdir("/usr/local/bin", true);
    vfs.mkdir("/usr/bin", true);
    vfs.mkdir("/bin", true);
    vfs.writeFile("/usr/local/bin/node", `#!/usr/bin/env node
`);
    binShim("/usr/local/bin/npm", "/usr/lib/node_modules/npm/bin/npm-cli.js");
    binShim("/usr/local/bin/npx", "/usr/lib/node_modules/npm/bin/npx-cli.js");
    binShim("/usr/bin/npm", "/usr/lib/node_modules/npm/bin/npm-cli.js");
    binShim("/usr/bin/npx", "/usr/lib/node_modules/npm/bin/npx-cli.js");
    binShim("/usr/local/bin/npm-oc", "/usr/lib/node_modules/npm-oc/cli.js");
    binShim("/usr/local/bin/pnpm", "/usr/lib/node_modules/pnpm/bin/pnpm.cjs");
    binShim("/usr/local/bin/pnpx", "/usr/lib/node_modules/pnpm/bin/pnpx.cjs");
    binShim("/usr/local/bin/pnpm-oc", "/usr/lib/node_modules/pnpm-oc/cli.js");
    binShim("/usr/local/bin/corepack", "/usr/lib/node_modules/oc-sh/corepack.js");
    binShim("/usr/bin/sh", "/usr/lib/node_modules/oc-sh/sh.js");
    binShim("/bin/sh", "/usr/lib/node_modules/oc-sh/sh.js");
    __stage("builtin-mounts");
  }
  let currentCwd = cwd;
  const options = opts.options ?? new Map;
  const stdio = opts.stdio ?? [
    { type: "tty" },
    { type: "tty" },
    { type: "tty" }
  ];
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/node",
    LANG: "en_US.UTF-8",
    TERM: "xterm-256color",
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_ignore_scripts: "true",
    NAPI_RS_FORCE_WASI: "true",
    ...opts.env
  };
  const nativesCtx = {
    vfs,
    hooks: opts.hooks,
    cwd: () => currentCwd,
    chdir: (p) => {
      currentCwd = p;
    },
    options,
    stdio
  };
  vfs.cwdProvider = () => currentCwd;
  const natives = new Natives(nativesCtx);
  const process = Object.create(EventEmitterLikeProto);
  Object.assign(process, {
    version: NODE_VERSION,
    versions: {
      node: NODE_VERSION.slice(1),
      v8: "0.0.0",
      uv: "1.51.0+opencontainer",
      zlib: "fflate",
      brotli: "0.0.0",
      ares: "1.0.0",
      modules: "137",
      http_parser: "llhttp/9.0.0",
      openssl: "0.0.0",
      icu: "browser",
      unicode: "browser",
      napi: "10",
      llhttp: "9.1.0",
      amaro: "1.1.11",
      webcontainers: undefined,
      opencontainer: "0.1.0"
    },
    platform: "browser",
    arch: "wasm32",
    machine: "wasm",
    pid: opts.pid ?? 1,
    ppid: opts.ppid ?? 0,
    title: "node",
    execPath: "/usr/local/bin/node",
    execArgv: [],
    argv: opts.argv ?? ["node"],
    env,
    argv0: "node",
    cwd: () => nativesCtx.cwd(),
    exitCode: undefined,
    sourceMapsEnabled: false,
    debugPort: 0,
    debugUsage: false,
    throwDeprecation: false,
    traceDeprecation: false,
    symbols: {},
    report: { getReport: () => "", reportOnUncaughtException: false, reportOnSignal: false, reportOnFatalError: false, signal: "SIGUSR2", filename: "" },
    _exiting: false,
    stdout: undefined,
    stderr: undefined,
    stdin: undefined,
    domain: null,
    config: {
      target_defaults: {},
      variables: { v8_enable_i18n_support: 0, node_use_openssl: "false", node_shared: "false", node_use_dtrace: "false", node_no_literals: "false" },
      nodedir: "",
      nodes: "browser",
      node_prefix: "/usr"
    },
    release: {
      name: "node",
      sourceUrl: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}.tar.xz`,
      headersUrl: ""
    },
    features: {
      inspector: false,
      debug: false,
      uv: true,
      ipv6: true,
      tls_alpn: false,
      tls_sni: false,
      tls_ocsp: false,
      tls: false,
      openssl_is_boringssl: false,
      cached_builtins: false,
      green_ee: false,
      openbsd: false
    }
  });
  const internalBinding = (name) => natives.get(name);
  const g = globalThis;
  g.getInternalBinding = internalBinding;
  g.__ocStdio = stdio;
  g.getLinkedBinding = (name) => {
    throw new Error(`OpenContainer: getLinkedBinding('${name}') — linked bindings do not exist in the browser`);
  };
  g.__ocWireBuiltinCompile = wireBuiltinCompile;
  g.__ocEnv = () => env;
  const registry3 = new ModuleRegistry(opts.store, {
    process,
    internalBinding,
    primordials: {},
    global: globalThis
  });
  __stage("registry");
  const primordials = loadPrimordials(opts.store);
  registry3.rt.primordials = primordials;
  g.primordials = primordials;
  const require2 = registry3.require;
  require2("internal/bootstrap/realm");
  __stage("realm");
  const taskQueues = require2("internal/process/task_queues");
  __stage("task_queues");
  let runNextTicks = null;
  if (typeof taskQueues.setupTaskQueue === "function") {
    const tickFns = taskQueues.setupTaskQueue();
    process.nextTick = tickFns.nextTick;
    runNextTicks = tickFns.runNextTicks;
  }
  const drainTicks = () => {
    try {
      runNextTicks?.();
    } catch (err2) {
      let handled = false;
      try {
        handled = typeof process._fatalException === "function" ? process._fatalException(err2, false) : false;
      } catch {}
      if (!handled) {
        try {
          completeFatalExit(err2);
        } catch {}
      }
    }
  };
  globalThis.__ocDrainTicks = drainTicks;
  const perThreadSetup = require2("internal/process/per_thread");
  __stage("process_per_thread");
  const rawMethods = internalBinding("process_methods");
  const wrapped = perThreadSetup.wrapProcessMethods(rawMethods);
  process.loadEnvFile = wrapped.loadEnvFile;
  process._rawDebug = wrapped._rawDebug;
  process.cpuUsage = wrapped.cpuUsage;
  process.threadCpuUsage = wrapped.threadCpuUsage;
  process.resourceUsage = wrapped.resourceUsage;
  process.memoryUsage = wrapped.memoryUsage;
  process.constrainedMemory = rawMethods.constrainedMemory;
  process.availableMemory = rawMethods.availableMemory;
  process.kill = wrapped.kill;
  process.exit = wrapped.exit;
  process.execve = wrapped.execve;
  process.chdir = rawMethods.chdir;
  process.umask = rawMethods.umask;
  process.initCwd = cwd;
  process.ref = perThreadSetup.ref;
  process.unref = perThreadSetup.unref;
  process.hrtime = perThreadSetup.hrtime;
  process.hrtime.bigint = perThreadSetup.hrtimeBigInt;
  process.openStdin = function() {
    process.stdin.resume();
    return process.stdin;
  };
  process._getActiveRequests = rawMethods._getActiveRequests ?? (() => []);
  process._getActiveHandles = rawMethods._getActiveHandles ?? (() => []);
  process.getActiveResourcesInfo = rawMethods.getActiveResourcesInfo ?? (() => []);
  process.reallyExit = rawMethods.reallyExit;
  process._kill = wrapped.kill;
  process._debugProcess = rawMethods._debugProcess ?? (() => {});
  process._debugEnd = rawMethods._debugEnd ?? (() => {});
  const EventEmitter = require2("events");
  setProto(process, EventEmitter.prototype);
  EventEmitter.call(process);
  natives.get("tty_wrap").attachProcess?.(process);
  require2("internal/bootstrap/switches/is_main_thread");
  __stage("is_main_thread");
  const consoleModule = require2("console");
  const consoleConstructorMod = require2("internal/console/constructor");
  consoleConstructorMod.initializeGlobalConsole(consoleModule);
  __stage("console");
  globalThis.__ocBootDebug?.("after-console");
  const g2 = globalThis;
  g2.process = process;
  g2.console = consoleModule;
  globalThis.__ocBootDebug?.("before-debuglog");
  const debuglogMod = require2("internal/util/debuglog");
  if (typeof debuglogMod.initializeDebugEnv === "function") {
    debuglogMod.initializeDebugEnv(env.NODE_DEBUG ?? "");
  }
  globalThis.__ocBootDebug?.("before-cjs-loader");
  const cjsLoaderMod = require2("internal/modules/cjs/loader");
  cjsLoaderMod.initializeCJS();
  __stage("cjs_loader");
  if (!options.has("--require-module"))
    options.set("--require-module", true);
  {
    const acornMod = require2("internal/deps/acorn/acorn/dist/acorn");
    const ModuleCtor = cjsLoaderMod.Module;
    const origCompile = ModuleCtor.prototype._compile;
    ModuleCtor.prototype._compile = function(content, filename, format) {
      if (format === "module" || format === "module-typescript") {
        if (format === "module-typescript") {
          const { lazyTypeScript } = require2("internal/modules/ts_limiter");
          content = lazyTypeScript().stripTypeScriptTypes(content, filename, fileUrlOf(filename));
          format = "module";
        }
        const { code } = transformEsmToCjs(content, filename, acornMod, fileUrlOf(filename));
        return origCompile.call(this, code, filename, "commonjs");
      }
      return origCompile.apply(this, arguments);
    };
    __stage("require_esm");
  }
  {
    const httpMod = require2("http");
    const httpsMod = require2("https");
    installFetchHttpClient({
      http: httpMod,
      https: httpsMod,
      rewrite: opts.hooks.outboundRewrite ?? defaultOutboundRewrite
    });
    __stage("http_client");
  }
  if (opts.hooks.esmServing) {
    const acorn = require2("internal/deps/acorn/acorn/dist/acorn");
    const builtinModules = cjsLoaderMod.Module?.builtinModules ?? [];
    const requireCjsFile = (p) => cjsLoaderMod.Module._load(p, null, true);
    globalThis.__ocRequireFile = requireCjsFile;
    const importer = makeEsmGraphImporter({
      vfs: nativesCtx.vfs,
      requireBuiltin: require2,
      requireCjs: requireCjsFile,
      builtinModules,
      acorn,
      serving: opts.hooks.esmServing
    });
    globalThis.__ocEsmGraphImport = (entryUrl, entryPath) => importer.importEntry(entryPath.startsWith("/") ? entryPath : entryUrl);
    globalThis.__ocDynImport = (parentDir, spec) => importer.dynamicImport(parentDir, spec);
    globalThis.__ocEsmBuiltin = (id) => require2(id);
    globalThis.__ocEsmCjs = (p) => requireCjsFile(p);
    globalThis.__ocEsmJson = (p) => {
      const bytes = nativesCtx.vfs.readFile(p);
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    globalThis.__ocMetaFor = (p) => {
      const url = fileUrlOf(p);
      const meta = { url, dirname: null, filename: null };
      try {
        meta.filename = p;
        meta.dirname = dirnameOf(p);
      } catch {}
      return Object.freeze(meta);
    };
  }
  __stage("esm_graph");
  const helpers = require2("internal/modules/helpers");
  if (typeof helpers.addBuiltinLibsToObject === "function") {
    helpers.addBuiltinLibsToObject(globalThis, "<eval>");
  }
  globalThis.__ocBootDebug?.("before-timers");
  const timersModule = require2("timers");
  const internalTimers = require2("internal/timers");
  if (typeof internalTimers?.getTimerCallbacks === "function") {
    const timerCallbacks = internalTimers.getTimerCallbacks(() => runNextTicks?.());
    const timersB = internalBinding("timers");
    g.__ocProcessTimers = () => {
      runNextTicks?.();
      const now = timersB.getLibuvNow();
      const next = timerCallbacks.processTimers(now);
      if (next !== 0) {
        timersB.scheduleTimer(Math.max(0, Math.abs(next) - now));
      }
    };
    g.__ocProcessImmediate = () => {
      runNextTicks?.();
      timerCallbacks.processImmediate();
    };
  }
  globalThis.setImmediate = timersModule.setImmediate;
  globalThis.clearImmediate = timersModule.clearImmediate;
  globalThis.setInterval = timersModule.setInterval;
  globalThis.clearInterval = timersModule.clearInterval;
  globalThis.setTimeout = timersModule.setTimeout;
  globalThis.clearTimeout = timersModule.clearTimeout;
  globalThis.__ocBootDebug?.("before-buffer");
  const Buffer = require2("buffer").Buffer;
  globalThis.Buffer = Buffer;
  globalThis.global = globalThis;
  globalThis.__ocBootDebug?.("before-execution");
  const execution = require2("internal/process/execution");
  process._fatalException = execution.onGlobalUncaughtException;
  process.setUncaughtExceptionCaptureCallback = execution.setUncaughtExceptionCaptureCallback;
  process.addUncaughtExceptionCaptureCallback = execution.addUncaughtExceptionCaptureCallback;
  process.hasUncaughtExceptionCaptureCallback = execution.hasUncaughtExceptionCaptureCallback;
  const warningMod = require2("internal/process/warning");
  process.emitWarning = warningMod.emitWarning;
  process.getBuiltinModule = helpers.getBuiltinModule;
  try {
    Object.defineProperty(process, Symbol.toStringTag, {
      __proto__: null,
      configurable: true,
      value: "process"
    });
    Object.defineProperty(globalThis, Symbol.toStringTag, {
      __proto__: null,
      configurable: true,
      value: "global"
    });
  } catch {}
  try {
    const promisesMod = require2("internal/process/promises");
    promisesMod.listenForRejections();
    globalThis.__ocGetPromiseRejectCallback = () => natives.get("task_queue").getPromiseRejectCallback?.();
  } catch (e) {
    globalThis.__ocDebugHook?.(`[promises setup failed] ${String(e)}`);
  }
  globalThis.__ocBootDebug?.("before-cjs-exec");
  const cjsExecution = execution;
  function completeFatalExit(err2) {
    if (!process._exiting)
      return false;
    try {
      const stack = err2?.stack ?? String(err2);
      const code = typeof err2?.code === "string" ? err2.code : null;
      let header = stack;
      const name = err2?.name ?? "Error";
      if (code && !stack.includes(`[${code}]`) && stack.startsWith(`${name}: `)) {
        header = `${name} [${code}]: ${stack.slice(name.length + 2)}`;
      }
      opts.hooks.onStdio(2, `${header}
Node.js ${NODE_VERSION}
`);
      process.reallyExit?.(process.exitCode ?? 1);
    } catch {}
    return true;
  }
  async function runEval(code, print) {
    options.set("--eval", code);
    if (print)
      options.set("--print", true);
    try {
      cjsExecution.evalScript("[eval]", code, false, print === true, false);
    } catch (err2) {
      const handled = typeof process._fatalException === "function" ? process._fatalException(err2, false) : false;
      if (!handled) {
        if (completeFatalExit(err2))
          return;
        throw err2;
      }
    }
    await waitForExitSettled();
  }
  async function runMain(path) {
    const mainPath = path.startsWith("/") ? path : vfs.normalize(`${nativesCtx.cwd()}/${path}`);
    process.argv[1] = mainPath;
    const { executeUserEntryPoint } = require2("internal/modules/run_main");
    const fatalRoute = (err2) => {
      const handled = typeof process._fatalException === "function" ? process._fatalException(err2, false) : false;
      if (!handled) {
        if (completeFatalExit(err2))
          return true;
      }
      return handled;
    };
    try {
      const r = executeUserEntryPoint(mainPath);
      if (r !== null && r !== undefined && typeof r.then === "function") {
        await r;
      }
    } catch (err2) {
      if (!fatalRoute(err2))
        throw err2;
    }
    await waitForExitSettled();
  }
  function waitForExitSettled() {
    return new Promise((resolve) => {
      let counter = 0;
      let idleSamples = 0;
      const check = () => {
        counter++;
        drainTicks();
        if (kernelLoopEmpty()) {
          if (++idleSamples >= 2)
            return resolve();
        } else {
          idleSamples = 0;
        }
        if (counter > 50)
          return resolve();
        hostSetTimeout(check, 10);
      };
      hostSetTimeout(check, 10);
    });
  }
  let drainWatcher = null;
  function kernelLoopEmpty() {
    const timersB = natives.get("timers");
    const ttyB = natives.get("tty_wrap");
    const pipeB = natives.get("pipe_wrap");
    const tcpB = natives.get("tcp_wrap");
    const procB = natives.get("process_wrap");
    const pendingTimers = timersB.getActiveTimerCount?.() ?? 0;
    const pendingImmediates = timersB.getActiveImmediateCount?.() ?? 0;
    const stdinReading = ttyB.stdinReading?.() ?? false;
    const openPipes = pipeB.activePipeCount?.() ?? 0;
    const openTcp = tcpB.activeTcpCount?.() ?? 0;
    const liveChildren = procB.activeChildCount?.() ?? 0;
    const pendingNet = netPendingCount();
    const pendingZlib = zlibPendingCount();
    return pendingTimers === 0 && pendingImmediates === 0 && !stdinReading && openPipes === 0 && openTcp === 0 && liveChildren === 0 && pendingNet === 0 && pendingZlib === 0;
  }
  function hasLiveHandles() {
    const pipeB = natives.get("pipe_wrap");
    const tcpB = natives.get("tcp_wrap");
    const procB = natives.get("process_wrap");
    const ttyB = natives.get("tty_wrap");
    return (pipeB.activePipeCount?.() ?? 0) > 0 || (tcpB.activeTcpCount?.() ?? 0) > 0 || (procB.activeChildCount?.() ?? 0) > 0 || (ttyB.stdinReading?.() ?? false) || netPendingCount() > 0 || zlibPendingCount() > 0;
  }
  function raiseSignal(sig) {
    try {
      if (typeof process.listenerCount === "function" && process.listenerCount(sig) > 0) {
        process.emit(sig, sig);
        return true;
      }
      const code = sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143;
      process.exitCode = code;
      process.reallyExit?.(code);
      return false;
    } catch (e) {
      globalThis.__ocDebugHook?.(`[signal ${sig} error] ${String(e)}`);
      return false;
    }
  }
  function startLoopDrainWatcher() {
    if (drainWatcher !== null)
      return;
    let emptyTicks = 0;
    drainWatcher = hostSetInterval(() => {
      drainTicks();
      if (process._exiting) {
        stopLoopDrainWatcher();
        return;
      }
      if (kernelLoopEmpty()) {
        emptyTicks++;
        if (emptyTicks >= 2) {
          stopLoopDrainWatcher();
          try {
            process.exit(process.exitCode ?? 0);
          } catch (e) {
            globalThis.__ocDebugHook?.("[loop-drain exit error] " + String(e));
          }
        }
      } else {
        emptyTicks = 0;
      }
    }, 100);
  }
  function stopLoopDrainWatcher() {
    if (drainWatcher !== null) {
      hostClearInterval(drainWatcher);
      drainWatcher = null;
    }
  }
  return {
    process,
    registry: registry3,
    natives,
    vfs,
    runEval,
    runMain,
    require: require2,
    startLoopDrainWatcher,
    stopLoopDrainWatcher,
    raiseSignal,
    hasLiveHandles
  };
}
var EventEmitterLikeProto = {
  on() {
    return this;
  },
  off() {
    return this;
  },
  once() {
    return this;
  },
  emit() {
    return false;
  },
  addListener() {
    return this;
  },
  removeListener() {
    return this;
  },
  removeAllListeners() {
    return this;
  },
  listeners() {
    return [];
  },
  setMaxListeners() {
    return this;
  }
};
function setProto(obj, proto) {
  Object.setPrototypeOf(obj, proto);
}

// src/packages/opencontainer/kernel/worker-entry.ts
init_browser();
var RUNTIME_BASE = "/opencontainer/runtime";
var OPFS_ROOT_DIR = "opencontainer-vfs";
var NativeDecompressionStream = globalThis.DecompressionStream;
globalThis.__ocHostGunzip = async (gz) => {
  if (typeof NativeDecompressionStream === "function") {
    try {
      const stream = new Response(gz).body.pipeThrough(new NativeDecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {}
  }
  return gunzipSync(gz);
};
function post(msg) {
  self.postMessage(msg);
}
var CACHE_NAME = "opencontainer-runtime-v1";
function cacheKeyUrl(file) {
  return `${RUNTIME_BASE}/${file}`;
}
async function readCache(file) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKeyUrl(file));
    if (!hit)
      return null;
    return await hit.arrayBuffer();
  } catch {
    return null;
  }
}
async function writeCache(file, buf) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKeyUrl(file), new Response(buf, {
      headers: { "Content-Type": "application/octet-stream" }
    }));
    try {
      await navigator?.storage?.persist?.();
    } catch {}
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.startsWith("opencontainer-runtime-") && k !== CACHE_NAME) {
          await caches.delete(k);
        }
      }
    } catch {}
  } catch {}
}
async function gunzip2(buf) {
  const ds = globalThis.DecompressionStream;
  if (typeof ds === "function") {
    const stream = new Response(buf).body.pipeThrough(new ds("gzip"));
    return await new Response(stream).arrayBuffer();
  }
  const { gunzipSync: gunzipSync2 } = await Promise.resolve().then(() => (init_browser(), exports_browser));
  return gunzipSync2(new Uint8Array(buf)).buffer;
}
function parseBlob(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12)
    throw new Error("OpenContainer: runtime blob truncated");
  if (bytes[0] !== 79 || bytes[1] !== 67 || bytes[2] !== 82 || bytes[3] !== 84) {
    throw new Error('OpenContainer: runtime blob magic mismatch (not "OCRT")');
  }
  const view = new DataView(buf);
  const version = view.getUint16(4, true);
  if (version !== 1)
    throw new Error(`OpenContainer: unsupported blob version ${version}`);
  const indexLen = view.getUint32(8, true);
  const indexJson = new TextDecoder().decode(bytes.subarray(12, 12 + indexLen));
  const entries = JSON.parse(indexJson);
  return { entries, bodyStart: 12 + indexLen, bytes };
}
var sourceEntries = new Map;
var decodedSources = new Map;
function attachBlob(buf) {
  const { entries, bodyStart, bytes } = parseBlob(buf);
  for (const e of entries) {
    const start = bodyStart + e.o;
    sourceEntries.set(e.p, { view: bytes.subarray(start, start + e.l) });
  }
  return entries.length;
}
var storeDecoder = new TextDecoder;
function makeLazyStore() {
  return {
    get(path) {
      const memo = decodedSources.get(path);
      if (memo !== undefined)
        return memo;
      const rel = path.startsWith(`${VENDOR_ROOT}/`) ? path.slice(VENDOR_ROOT.length + 1) : path;
      const entry = sourceEntries.get(rel);
      if (entry === undefined) {
        if (rel.startsWith("amaro/") && !amaroReady) {
          throw new Error("OpenContainer: TypeScript support is still loading — retry in a moment");
        }
        throw new Error(`OpenContainer: source not preloaded: ${path}`);
      }
      const text = storeDecoder.decode(entry.view);
      decodedSources.set(path, text);
      return text;
    },
    list(prefix) {
      const out = [];
      const p = prefix.startsWith(`${VENDOR_ROOT}/`) ? prefix.slice(VENDOR_ROOT.length + 1) : prefix;
      for (const key of sourceEntries.keys()) {
        if (key.startsWith(p))
          out.push(`${VENDOR_ROOT}/${key}`);
      }
      return out;
    }
  };
}
async function loadBlob(entry, phase, marks) {
  const tStart = performance.now();
  post({ type: "boot-progress", phase: `${phase}:cache`, loaded: 0, total: entry.gzBytes });
  const cached = await readCache(entry.file);
  if (cached) {
    if (marks)
      marks[`${phase}CacheMs`] = Math.round(performance.now() - tStart);
    return cached;
  }
  post({ type: "boot-progress", phase: `${phase}:fetch`, loaded: 0, total: entry.gzBytes });
  const res = await fetch(cacheKeyUrl(entry.file));
  if (!res.ok)
    throw new Error(`runtime blob fetch failed: ${entry.file} (${res.status})`);
  const gz = await res.arrayBuffer();
  const tInflate = performance.now();
  post({ type: "boot-progress", phase: `${phase}:inflate`, loaded: 0, total: entry.rawBytes });
  const raw = await gunzip2(gz);
  if (marks) {
    marks[`${phase}FetchMs`] = Math.round(performance.now() - tStart);
    marks[`${phase}InflateMs`] = Math.round(performance.now() - tInflate);
  }
  writeCache(entry.file, raw);
  return raw;
}
var kernel = null;
var amaroReady = false;
var booting = false;
var earlyMessages = [];
var myStdio = [
  { type: "tty" },
  { type: "tty" },
  { type: "tty" }
];
var deltaQueue = [];
var deltaFlushScheduled = false;
function flushVfsDeltasNow() {
  if (deltaFlushScheduled)
    deltaFlushScheduled = false;
  const ops = deltaQueue;
  deltaQueue = [];
  if (ops.length > 0)
    post({ type: "vfs-delta", ops });
}
globalThis.__ocFlushVfsDeltas = flushVfsDeltasNow;
function wireVfsDeltas() {
  if (!kernel)
    return;
  kernel.vfs.persist = (op) => {
    deltaQueue.push(op);
    if (!deltaFlushScheduled) {
      deltaFlushScheduled = true;
      queueMicrotask(() => {
        deltaFlushScheduled = false;
        const ops = deltaQueue;
        deltaQueue = [];
        if (ops.length > 0)
          post({ type: "vfs-delta", ops });
      });
    }
  };
}
var fsWatchers = new Map;
function rpcReply(msg, fn) {
  try {
    post({ type: "rpc-result", id: msg.id, ok: true, result: fn() });
  } catch (err2) {
    post({
      type: "rpc-result",
      id: msg.id,
      ok: false,
      err: { code: err2?.code ?? "EIO", message: err2?.message ?? String(err2), path: err2?.path }
    });
  }
}
function applyHostFsOp(op) {
  if (!kernel)
    throw new Error("kernel not booted");
  switch (op.type) {
    case "write":
      kernel.vfs.writeFile(op.path, op.data ?? new Uint8Array(0));
      break;
    case "mkdir":
      kernel.vfs.mkdir(op.path, true);
      break;
    case "symlink":
      kernel.vfs.symlink(op.target, op.path);
      break;
    case "unlink":
      kernel.vfs.rm(op.path, { recursive: op.recursive !== false, force: true });
      break;
    case "rename":
      kernel.vfs.rename(op.from, op.to);
      break;
  }
}
async function opfsRoot() {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root)
      return null;
    return await root.getDirectoryHandle(OPFS_ROOT_DIR, { create: true });
  } catch {
    return null;
  }
}
function opfsKey(path) {
  return encodeURIComponent(path);
}
function isEphemeralPath(p) {
  return p.includes("/node_modules/");
}
async function saveTreeToOpfs() {
  if (!kernel)
    return;
  const root = await opfsRoot();
  if (!root)
    return;
  const tree = kernel.vfs.exportTree("/home");
  const eDirs = tree.dirs.filter((p) => !isEphemeralPath(p));
  const eFiles = tree.files.filter(([p]) => !isEphemeralPath(p));
  const eSymlinks = tree.symlinks.filter(([p]) => !isEphemeralPath(p));
  const manifest = {
    savedAt: Date.now(),
    dirs: eDirs,
    symlinks: eSymlinks,
    files: eFiles.map(([p]) => p)
  };
  const mf = await root.getFileHandle("_manifest.json", { create: true });
  const w = await mf.createSyncAccessHandle();
  const mbytes = new TextEncoder().encode(JSON.stringify(manifest));
  w.truncate(0);
  w.write(mbytes, { at: 0 });
  w.flush();
  w.close();
  for (const [p, data] of eFiles) {
    const fh = await root.getFileHandle(opfsKey(p), { create: true });
    const acc = await fh.createSyncAccessHandle();
    acc.truncate(0);
    acc.write(data, { at: 0 });
    acc.flush();
    acc.close();
  }
  const live = new Set(eFiles.map(([p]) => opfsKey(p)));
  for await (const [name] of root.entries()) {
    if (name.startsWith("_"))
      continue;
    if (!live.has(name)) {
      try {
        await root.removeEntry(name);
      } catch {}
    }
  }
}
async function loadTreeFromOpfs() {
  const root = await opfsRoot();
  if (!root)
    return null;
  let manifest = null;
  try {
    const mf = await root.getFileHandle("_manifest.json");
    const file = await mf.getFile();
    manifest = JSON.parse(await file.text());
  } catch {
    return null;
  }
  const dirs = (manifest.dirs ?? []).filter((p) => !isEphemeralPath(p));
  const symlinks = (manifest.symlinks ?? []).filter(([p]) => !isEphemeralPath(p));
  const files = [];
  for (const p of manifest.files ?? []) {
    if (isEphemeralPath(p))
      continue;
    try {
      const fh = await root.getFileHandle(opfsKey(p));
      const file = await fh.getFile();
      files.push([p, new Uint8Array(await file.arrayBuffer())]);
    } catch {}
  }
  return { dirs, files, symlinks };
}
async function boot(msg) {
  const t0 = performance.now();
  const marks = {};
  const lap = (key) => {
    marks[key] = Math.round(performance.now() - t0);
  };
  post({ type: "boot-progress", phase: "index", loaded: 0, total: 0 });
  let index = msg.runtimeIndex ?? null;
  if (!index) {
    const indexRes = await fetch(`${RUNTIME_BASE}/index.json`, { cache: "no-cache" });
    if (!indexRes.ok)
      throw new Error(`runtime index fetch failed (${indexRes.status})`);
    index = await indexRes.json();
  }
  lap("indexMs");
  const coreBuf = await loadBlob(index.core, "core", marks);
  lap("coreTotalMs");
  post({ type: "boot-progress", phase: "core:decode", loaded: 0, total: index.core.rawBytes });
  const count = attachBlob(coreBuf);
  lap("decodeMs");
  loadBlob(index.amaro, "amaro").then((amaroBuf) => {
    attachBlob(amaroBuf);
    amaroReady = true;
    post({ type: "amaro-ready" });
  }).catch((e) => {
    post({ type: "error", message: `amaro (TypeScript) bundle unavailable: ${e?.message ?? e}` });
  });
  post({ type: "boot-progress", phase: "bootstrap", loaded: 0, total: count });
  myStdio = msg.stdio ?? myStdio;
  let opfsTree = msg.hydrate ?? null;
  let hydratedFrom = msg.hydrate ? "host-snapshot" : "none";
  if (!opfsTree) {
    const loaded = await loadTreeFromOpfs();
    if (loaded && (loaded.files.length > 0 || loaded.dirs.length > 0)) {
      opfsTree = loaded;
      hydratedFrom = "opfs";
      lap("opfsLoadMs");
    }
  }
  const pid = msg.pid ?? 1;
  globalThis.__ocPidBase = pid * 1000 + 1;
  globalThis.__ocPipeIdBase = pid * 1e4 + 1;
  globalThis.__ocConnIdBase = pid * 1e5 + 1;
  kernel = await bootKernel({
    store: makeLazyStore(),
    hydrate: opfsTree ?? undefined,
    pid,
    ppid: msg.ppid ?? 0,
    stdio: myStdio,
    cwd: msg.cwd,
    env: msg.env,
    argv: msg.argv,
    hooks: {
      esmServing: {
        async publish(nonce, entries) {
          const flat = [];
          for (const [p, text] of entries)
            flat.push([p, text]);
          const res = await fetch("/oc-esm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nonce, entries: flat })
          });
          if (!res.ok) {
            throw new Error(`OpenContainer: ESM graph publish failed (${res.status})`);
          }
        },
        prefix(nonce) {
          return `/oc-esm/${nonce}`;
        }
      },
      onExit(code, signal) {
        post({ type: "exit", code, signal: signal ?? null });
      },
      onStdio(fd2, chunk) {
        const mode = myStdio[fd2];
        if (mode && mode.type === "pipe" && mode.pipeId !== undefined) {
          const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
          post({ type: "stdio", fd: fd2, pipeId: mode.pipeId, bytes });
        } else {
          const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
          post({ type: "stdio", fd: fd2, chunk: text });
        }
      },
      now: () => Date.now(),
      env: () => ({
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/home/node",
        LANG: "en_US.UTF-8",
        TERM: "xterm-256color",
        NODE_REPL_HISTORY: "/home/node/.node_repl_history",
        ...msg.env ?? {}
      }),
      initialCwd: msg.cwd ?? "/home/project",
      onChildSpawn: (req) => post({ type: "child-spawn", req }),
      onChildKill: (childPid, signal) => post({ type: "child-kill", pid: childPid, signal }),
      onPipeWrite: (pipeId, chunk) => post({ type: "pipe-write", pipeId, bytes: chunk }),
      onPipeClose: (pipeId, reason) => post({ type: "pipe-close", pipeId, reason }),
      onTcpListen: (info) => post({ type: "tcp-listen", ...info }),
      onTcpUnlisten: (listenId, port) => post({ type: "tcp-unlisten", listenId, port }),
      onTcpConnect: (info) => post({ type: "tcp-connect", ...info }),
      onTcpWrite: (connId, chunk) => post({ type: "tcp-write", connId, bytes: chunk }),
      onTcpClose: (connId) => post({ type: "tcp-close", connId }),
      onTcpShutdown: (connId) => post({ type: "tcp-shutdown", connId })
    }
  });
  lap("bootstrapMs");
  {
    const entryPath = msg.entry?.path ?? "";
    const argv0 = String(msg.argv?.[1] ?? "");
    const needsPkg = (root) => entryPath.startsWith(`/usr/local/bin/${root}`) || entryPath.startsWith(`/usr/lib/node_modules/${root}`) || argv0.startsWith(`/usr/local/bin/${root}`) || argv0.startsWith(`/usr/lib/node_modules/${root}`);
    if (index.npm && (needsPkg("npm") || needsPkg("npx"))) {
      const npmBuf = await loadBlob(index.npm, "npm");
      const mounted = mountCliTree(npmBuf, "/usr/lib/node_modules/npm");
      lap("npmMountMs");
      post({ type: "boot-progress", phase: "npm:mount", loaded: mounted, total: mounted });
    }
    if (index.pnpm && (needsPkg("pnpm") || needsPkg("pnpx"))) {
      const pnpmBuf = await loadBlob(index.pnpm, "pnpm");
      const mounted = mountCliTree(pnpmBuf, "/usr/lib/node_modules/pnpm");
      lap("pnpmMountMs");
      post({ type: "boot-progress", phase: "pnpm:mount", loaded: mounted, total: mounted });
    }
  }
  wireVfsDeltas();
  globalThis.__oc = globalThis.__oc ?? {};
  globalThis.__oc.kernel = kernel;
  self.addEventListener("unhandledrejection", (ev) => {
    const cb = globalThis.__ocGetPromiseRejectCallback?.();
    if (typeof cb === "function") {
      try {
        ev?.preventDefault?.();
      } catch {}
      cb(0, ev.promise, ev.reason);
    }
  });
  post({
    type: "ready",
    nodeVersion: kernel.process.version,
    modules: count,
    bootMs: Math.round(performance.now() - t0),
    phases: marks,
    hydratedFrom,
    vfsSnapshot: hydratedFrom === "opfs" ? opfsTree : undefined,
    pid
  });
  if (Array.isArray(msg.initialPorts) && msg.initialPorts.length > 0) {
    const tcpB = kernel.natives.get("tcp_wrap");
    tcpB.setPortsInUse(msg.initialPorts);
  }
  const entry = msg.entry ?? null;
  if (entry)
    await runEntry(entry);
}
function mountCliTree(buf, root) {
  if (!kernel)
    return 0;
  const { entries, bodyStart, bytes } = parseBlob(buf);
  const decoder = new TextDecoder;
  kernel.vfs.mkdir(root, true);
  let n = 0;
  for (const e of entries) {
    const dest = `${root}/${e.p}`;
    kernel.vfs.mkdir(dest.slice(0, dest.lastIndexOf("/")), true);
    kernel.vfs.writeFile(dest, decoder.decode(bytes.subarray(bodyStart + e.o, bodyStart + e.o + e.l)));
    n++;
  }
  return n;
}
function drainTicks() {
  try {
    globalThis.__ocDrainTicks?.();
  } catch {}
}
async function runEntry(entry) {
  if (!kernel)
    throw new Error("kernel not booted");
  try {
    switch (entry.type) {
      case "version":
        kernel.process.stdout.write(`v${kernel.process.versions.node}
`);
        break;
      case "eval":
        await kernel.runEval(entry.code ?? "", entry.print === true);
        break;
      case "repl":
        kernel.require("internal/main/repl");
        break;
      case "main":
        await kernel.runMain(entry.path ?? "/home/project/index.js");
        break;
    }
  } catch (err2) {
    post({ type: "error", message: err2?.message ?? String(err2), stack: err2?.stack });
    try {
      kernel.process.reallyExit?.(1);
    } catch {}
    return;
  }
  kernel.startLoopDrainWatcher();
}
function startRepl() {
  if (!kernel)
    throw new Error("kernel not booted");
  kernel.require("internal/main/repl");
}
var booted = false;
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (booting && msg.type !== "boot") {
    earlyMessages.push(msg);
    return;
  }
  try {
    switch (msg.type) {
      case "boot": {
        if (!kernel) {
          booted = true;
          booting = true;
          try {
            await boot(msg);
          } finally {
            booting = false;
            const queued = earlyMessages;
            earlyMessages = [];
            for (const m of queued) {
              self.onmessage({ data: m });
            }
          }
        }
        post({ type: "boot-done", id: msg.id });
        break;
      }
      case "eval": {
        if (!kernel)
          throw new Error("kernel not booted");
        await kernel.runEval(String(msg.code ?? ""));
        kernel.startLoopDrainWatcher();
        post({ type: "eval-done", id: msg.id });
        break;
      }
      case "run-main": {
        if (!kernel)
          throw new Error("kernel not booted");
        await kernel.runMain(msg.path ?? "/home/project/index.js");
        kernel.startLoopDrainWatcher();
        post({ type: "eval-done", id: msg.id });
        break;
      }
      case "stdin": {
        if (!kernel)
          break;
        {
          const mode = myStdio[0];
          if (mode && mode.type === "pipe" && mode.pipeId !== undefined) {
            const pipeB = kernel.natives.get("pipe_wrap");
            const bytes = typeof msg.data === "string" ? new TextEncoder().encode(msg.data) : msg.bytes ?? new Uint8Array;
            pipeB.deliverPipeData(mode.pipeId, bytes);
          } else {
            const tty = kernel.natives.get("tty_wrap");
            tty.feedStdin(msg.data ?? "");
          }
          drainTicks();
        }
        break;
      }
      case "stdin-eof": {
        if (!kernel)
          break;
        const mode = myStdio[0];
        if (mode && mode.type === "pipe" && mode.pipeId !== undefined) {
          const pipeB = kernel.natives.get("pipe_wrap");
          pipeB.deliverPipeEof(mode.pipeId);
        } else {
          const tty = kernel.natives.get("tty_wrap");
          tty.sendStdinEof();
        }
        break;
      }
      case "signal": {
        if (!kernel)
          break;
        kernel.raiseSignal(msg.sig ?? "SIGINT");
        drainTicks();
        break;
      }
      case "resize": {
        if (!kernel)
          break;
        globalThis.__oc.terminalSize = { cols: msg.cols ?? 80, rows: msg.rows ?? 24 };
        try {
          kernel.process.stdout?._refreshSize?.();
          kernel.process.stderr?._refreshSize?.();
          kernel.process.stdin?._refreshSize?.();
        } catch {}
        post({ type: "resized", id: msg.id });
        break;
      }
      case "pipe-data": {
        if (!kernel)
          break;
        const pipeB = kernel.natives.get("pipe_wrap");
        pipeB.deliverPipeData(msg.pipeId ?? -1, msg.bytes ?? new Uint8Array);
        drainTicks();
        break;
      }
      case "pipe-eof": {
        if (!kernel)
          break;
        const pipeB = kernel.natives.get("pipe_wrap");
        pipeB.deliverPipeEof(msg.pipeId ?? -1);
        break;
      }
      case "child-exit": {
        if (!kernel)
          break;
        const procB = kernel.natives.get("process_wrap");
        procB.notifyChildExit(msg.pid ?? -1, msg.code ?? 0, msg.signal ?? null);
        drainTicks();
        break;
      }
      case "tcp-connect": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        const ok = tcpB.acceptConnection(msg.port ?? 0, msg.connId ?? 0, msg.remotePort ?? 0);
        if (!ok) {
          post({ type: "tcp-unaccepted", connId: msg.connId });
          break;
        }
        if (msg.bytes && msg.bytes.byteLength > 0) {
          tcpB.deliverTcpData(msg.connId ?? 0, new Uint8Array(msg.bytes));
        }
        drainTicks();
        break;
      }
      case "tcp-data": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.deliverTcpData(msg.connId ?? -1, msg.bytes ?? new Uint8Array);
        drainTicks();
        break;
      }
      case "tcp-eof": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.deliverTcpEof(msg.connId ?? -1);
        break;
      }
      case "tcp-connected": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.__connectComplete(msg.reqId ?? -1, msg.status ?? 0);
        drainTicks();
        break;
      }
      case "tcp-connect-failed": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.__connectComplete(msg.reqId ?? -1, msg.status ?? -111);
        break;
      }
      case "ports-update": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.setPortsInUse(msg.ports ?? []);
        break;
      }
      case "listen-failed": {
        if (!kernel)
          break;
        const tcpB = kernel.natives.get("tcp_wrap");
        tcpB.__listenFailed(msg.listenId ?? -1);
        break;
      }
      case "vfs-apply": {
        if (!kernel)
          break;
        kernel.vfs.applyExternalOps(msg.ops ?? []);
        break;
      }
      case "write-file": {
        if (!kernel)
          throw new Error("kernel not booted");
        kernel.vfs.writeFile(msg.path ?? "/home/project/file.js", msg.content ?? "");
        post({ type: "write-file-done", id: msg.id });
        break;
      }
      case "persist-vfs": {
        await saveTreeToOpfs();
        post({ type: "persist-vfs-done", id: msg.id });
        break;
      }
      case "fs-read": {
        if (!kernel)
          throw new Error("kernel not booted");
        rpcReply(msg, () => ({ data: kernel.vfs.readFile(String(msg.path)) }));
        break;
      }
      case "fs-readdir": {
        if (!kernel)
          throw new Error("kernel not booted");
        rpcReply(msg, () => {
          const p = String(msg.path);
          const out = [];
          for (const e of kernel.vfs.dirents(p)) {
            const kind = e.type === 16384 ? "dir" : e.type === 40960 ? "symlink" : "file";
            let size = 0;
            let mtimeMs = 0;
            if (kind !== "dir") {
              try {
                const st = kernel.vfs.stat(p === "/" ? `/${e.name}` : `${p}/${e.name}`);
                size = Number(st.size ?? 0);
                mtimeMs = Number(st.mtimeMs ?? 0);
              } catch {}
            }
            out.push({ name: e.name, kind, size, mtimeMs });
          }
          return { entries: out };
        });
        break;
      }
      case "fs-stat": {
        if (!kernel)
          throw new Error("kernel not booted");
        rpcReply(msg, () => {
          try {
            const st = kernel.vfs.lstat(String(msg.path));
            return {
              stat: {
                kind: (st.mode & 61440) === 16384 ? "dir" : (st.mode & 61440) === 40960 ? "symlink" : "file",
                size: Number(st.size ?? 0),
                mtimeMs: Number(st.mtimeMs ?? 0),
                mode: Number(st.mode ?? 0)
              }
            };
          } catch {
            return { stat: null };
          }
        });
        break;
      }
      case "fs-apply-ops": {
        if (!kernel)
          throw new Error("kernel not booted");
        rpcReply(msg, () => {
          for (const op of msg.ops ?? [])
            applyHostFsOp(op);
          return {};
        });
        break;
      }
      case "fs-watch": {
        if (!kernel)
          throw new Error("kernel not booted");
        const watchId = msg.watchId;
        if (watchId === undefined || watchId === null) {
          post({ type: "rpc-result", id: msg.id, ok: false, err: { code: "EINVAL", message: "fs-watch: watchId required" } });
          break;
        }
        const w = kernel.vfs.watch(String(msg.path), (event) => {
          post({ type: "fs-event", watchId, event });
        });
        fsWatchers.set(watchId, w);
        post({ type: "rpc-result", id: msg.id, ok: true, result: {} });
        break;
      }
      case "fs-unwatch": {
        const w = fsWatchers.get(msg.watchId);
        if (w) {
          w.close();
          fsWatchers.delete(msg.watchId);
        }
        post({ type: "rpc-result", id: msg.id, ok: true, result: {} });
        break;
      }
      case "fs-tree": {
        if (!kernel)
          throw new Error("kernel not booted");
        rpcReply(msg, () => ({ tree: kernel.vfs.exportTree(String(msg.dir ?? "/")) }));
        break;
      }
      case "diag": {
        if (!kernel)
          throw new Error("kernel not booted");
        const t0 = performance.now();
        const tree = kernel.vfs.exportTree("/");
        let vfsBytes = 0;
        for (const [, d] of tree.files)
          vfsBytes += d.byteLength;
        let storage = null;
        try {
          storage = await navigator?.storage?.estimate?.();
        } catch {}
        post({
          type: "rpc-result",
          id: msg.id,
          ok: true,
          result: {
            fileCount: tree.files.length,
            dirCount: tree.dirs.length,
            symlinkCount: tree.symlinks.length,
            vfsBytes,
            treeWalkMs: Math.round(performance.now() - t0),
            storage,
            moduleCount: kernel.moduleCount ?? null,
            pid: kernel.process.pid ?? null
          }
        });
        break;
      }
      case "spawn": {
        if (!kernel)
          throw new Error("kernel not booted");
        const cmd = msg.cmd ?? "";
        const args = msg.args ?? [];
        const NPM_OC_CLI = "/usr/local/bin/npm";
        const PNPM_OC_CLI = "/usr/local/bin/pnpm";
        if (cmd === "node") {
          const first = args[0] ?? "";
          if (args.length === 0 || first === "-i" || first === "--interactive") {
            startRepl();
            kernel.startLoopDrainWatcher();
            post({ type: "spawn-done", id: msg.id });
            break;
          }
          if (first === "-v" || first === "--version") {
            kernel.process.stdout.write(`v${kernel.process.versions.node}
`);
            kernel.startLoopDrainWatcher();
            post({ type: "spawn-done", id: msg.id });
            break;
          }
          if (first === "-e" || first === "--eval") {
            kernel.process.argv = ["/usr/local/bin/node", ...args.slice(2)];
            await kernel.runEval(args[1] ?? "");
            kernel.startLoopDrainWatcher();
            post({ type: "spawn-done", id: msg.id });
            break;
          }
          if (first === "-p" || first === "--print") {
            kernel.process.argv = ["/usr/local/bin/node", ...args.slice(2)];
            await kernel.runEval(args[1] ?? "", true);
            kernel.startLoopDrainWatcher();
            post({ type: "spawn-done", id: msg.id });
            break;
          }
          await kernel.runMain(first);
          kernel.startLoopDrainWatcher();
          post({ type: "spawn-done", id: msg.id });
          break;
        }
        if (cmd === "npm" || cmd === "pnpm") {
          const cli = cmd === "npm" ? NPM_OC_CLI : PNPM_OC_CLI;
          kernel.process.argv = ["/usr/local/bin/node", cli, ...args];
          await kernel.runMain(cli);
          kernel.startLoopDrainWatcher();
          post({ type: "spawn-done", id: msg.id });
          break;
        }
        post({
          type: "error",
          id: msg.id,
          message: `OpenContainer: legacy in-process spawn supports node/npm/pnpm only (got '${cmd}')`
        });
        post({ type: "spawn-done", id: msg.id });
        break;
      }
      default:
        post({ type: "error", id: msg.id, message: `unknown RPC: ${msg.type}` });
    }
  } catch (err2) {
    post({
      type: "error",
      id: msg.id,
      message: err2?.message ?? String(err2),
      stack: err2?.stack
    });
    if (msg.id !== undefined && msg.type !== "boot")
      post({ type: "eval-done", id: msg.id });
  } finally {
    drainTicks();
  }
};
