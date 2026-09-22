import { setGlobalOptions } from "firebase-functions/v2";

/**
 * Every function runs beside Firestore (europe-west9). Imported first from index.ts: ES imports
 * are hoisted, so this must be its own module or the functions would be defined before it runs.
 * A function that names its own region keeps it.
 */
setGlobalOptions({ region: "europe-west9" });
