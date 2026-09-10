/**
 * The academy that the public surfaces read when nobody is signed in. Every authenticated surface
 * uses the academy in the ID token claim instead and never this value, so it only ever selects
 * which published catalogue an anonymous visitor sees. The platform serves one academy by design.
 */
export const publicAcademyId = process.env.NEXT_PUBLIC_ACADEMY_ID?.trim() || "demo-academy";
