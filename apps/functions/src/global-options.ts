import { setGlobalOptions } from "firebase-functions/v2";

/**
 * Every function runs beside Firestore (europe-west9). Imported first from index.ts: ES imports
 * are hoisted, so this must be its own module or the functions would be defined before it runs.
 * A function that names its own region keeps it.
 */
// Every function loads the whole bundle (~230MiB resident before any request), so 256MiB ran out
// at startup; 512MiB is the floor for all of them.
setGlobalOptions({ region: "europe-west9", memory: "512MiB" });
