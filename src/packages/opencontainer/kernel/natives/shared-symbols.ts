/**
 * Shared private symbols across bindings (single instances, unlike the
 * per-module registries). Used where one binding writes a property that
 * another binding (or node's lib) reads.
 */

const registry = new Map<string, symbol>();

export function sharedSymbol(name: string): symbol {
  let s = registry.get(name);
  if (!s) {
    s = Symbol(name);
    registry.set(name, s);
  }
  return s;
}

export const hostDefinedOptionSymbol = sharedSymbol('nodejs.util.host_defined_options');
export const contextifyContextPrivateSymbol = sharedSymbol('nodejs.contextify.context');
