import { KritaAdapter, Session } from "../src/index.js";

if (!KritaAdapter.available()) {
  console.error("Krita is not installed. Set SCIR_KRITA if it lives somewhere unusual.");
  process.exit(2);
}

const adapter = new KritaAdapter({ seed: true });
try {
  const session = new Session(adapter);
  console.log("=== describe ===");
  console.log(JSON.stringify(session.describe(), null, 2));
  console.log();
  console.log("=== relevant state ===");
  console.log(JSON.stringify(session.relevant(), null, 2));
  console.log();

  const changed = session.apply({ action: "set_opacity", target: "paint_01", value: 40 });
  console.log("=== set_opacity ===");
  console.log(JSON.stringify({ status: changed.status, effects: changed.effects }, null, 2));

  const locked = session.apply({ action: "set_opacity", target: "lock_01", value: 10 });
  console.log("=== locked opacity ===");
  console.log(JSON.stringify({ status: locked.status, issues: locked.issues }, null, 2));

  const undone = session.undo();
  console.log("=== undo ===");
  console.log(
    JSON.stringify(
      {
        status: undone.status,
        recovery: undone.recovery,
        paint: session.snapshot().objects.find((object) => object.id === "paint_01")?.properties.opacity,
      },
      null,
      2,
    ),
  );
} finally {
  adapter.close();
}
