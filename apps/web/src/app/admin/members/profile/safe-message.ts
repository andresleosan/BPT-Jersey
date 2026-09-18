import { levelsSafeErrors } from "../../../../lib/levels-client";

/**
 * The clients promise that every rejection carries one of their own fixed strings. This checks it
 * instead of trusting it: a rejection raised anywhere else (a TypeError in a component, a network
 * layer, a future client that forgets) must not reach the operator with its own words in it.
 * Nothing outside `levelsSafeErrors` is ever rendered.
 *
 * T051V2 Task 17: it used to live inside `manage-view.tsx`. The skills assessment needs the same
 * check and is rendered BY the manage view, so importing it from there would close a module cycle.
 * One copy, in a module neither of them owns.
 */
const safeErrors: readonly string[] = Object.values(levelsSafeErrors);

export function safeMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error && safeErrors.includes(failure.message)
    ? failure.message
    : fallback;
}
