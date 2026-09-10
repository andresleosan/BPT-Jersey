import path from "node:path";

// The Firebase emulators need JDK 21. On Windows the PATH usually resolves to an
// older JRE even when JAVA_HOME points at the right JDK, so every gate that
// starts emulators pins the JDK from JAVA_HOME before spawning the child.
const WINDOWS_JDK21_FALLBACK = "C:/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot";

export function withEmulatorJavaEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  // Firebase CLI can log the complete child environment when DEBUG is inherited.
  delete env.DEBUG;
  if (process.platform !== "win32") {
    return env;
  }
  // resolve() normalizes separators and drops any trailing one, so a JAVA_HOME
  // written with a trailing separator still yields a usable bin directory.
  const javaHome = path.win32.resolve(env.JAVA_HOME?.trim() || WINDOWS_JDK21_FALLBACK);
  env.JAVA_HOME = javaHome;
  env.PATH = [path.win32.join(javaHome, "bin"), env.PATH ?? ""].join(path.win32.delimiter);
  return env;
}
