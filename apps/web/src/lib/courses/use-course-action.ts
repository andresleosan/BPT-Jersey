"use client";
import { useRef, useState } from "react";
import { courseError } from "./course-client";
/** Keep a nonce after uncertain failures so a retry cannot duplicate a decision. */
export function useCourseAction() {
  const pending = useRef(false); const nonces = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function run<T>(key: string, action: (requestId: string) => Promise<T>, success: string): Promise<T | undefined> {
    if (pending.current) return undefined;
    const nonce = nonces.current.get(key) ?? crypto.randomUUID(); nonces.current.set(key, nonce);
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {const result = await action(nonce); nonces.current.delete(key); setMessage(success); window.dispatchEvent(new Event("bpt-course-update")); return result;}
    catch(e) {setError(courseError(e)); return undefined;}
    finally {pending.current = false; setBusy(false);}
  }
  return {busy, error, message, run};
}
