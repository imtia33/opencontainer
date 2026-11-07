// Cross-process upgrade probe, part 1: the server (stays alive 25s).
// Run this, then run upgrade-probe-xproc-client.js from another process.
const http = require('http');
const server = http.createServer((req, res) => res.end('plain'));
let upgrades = 0;
server.on('upgrade', (req, socket) => {
  upgrades++;
  console.log('server: upgrade #' + upgrades + ' seen, path=' + req.url);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: dummy\r\n' +
    '\r\n');
  socket.on('data', () => { /* keep open */ });
});
server.listen(5199, () => console.log('server: listening 5199'));
setTimeout(() => { console.log('server: exiting'); process.exit(0); }, 25000);
