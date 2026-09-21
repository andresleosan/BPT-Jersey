"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getIntroMembershipContext, submitIntroMembershipApplication, uploadIntroMembershipProof, type IntroMembershipContext } from "../../../lib/intro-conversion-client";
import type { PlanId, Site } from "@bpt-jersey/domain/memberships";
import { formatPlanPrice } from "../../../lib/plan-copy";

export function IntroApplicationForm() {
  const [context, setContext] = useState<IntroMembershipContext>(); const [site, setSite] = useState<Site>("Town"); const [planId, setPlanId] = useState<PlanId | "">(""); const [file, setFile] = useState<File>(); const [reference, setReference] = useState(""); const [status, setStatus] = useState<"loading"|"ready"|"busy"|"done"|"error">("loading");
  useEffect(() => { void getIntroMembershipContext().then((value) => { setContext(value); setStatus("ready"); }).catch(() => setStatus("error")); }, []);
  const conversion = context?.conversions.find((item) => item.status === "ready");
  const existing = conversion ? context?.applications.find((item) => item.conversionId === conversion.conversionId) : context?.applications[0];
  const plans = useMemo(() => context?.plans.filter((plan) => plan.classSites.includes(site)) ?? [], [context, site]);
  useEffect(() => { setPlanId((current) => plans.some((plan) => plan.planId === current) ? current : (plans[0]?.planId ?? "")); }, [plans]);
  async function submit(event: FormEvent) { event.preventDefault(); if (!conversion || !file || !planId || !reference.trim()) return; setStatus("busy"); try { const requestId = crypto.randomUUID(); const proofId = await uploadIntroMembershipProof(requestId, file); await submitIntroMembershipApplication({ requestId, conversionId: conversion.conversionId, studentId: conversion.studentId, site, planId, proofId, bankReference: reference.trim() }); setStatus("done"); } catch { setStatus("error"); } }
  if (status === "loading") return <p role="status">Loading membership application...</p>;
  if (existing || status === "done") return <section className="client-trial-form"><h2>Membership pending office approval.</h2><p>Your receipt is private. The office will review the selected plan and payment.</p></section>;
  if (!conversion || !context?.instructions) return <section className="client-trial-form"><h2>Membership application unavailable</h2><p>Complete an Intro Class first or ask the office to review your account.</p></section>;
  return <form className="client-trial-form" onSubmit={(event) => void submit(event)}>
    <h2>Choose your membership</h2>
    <label htmlFor="intro-site">Training centre</label><select id="intro-site" value={site} onChange={(event) => setSite(event.target.value as Site)}><option value="Town">Town</option><option value="West">West</option></select>
    <label htmlFor="intro-plan">Membership plan</label><select id="intro-plan" value={planId} onChange={(event) => setPlanId(event.target.value as PlanId)} required>{plans.map((plan) => <option key={plan.planId} value={plan.planId}>{plan.displayName} — {formatPlanPrice(plan)}</option>)}</select>
    <div className="client-bank-instructions"><strong>{context.instructions.bankName}</strong><span>{context.instructions.accountName}</span><span>Sort code {context.instructions.sortCode}</span><span>Account {context.instructions.accountNumber}</span></div>
    <label htmlFor="intro-reference">Bank transfer reference</label><input id="intro-reference" value={reference} onChange={(event) => setReference(event.target.value)} minLength={2} maxLength={120} required />
    <label htmlFor="intro-proof">Payment screenshot or receipt</label><input id="intro-proof" type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0])} required />
    <button className="button button-primary" disabled={status === "busy" || !planId} type="submit">{status === "busy" ? "Sending..." : "Send for approval"}</button>
    {status === "error" ? <p role="alert">The application could not be sent. Check the details and try again.</p> : null}
  </form>;
}
