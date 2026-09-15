import { BlenderAdapter, Session } from "../src/index.js";

if (!BlenderAdapter.available()) {
  console.error("Blender is not installed. Set SCIR_BLENDER if it lives somewhere unusual.");
  process.exit(2);
}

const adapter = new BlenderAdapter({ seed: true });
try {
  const session = new Session(adapter);
  console.log("=== describe ===");
  console.log(JSON.stringify(session.describe(), null, 2));
  console.log();
  console.log("=== relevant state ===");
  console.log(JSON.stringify(session.relevant(), null, 2));
  console.log();

  const changed = session.apply({ action: "set_location", target: "cube_01", x: 1, y: 0, z: 0 });
  console.log("=== set_location ===");
  console.log(JSON.stringify({ status: changed.status, effects: changed.effects }, null, 2));

  const locked = session.apply({ action: "set_location", target: "lock_01", x: 4, y: 0, z: 0 });
  console.log("=== locked location ===");
  console.log(JSON.stringify({ status: locked.status, issues: locked.issues }, null, 2));

  const undone = session.undo();
  console.log("=== undo ===");
  console.log(
    JSON.stringify(
      {
        status: undone.status,
        recovery: undone.recovery,
        cube: session.snapshot().objects.find((object) => object.id === "cube_01")?.properties.location,
      },
      null,
      2,
    ),
  );
} finally {
  adapter.close();
}
