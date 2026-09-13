import { ImpressAdapter, Session } from "../src/index.js";

if (!ImpressAdapter.available()) {
  console.error("LibreOffice is not installed. Set SCIR_LIBREOFFICE if it lives somewhere unusual.");
  process.exit(2);
}

const adapter = new ImpressAdapter();
try {
  const session = new Session(adapter);
  console.log("=== describe ===");
  console.log(JSON.stringify(session.describe(), null, 2));
  console.log();
  console.log("=== relevant state ===");
  console.log(JSON.stringify(session.relevant(), null, 2));
  console.log();

  const changed = session.apply({ action: "set_text", target: "title_01", value: "From LibreOffice" });
  console.log("=== set_text ===");
  console.log(JSON.stringify({ status: changed.status, effects: changed.effects }, null, 2));

  const locked = session.apply({ action: "set_fill", target: "logo_01", value: "#ff0000" });
  console.log("=== locked fill ===");
  console.log(JSON.stringify({ status: locked.status, issues: locked.issues }, null, 2));

  const undone = session.undo();
  console.log("=== undo ===");
  console.log(
    JSON.stringify(
      {
        status: undone.status,
        recovery: undone.recovery,
        title: session.snapshot().objects.find((object) => object.id === "title_01")?.properties.text,
      },
      null,
      2,
    ),
  );
} finally {
  adapter.close();
}
