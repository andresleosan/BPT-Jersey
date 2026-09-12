"use client";

import { AdminSectionHeader } from "../../admin-ui";
import { MedicalReviewSection } from "./medical-review-section";

import "../../admin.css";

export default function MedicalConditionsRoute() {
  return (
    <section className="admin-module-page" aria-label="Medical conditions">
      <AdminSectionHeader
        description="Declared conditions and the short reference label coaches read on the mat. Health data is only shown to authorised staff and every read is audited."
        eyebrow="People / Medical conditions"
        title="Medical conditions"
      />
      <MedicalReviewSection />
    </section>
  );
}
