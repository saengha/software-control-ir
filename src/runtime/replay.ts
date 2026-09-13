import type { Adapter } from "./adapter.js";
import { Session } from "./session.js";
import type { Trace } from "../ir/types.js";

export function replay(createAdapter: () => Adapter, trace: Trace): Session {
  const session = new Session(createAdapter());
  session.applyAll(trace.actions);
  return session;
}
