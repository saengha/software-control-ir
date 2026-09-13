import { describe, expect, it } from "vitest";
import { runDefaultBench, Session, SlidesAdapter } from "../src/index.js";

describe("first measurements", () => {
  it("lets a structured script meet the board-title goal without rejected actions", () => {
    const report = runDefaultBench();
    expect(report.boardTitle.structured.metrics.goal).toBe(true);
    expect(report.boardTitle.structured.metrics.rejected).toBe(0);
    expect(report.boardTitle.structured.metrics.accepted).toBeGreaterThan(0);
  });

  it("records invalid guesses from a naive script on the same task", () => {
    const report = runDefaultBench();
    expect(report.boardTitle.naive.metrics.rejected).toBeGreaterThan(0);
    expect(report.boardTitle.naive.checks.some((check) => check.id === "has_title" && check.ok)).toBe(true);
  });

  it("restores the previous title through an explicit rollback", () => {
    const report = runDefaultBench();
    expect(report.recoverTitle.metrics.goal).toBe(true);
    expect(report.recoverTitle.metrics.revisions).toBe(1);
  });

  it("counts rejected actions in session metrics", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_fill", target: "logo_01", value: "#ff0000" });
    session.apply({ action: "set_text", target: "title_01", value: "Ok" });
    expect(session.metrics()).toMatchObject({ attempts: 2, accepted: 1, rejected: 1, revisions: 1 });
  });

  it("leaves no changes behind when a batch aborts", () => {
    const report = runDefaultBench();
    expect(report.atomicBatch.status).toBe("rejected");
    expect(report.atomicBatch.rolledBack).toBe(true);
    expect(report.atomicBatch.metrics.goal).toBe(true);
    expect(report.atomicBatch.metrics.revisions).toBe(0);
  });

  it("shows the relevant slice is a fraction of a full deck", () => {
    const report = runDefaultBench();
    expect(report.stateSize.full.objects).toBeGreaterThan(40);
    expect(report.stateSize.relevant.objects).toBe(6);
    expect(report.stateSize.savedTokens).toBeGreaterThan(0);
    expect(report.stateSize.relevantShare).toBeLessThan(0.25);
  });

  it("measures both representations of one state", () => {
    const session = new Session(new SlidesAdapter({ preset: "deck" }));
    const size = session.size();
    expect(size.relevant.approxTokens).toBeLessThan(size.full.approxTokens);
    expect(size.full.objects).toBe(48);
  });
});
