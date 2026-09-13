import { formatAgentView, Session, SlidesAdapter } from "../src/index.js";

const session = new Session(new SlidesAdapter());

console.log("=== relevant state ===");
console.log(formatAgentView(session.relevant(), session.catalog()));
console.log();

const created = session.apply({
  action: "create_shape",
  kind: "rectangle",
  x: 80,
  y: 220,
  width: 280,
  height: 120,
  text: "New block",
});

console.log("=== create_shape ===");
console.log(JSON.stringify({ status: created.status, effects: created.effects, focus: created.focus }, null, 2));

const locked = session.apply({
  action: "set_fill",
  target: "logo_01",
  value: "#ff0000",
});

console.log("=== locked logo rejected ===");
console.log(locked.issues);
console.log("revision", session.snapshot().revision);
