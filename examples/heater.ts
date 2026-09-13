import { formatAgentView, LabAdapter, Session } from "../src/index.js";

const session = new Session(new LabAdapter());

console.log("=== agent view ===");
console.log(formatAgentView(session.snapshot(), session.catalog()));
console.log();

const accepted = session.apply({
  action: "set_temperature",
  target: "heater_01",
  value: 150,
});

console.log("=== accepted action ===");
console.log(JSON.stringify(accepted, null, 2));
console.log();

const rejected = session.apply({
  action: "set_temperature",
  target: "heater_02",
  value: 150,
});

console.log("=== rejected locked target ===");
console.log(JSON.stringify(rejected.issues, null, 2));
console.log("revision still", session.snapshot().revision);
console.log();

const rolled = session.rollback(0);
console.log("=== rollback to revision 0 ===");
console.log("status", rolled.status);
console.log(
  "heater_01",
  session.snapshot().objects.find((object) => object.id === "heater_01")?.properties.temperature,
);
