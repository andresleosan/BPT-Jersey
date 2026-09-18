# Coach access with numeric IDs

Coaches use `/staff/login`, shared with administrators. Staff can enter their six-digit ID or their existing email address. Member registration is unchanged.

Numeric credentials are verified by `signInStaffWithId`, which issues a Firebase custom token for the existing coach UID. The server checks the Firebase user, academy claim, coach role, canonical staff user and active staff profile before issuing a token. App Check is required. Attempts are limited by ID and source IP. Passwords use salted scrypt with N=32768, r=8, p=3; the client cannot read credential or rate-limit documents under the existing deny-by-default Firestore rules.

`/coach/access` links Google to the current Firebase user rather than creating a second profile. A Google account already owned by another profile is refused; no automatic account merge occurs. The numeric ID remains usable after linking. Coaches can change their staff password with their current password. Forgotten numeric passwords require office assistance; the email reset flow does not reset numeric credentials.

## Production setup

Deploy `signInStaffWithId` and `changeStaffIdPassword`. The runtime service account requires `iam.serviceAccounts.signBlob` on itself to issue custom tokens. Provision that permission separately with explicit operator approval; do not grant broader project permissions or disable App Check to work around a missing permission.

The five landing profiles use their existing trainer IDs as staff IDs and Auth UIDs, preserving session references. No administrative role or delegated financial permission is granted.

After building functions, run `node scripts/provision-landing-coaches.mjs` for a read-only collision check. To create the accounts, provide a private directory outside the checkout via `BPT_COACH_HANDOFF_DIR` and pass `--apply`. Passwords and the resumable receipt are written there with mode 0600, never to stdout or Git. A completed receipt prevents subsequent runs from resetting passwords or reactivating accounts. Give each coach only their own credentials.

## Verification

Unit tests cover numeric sign-in, wrong credentials, disabled accounts, wrong roles and academies, rate limits, password changes and Google account collisions. The Firebase emulator integration test verifies that numeric sign-in, Google linking and subsequent sign-in through both methods preserve one UID and the coach claim. Production Google linking must be performed by each coach with their own Google account.
