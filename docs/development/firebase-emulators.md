# Firebase Emulator Suite

The local environment uses the demo project `demo-bpt-jersey`. Demo project IDs cannot reach live Firebase resources, which prevents accidental production writes or billing during development.

## Commands

- `corepack pnpm firebase:emulators` starts Auth, Firestore, Realtime Database, and Functions emulators.
- `corepack pnpm firebase:emulators:data` starts the Auth and database emulators without Functions.
- `corepack pnpm test:rules` starts Auth, Firestore, and Realtime Database, runs the Rules suite, and shuts the emulators down.

On restricted Windows environments, set `XDG_CONFIG_HOME` to the repository-local ignored `.firebase-config` directory before invoking Firebase CLI.

The initial Rules posture is intentionally default-deny. Feature tasks must add the smallest required access and prove both allowed and rejected cases before changing these files.
