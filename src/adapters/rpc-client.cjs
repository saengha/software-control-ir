"use strict";

const net = require("net");

const port = Number(process.argv[2]);
const timeout = Number(process.argv[3] || 30_000);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("BRIDGE_ERROR: rpc-client requires a TCP port\n");
  process.exit(1);
}

const chunks = [];
const timer = setTimeout(() => {
  process.stderr.write(`TIMEOUT: no reply from 127.0.0.1:${port}\n`);
  process.exit(2);
}, timeout);

process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
});

process.stdin.on("end", () => {
  const body = Buffer.concat(chunks);
  const sock = net.connect({ host: "127.0.0.1", port }, () => {
    sock.write(body);
    if (!body.includes(0x0a)) sock.write("\n");
  });
  sock.setTimeout(timeout);
  let out = "";
  sock.on("data", (data) => {
    out += data.toString("utf8");
    const nl = out.indexOf("\n");
    if (nl >= 0) {
      clearTimeout(timer);
      process.stdout.write(out.slice(0, nl + 1));
      sock.end();
      process.exit(0);
    }
  });
  sock.on("timeout", () => {
    process.stderr.write(`TIMEOUT: no reply from 127.0.0.1:${port}\n`);
    process.exit(2);
  });
  sock.on("error", (error) => {
    process.stderr.write(`BRIDGE_ERROR: ${error.message}\n`);
    process.exit(1);
  });
});
