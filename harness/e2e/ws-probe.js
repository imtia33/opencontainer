// WS upgrade probe: two sequential raw upgrade handshakes against the guest
// dev server on :5173. Reports the first response line of each.
const net = require('net');
function wsProbe(n, cb) {
  const key = Buffer.from(
    String(Math.random()) + String(Date.now())).toString('base64').slice(0, 24);
  const s = net.connect(5173, '127.0.0.1', () => {
    s.write(
      'GET / HTTP/1.1\r\n' +
      'Host: localhost:5173\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n');
  });
  let buf = '';
  const to = setTimeout(() => {
    console.log('ws ' + n + ': TIMEOUT after "' + buf.slice(0, 40) + '"');
    s.destroy();
    cb();
  }, 5000);
  s.on('data', (d) => {
    buf += d.toString('latin1');
    if (buf.includes('\r\n\r\n')) {
      console.log('ws ' + n + ': ' + buf.split('\r\n')[0]);
      clearTimeout(to);
      s.destroy();
      cb();
    }
  });
  s.on('error', (e) => {
    console.log('ws ' + n + ': ERR ' + e.message);
    clearTimeout(to);
    cb();
  });
}
wsProbe(1, () => wsProbe(2, () => wsProbe(3, () => process.exit(0))));
