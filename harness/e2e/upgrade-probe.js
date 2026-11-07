// Kernel upgrade-emission probe:
// 1. Start a plain node http server WITH an 'upgrade' handler on :5199.
// 2. From the SAME process, and then from a probe process, send a raw
//    upgrade request. Reports which paths get the 101.
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
  setTimeout(() => socket.destroy(), 500);
});
server.listen(5199, () => {
  console.log('listening 5199');
  // same-process probe
  rawProbe('same-proc', () => {
    console.log('done');
    process.exit(0);
  });
});

function rawProbe(tag, cb) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ=='; // the RFC6455 sample key
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
    console.log(tag + ': TIMEOUT buf="' + buf.slice(0, 30) + '"');
    s.destroy();
    cb();
  }, 4000);
  s.on('data', (d) => {
    buf += d.toString('latin1');
    if (buf.includes('\r\n\r\n')) {
      console.log(tag + ': ' + buf.split('\r\n')[0]);
      clearTimeout(to);
      s.destroy();
      cb();
    }
  });
  s.on('error', (e) => {
    console.log(tag + ': ERR ' + e.message);
    clearTimeout(to);
    cb();
  });
}
