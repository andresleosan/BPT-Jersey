/**
 * Length is the main defence (12 to 128). These two checks only stop the guessable shortcuts an
 * administrator or a new staff member is most likely to type.
 * ponytail: no breached-password list; add one if staff accounts ever face the public internet.
 */
export function isWeakStaffPassword(password: string, email: string | undefined): boolean {
  if (password.length < 12 || password.length > 128) return true;
  if (new Set(password).size < 4) return true;
  const localPart = email?.split("@")[0]?.toLowerCase() ?? "";
  return localPart.length >= 4 && password.toLowerCase().includes(localPart);
}
