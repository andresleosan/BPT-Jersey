"use client";

import { useEffect, useState } from "react";

import { ClientAuthGate, ClientAuthProvider } from "../../../lib/client-auth";
import { getFamily, type GuardianFamilyProjection } from "../../../lib/family-client";
import { HealthSupportPanel } from "./health-support-panel";

function FamilyContent() {
  const [family, setFamily] = useState<GuardianFamilyProjection | undefined>();
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let active = true;
    void getFamily()
      .then((result) => {
        if (!active) return;
        if (result === undefined || !("tutor" in result)) {
          setStatus("empty");
          return;
        }
        setFamily(result);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return <main className="client-destination family-client-page" aria-busy="true" />;
  }

  if (status === "error") {
    return (
      <main className="client-destination family-client-page" aria-labelledby="family-title">
        <p className="account-eyebrow">BPT Jersey / Family</p>
        <h1 id="family-title">Your family</h1>
        <p aria-live="assertive" className="family-message family-message-error" role="alert">
          Unable to load your family. Please try again.
        </p>
      </main>
    );
  }

  if (status === "empty" || family === undefined) {
    return (
      <main className="client-destination family-client-page" aria-labelledby="family-title">
        <p className="account-eyebrow">BPT Jersey / Family</p>
        <h1 id="family-title">Your family</h1>
        <p className="family-empty-state">No family has been linked to your account yet.</p>
      </main>
    );
  }

  return (
    <main className="client-destination family-client-page" aria-labelledby="family-title">
      <p className="account-eyebrow">BPT Jersey / Family</p>
      <h1 id="family-title">Your family</h1>
      <p className="client-destination-intro">
        A read-only view of the children connected to your guardian account.
      </p>
      <section className="family-contact-card" aria-labelledby="family-contact-title">
        <p className="account-eyebrow" id="family-contact-title">
          Your contact
        </p>
        <strong>{family.tutor.displayName}</strong>
        <span>{family.tutor.email}</span>
        <span>{family.tutor.phoneNumber}</span>
      </section>
      <section className="family-child-list" aria-labelledby="family-children-title">
        <div className="family-client-heading">
          <p className="account-eyebrow">Linked children</p>
          <h2 id="family-children-title">Training together</h2>
        </div>
        {family.students.map((student, index) => (
          <article className="family-child-card" key={student.studentId}>
            <div>
              <h3>{student.fullName}</h3>
              <p>{student.trainingCenter} training center</p>
            </div>
            <dl>
              <div>
                <dt>Date of birth</dt>
                <dd>{student.dateOfBirth}</dd>
              </div>
              <div>
                <dt>Preferred times</dt>
                <dd>{student.trainingTimePreferences.join(", ")}</dd>
              </div>
            </dl>
            <HealthSupportPanel
              instanceId={"health-support-" + (index + 1)}
              studentId={student.studentId}
              studentName={student.fullName}
            />
          </article>
        ))}
      </section>
    </main>
  );
}

export default function FamilyAccountPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account/family">
        <FamilyContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
