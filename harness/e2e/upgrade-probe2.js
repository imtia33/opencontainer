// Same-process, TWO sequential upgrade probes + one plain HTTP between them.
const http = require('http');
const net = require('net');
const server = http.createServer((req, res) => res.end('plain'));
server.on('upgrade', (req, socket) => {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: dummy\r\n' +
    '\r\n');
  socket.on('data', () => { /* keep open */ });
});
function probe(n, cb) {
  const s = net.connect(5199, '127.0.0.1', () => {
    s.write(
      'GET / HTTP/1.1\r\nHost: localhost:5199\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n');
  });
  let buf = '';
  const to = setTimeout(() => {
    console.log('ws ' + n + ': TIMEOUT buf="' + buf.slice(0, 30) + '"');
    s.destroy();
    cb();
  }, 4000);
  s.on('data', (d) => {
    buf += d.toString('latin1');
    if (buf.includes('\r\n\r\n')) {
      console.log('ws ' + n + ': ' + buf.split('\r\n')[0]);
      clearTimeout(to);
      s.destroy(); // abrupt, like a page navigation killing the WS
      cb();
    }
  });
  s.on('error', (e) => { console.log('ws ' + n + ': ERR ' + e.message); clearTimeout(to); cb(); });
}
function plain(n, cb) {
  const req = require('http').get('http://127.0.0.1:5199/?p=' + n, (res) => {
    res.resume();
    res.on('end', () => { console.log('plain ' + n + ': ' + res.statusCode); cb(); });
  });
  req.on('error', (e) => { console.log('plain ' + n + ': ERR ' + e.message); cb(); });
}
server.listen(5199, () => {
  probe(1, () => plain(1, () => probe(2, () => plain(2, () => probe(3, () => process.exit(0))))));
});
