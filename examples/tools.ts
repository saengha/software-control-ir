import { createDispatcher, Session, SlidesAdapter, toolDescriptors } from "../src/index.js";

const session = new Session(new SlidesAdapter());
const call = createDispatcher(session);

console.log("=== tools an agent would see ===");
for (const tool of toolDescriptors(session)) {
  const required = tool.inputSchema.required.join(", ") || "-";
  console.log(`${tool.name.padEnd(24)} required: ${required}`);
}
console.log();

console.log("=== describe ===");
console.log(JSON.stringify(call("scir.describe"), null, 2));
console.log();

console.log("=== one operation call, compact result ===");
console.log(JSON.stringify(call("slides.set_text", { target: "title_01", value: "Via transport" }), null, 2));
console.log();

console.log("=== batch that aborts ===");
console.log(
  JSON.stringify(
    call("scir.transaction", {
      actions: [
        { action: "set_fill", target: "accent_01", value: "#2f6f5f" },
        { action: "set_fill", target: "logo_01", value: "#2f6f5f" },
      ],
    }),
    null,
    2,
  ),
);
console.log();

console.log("=== undo ===");
console.log(JSON.stringify(call("scir.undo"), null, 2));
console.log("accent_01 fill", session.snapshot().objects.find((item) => item.id === "accent_01")?.properties.fill);
