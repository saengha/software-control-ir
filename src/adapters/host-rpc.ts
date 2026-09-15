import { execFileSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const clientPath = fileURLToPath(new URL("./rpc-client.cjs", import.meta.url));

export function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function freePort(): number {
  const script =
    "const n=require('net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});";
  return Number(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim());
}

export function waitForPort(port: number, timeoutMs: number, child?: ChildProcess) {
  const started = Date.now();
  const script = `
    const net = require("net");
    const sock = net.connect({ port: ${port}, host: "127.0.0.1" });
    sock.on("error", function () { process.exit(1); });
    sock.on("connect", function () { sock.end(); process.exit(0); });
  `;
  while (Date.now() - started < timeoutMs) {
    if (child?.exitCode != null) {
      throw new Error(`PROCESS_ERROR: host exited before listening (code ${child.exitCode})`);
    }
    try {
      execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      sleepSync(200);
    }
  }
  throw new Error(`TIMEOUT: bridge did not listen on 127.0.0.1:${port}`);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill only this PID and its descendants. Never searches by directory or image name. */
export function killProcessTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // already gone
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

interface BridgeReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function rpcJson(port: number, payload: unknown, timeout = 30_000): unknown {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [clientPath, String(port), String(timeout)], {
      encoding: "utf8",
      timeout: timeout + 2_000,
      windowsHide: true,
      input: JSON.stringify(payload) + "\n",
    });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message: string; status?: number | null };
    const detail = (failed.stderr ?? "").trim() || failed.message;
    if ((failed.status ?? 0) === 2 || detail.startsWith("TIMEOUT")) {
      throw new Error(detail.startsWith("TIMEOUT") ? detail : `TIMEOUT: no reply from 127.0.0.1:${port}`);
    }
    if (detail.startsWith("BRIDGE_ERROR") || detail.startsWith("TIMEOUT") || detail.startsWith("PROCESS_ERROR")) {
      throw new Error(detail);
    }
    throw new Error(`BRIDGE_ERROR: ${detail}`);
  }

  const line = stdout.trim().split(/\r?\n/).find((entry) => entry.startsWith("{"));
  if (!line) {
    throw new Error(`BRIDGE_ERROR: empty reply from 127.0.0.1:${port}`);
  }
  const reply = JSON.parse(line) as BridgeReply;
  if (!reply.ok) {
    throw new Error(reply.error ?? "APPLICATION_ERROR: bridge failed");
  }
  return reply.result;
}
