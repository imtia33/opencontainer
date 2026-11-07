// Cross-process upgrade probe, part 2: the client. Two sequential raw
// upgrade attempts against :5199 (server runs in ANOTHER process).
const net = require('net');
function probe(n, cb) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ==';
  const s = net.connect(5199, '127.0.0.1', () => {
    s.write(
      'GET / HTTP/1.1\r\n' +
      'Host: localhost:5199\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n');
  });
  let buf = '';
  const to = setTimeout(() => {
    console.log('client ws ' + n + ': TIMEOUT buf="' + buf.slice(0, 30) + '"');
    s.destroy();
    cb();
  }, 4000);
  s.on('data', (d) => {
    buf += d.toString('latin1');
    if (buf.includes('\r\n\r\n')) {
      console.log('client ws ' + n + ': ' + buf.split('\r\n')[0]);
      clearTimeout(to);
      s.destroy();
      cb();
    }
  });
  s.on('error', (e) => {
    console.log('client ws ' + n + ': ERR ' + e.message);
    clearTimeout(to);
    cb();
  });
}
probe(1, () => probe(2, () => process.exit(0)));
