import { browserAdminCallableOptions } from "../auth/callable-options.js";

export const scheduleCallableOptions = Object.freeze({
  ...browserAdminCallableOptions,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
});
