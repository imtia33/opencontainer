/**
 * OpenContainer — assembled Node compat prelude.
 * Concatenates all prelude parts in dependency order.
 */
import { PRELUDE_BASE } from '../node-std/prelude-base';
import { PRELUDE_GLOBAL } from '../node-std/prelude-global';
import { PRELUDE_BUFFER } from '../node-std/prelude-buffer';
import { PRELUDE_STREAM } from '../node-std/prelude-stream';
import { PRELUDE_FS } from '../node-std/prelude-fs';
import { PRELUDE_NET } from '../node-std/prelude-net';
import { PRELUDE_CHILD } from '../node-std/prelude-child';
import { PRELUDE_MAIN } from '../node-std/prelude-main';

export const FULL_PRELUDE = [
  PRELUDE_BASE,
  PRELUDE_GLOBAL,
  PRELUDE_BUFFER,
  PRELUDE_STREAM,
  PRELUDE_FS,
  PRELUDE_NET,
  PRELUDE_CHILD,
  PRELUDE_MAIN,
].join('\n;\n');
