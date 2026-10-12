import type { Logger } from "pino";

import type { Config } from "../config.js";

/** Everything a notification function needs beyond its own arguments. */
export interface NotifyContext {
  config: Config;
  log: Logger;
}
