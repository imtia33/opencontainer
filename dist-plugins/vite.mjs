// src/packages/opencontainer/vite-plugin.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = "/home/z/my-project/opencontainer/src/packages/opencontainer";
var HERE = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
function swSource() {
  const candidates = [
    join(HERE, "..", "..", "public", "opencontainer", "preview-sw.js"),
    join(HERE, "..", "public", "opencontainer", "preview-sw.js"),
    join(HERE, "public", "opencontainer", "preview-sw.js")
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {}
  }
  throw new Error("[opencontainer/vite] preview-sw.js not found — the plugin must run from " + "an installed opencontainer package (public/opencontainer/preview-sw.js).");
}
function opencontainer() {
  let cachedSw = null;
  const getSw = () => cachedSw ??= swSource();
  return {
    name: "opencontainer",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use("/preview-sw.js", (_req, res, next) => {
        try {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(getSw());
        } catch (err) {
          next(err);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/preview-sw.js", (_req, res, next) => {
        try {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(getSw());
        } catch (err) {
          next(err);
        }
      });
    },
    generateBundle(_options, bundle) {
      bundle["preview-sw.js"] = {
        type: "asset",
        name: "preview-sw.js",
        fileName: "preview-sw.js",
        source: getSw()
      };
    }
  };
}
export {
  opencontainer as default
};
