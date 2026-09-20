"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { subscribeToIdTokenChanges, signInWithGoogle, signInWithEmail, createClientWithEmail } from "../auth-client";
import { registerShopperAccount } from "../client-account";
import { courseApi, courseError } from "./course-client";
export type CourseSession = {uid: string; role: string; canApply: boolean};
const registrations = new Map<string, Promise<unknown>>();
export function CourseSessionGate({children}: {children: (session: CourseSession) => ReactNode}) {
  const [session, setSession] = useState<CourseSession | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [create, setCreate] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToIdTokenChanges(user => {
      const ticket = ++generation.current; setSession(null); setLoading(true); setError("");
      if (!user) {setLoading(false); return;}
      void (async () => {
        const token = await user.getIdTokenResult();
        if (!token.claims.role) {
          let registration = registrations.get(user.uid);
          if (!registration) {registration = registerShopperAccount(); registrations.set(user.uid, registration);}
          await registration; await user.getIdToken(true);
        }
        const resolved = await courseApi.session({});
        if (active && ticket === generation.current) setSession(resolved);
      })().catch(e => {if (active && ticket === generation.current) setError(courseError(e));}).finally(() => {if (active && ticket === generation.current) setLoading(false);});
    });
    return () => {active = false; generation.current++; unsubscribe();};
  }, []);
  async function signIn(action: () => Promise<unknown>) {setBusy(true); setError(""); try {await action();} catch {setError("Sign-in could not be completed. Check your details and try again.");} finally {setBusy(false);}}
  if (loading) return <div className="course-loading" role="status">Loading your course access…</div>;
  if (session) return <div key={session.uid}>{children(session)}</div>;
  return <section className="course-signin"><h2>Sign in to enrol</h2><p>Use your existing BPT account or create an account. A regular membership is not required.</p>{error && <p role="alert" className="course-error">{error}</p>}<button className="course-button" disabled={busy} onClick={() => void signIn(signInWithGoogle)}>Continue with Google</button><form onSubmit={event => {event.preventDefault(); const data = new FormData(event.currentTarget); void signIn(() => create ? createClientWithEmail(String(data.get("email")), String(data.get("password"))) : signInWithEmail(String(data.get("email")), String(data.get("password"))));}}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete={create ? "new-password" : "current-password"} minLength={6} required /></label><button className="course-button" disabled={busy}>{busy ? "Please wait…" : create ? "Create account" : "Sign in"}</button></form><button className="course-link" type="button" onClick={() => setCreate(v => !v)}>{create ? "Use an existing account" : "Create a new account"}</button><a href="/login/recover">Recover access</a></section>;
}
