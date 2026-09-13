import { runDefaultBench } from "../src/bench/report.js";

const report = runDefaultBench();
console.log(JSON.stringify(report, null, 2));
