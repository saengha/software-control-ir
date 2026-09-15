import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ImpressAdapter,
  Session,
  copyImpressDocument,
  defaultImpressDocument,
  runConformance,
} from "../src/index.js";

const available = ImpressAdapter.available();
const fixture = existsSync(defaultImpressDocument());
const ready = available && fixture;

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

function leftoverScirOffice(profileHint: string): string[] {
  const needle = profileHint.replace(/'/g, "");
  if (!needle.startsWith("scir-lo-")) return [];
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'soffice' -and $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    return out
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe("LibreOffice Impress fixture", () => {
  it("keeps a committed .odp next to the adapter when LibreOffice is present", () => {
    if (!available) return;
    expect(fixture, "run npm run fixture:impress once to write fixtures/impress/board.odp").toBe(true);
  });
});

describe.skipIf(!ready)("LibreOffice Impress", () => {
  let adapter: ImpressAdapter;

  beforeAll(() => {
    adapter = new ImpressAdapter({ document: copyImpressDocument() });
  }, 90_000);

  afterEach(() => {
    adapter.reset();
  }, 90_000);

  afterAll(() => {
    const needle = path.basename(adapter.profilePath());
    adapter.close();
    expect(leftoverScirOffice(needle)).toEqual([]);
  }, 30_000);

  it("uses a private user profile, not the desktop LibreOffice singleton", () => {
    const isolation = adapter.isolation();
    const user = isolation.user.replace(/\\/g, "/").toLowerCase();
    expect(user).toMatch(/scir-lo-/);
    expect(user).not.toMatch(/appdata\/roaming\/libreoffice/);
  }, 60_000);

  it("reads structured state from the loaded .odp", () => {
    const session = new Session(adapter);
    expect(session.describe().capabilities.snapshotRestore).toBe(true);
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
    expect(object(session, "logo_01")?.properties.locked).toBe(true);
    expect(session.snapshot().meta?.units).toBe("mm");
  }, 60_000);

  it("changes live document text and reports effects", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_text", target: "title_01", value: "From UNO" });
    expect(result.status).toBe("accepted");
    expect(result.effects.some((effect) => effect.path?.includes("text"))).toBe(true);
    expect(object(session, "title_01")?.properties.text).toBe("From UNO");
  }, 60_000);

  it("smoke: set_text is visible in a fresh UNO snapshot, not only in ActionResult", () => {
    const before = adapter.snapshot().objects.find((item) => item.id === "title_01")?.properties.text;
    expect(before).toBe("Quarterly Review");

    const session = new Session(adapter);
    const result = session.apply({ action: "set_text", target: "title_01", value: "Host smoke" });
    expect(result.status).toBe("accepted");

    const host = adapter.snapshot().objects.find((item) => item.id === "title_01")?.properties.text;
    expect(host).toBe("Host smoke");
    expect(host).not.toBe(before);
  }, 60_000);

  it("rejects a fill on a locked shape before UNO mutates", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_fill", target: "logo_01", value: "#ff0000" });
    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(object(session, "logo_01")?.properties.fill?.toString().toLowerCase()).not.toBe("#ff0000");
  }, 60_000);

  it("hides the inactive slide from relevant state", () => {
    const session = new Session(adapter);
    const ids = session.relevant().objects.map((item) => item.id);
    expect(ids).toContain("title_01");
    expect(ids).not.toContain("body_02");
  }, 60_000);

  it("undoes a text change by compensation, not by overwriting the document", () => {
    const session = new Session(adapter);
    session.apply({ action: "set_text", target: "title_01", value: "Board Update" });
    const undone = session.undo();
    expect(undone.status).toBe("accepted");
    expect(undone.recovery).toBe("compensation");
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
  }, 60_000);

  it("restores a snapshot by rewriting the live document from IR state", () => {
    const session = new Session(adapter);
    session.apply({ action: "set_text", target: "title_01", value: "Keep me" });
    const rolled = session.rollback(0);
    expect(rolled.status).toBe("accepted");
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
  }, 60_000);

  it("creates a shape on the live slide", () => {
    const session = new Session(adapter);
    const result = session.apply({
      action: "create_shape",
      params: { kind: "rectangle", x: 40, y: 90, width: 50, height: 20, id: "rect_live" },
    });
    expect(result.status).toBe("accepted");
    expect(object(session, "rect_live")?.parent).toBe("slide_01");
  }, 60_000);

  it("rejects further IR actions when LibreOffice changed out of band", () => {
    const session = new Session(adapter);
    adapter.execute(
      { action: "set_text", target: "title_01", params: { value: "Host edit" } },
      session.snapshot(),
    );

    const blocked = session.apply({ action: "set_fill", target: "accent_01", value: "#2f6f5f" });
    expect(blocked.status).toBe("rejected");
    expect(blocked.issues?.[0]?.code).toBe("host_diverged");
    expect(object(session, "title_01")?.properties.text).toBe("Host edit");
    expect(object(session, "accent_01")?.properties.fill?.toString().toLowerCase()).toBe("#e6a23c");

    const again = session.apply({ action: "set_text", target: "title_01", value: "Nope" });
    expect(again.issues?.[0]?.code).toBe("host_diverged");

    const synced = session.sync();
    expect(synced.status).toBe("accepted");
    const after = session.apply({ action: "set_text", target: "title_01", value: "After sync" });
    expect(after.status).toBe("accepted");
    expect(object(session, "title_01")?.properties.text).toBe("After sync");
  }, 60_000);

  it("rejects undo while the live document has drifted", () => {
    const session = new Session(adapter);
    session.apply({ action: "set_text", target: "title_01", value: "Session edit" });
    adapter.execute(
      { action: "set_text", target: "title_01", params: { value: "Host edit" } },
      session.snapshot(),
    );
    const undone = session.undo();
    expect(undone.status).toBe("rejected");
    expect(undone.issues?.[0]?.code).toBe("host_diverged");
    expect(object(session, "title_01")?.properties.text).toBe("Host edit");
  }, 60_000);
});

describe.skipIf(!ready)("LibreOffice Impress .odp round-trip", () => {
  it("keeps edited text after save, close, and reopen", () => {
    const document = copyImpressDocument();
    const first = new ImpressAdapter({ document });
    const firstProfile = path.basename(first.profilePath());
    try {
      const session = new Session(first);
      const changed = session.apply({ action: "set_text", target: "title_01", value: "Saved to disk" });
      expect(changed.status).toBe("accepted");
      first.save(document);
    } finally {
      first.close();
    }
    expect(leftoverScirOffice(firstProfile)).toEqual([]);

    const second = new ImpressAdapter({ document });
    const secondProfile = path.basename(second.profilePath());
    try {
      const session = new Session(second);
      expect(object(session, "title_01")?.properties.text).toBe("Saved to disk");
    } finally {
      second.close();
    }
    expect(leftoverScirOffice(secondProfile)).toEqual([]);
  }, 180_000);
});

describe.skipIf(!ready)("LibreOffice Impress conformance", () => {
  it("passes the v0 checks against a real .odp", () => {
    const adapter = new ImpressAdapter({ document: copyImpressDocument() });
    try {
      const failed = runConformance(adapter).filter((check) => !check.ok);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    } finally {
      adapter.close();
    }
  }, 180_000);
});
