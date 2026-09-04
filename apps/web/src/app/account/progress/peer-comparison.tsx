"use client";

import { useMemo } from "react";
import {
  buildPeerComparison,
  type PeerComparisonResult,
  type PeerComparisonStudent,
} from "@bpt-jersey/domain/levels";
import "./progress.css";

// Sample peers across white and blue belts to contextualize the student in the academy
export const defaultPeerCohort: readonly PeerComparisonStudent[] = [
  {
    studentId: "std-mat-01",
    studentName: "Lucas Silva",
    beltName: "Blue Belt",
    beltColor: "#1d4ed8",
    stripes: 2,
    streakWeeks: 14,
    techniquesLearned: 9,
    totalTechniques: 11,
    sequence: 20,
    classesInRank: 75,
  },
  {
    studentId: "std-mat-02",
    studentName: "Mateo Rossi",
    beltName: "Blue Belt",
    beltColor: "#1d4ed8",
    stripes: 1,
    streakWeeks: 8,
    techniquesLearned: 8,
    totalTechniques: 11,
    sequence: 19,
    classesInRank: 55,
  },
  {
    studentId: "current-user",
    studentName: "You (Current Member)",
    beltName: "White Belt",
    beltColor: "#ffffff",
    stripes: 4,
    streakWeeks: 10,
    techniquesLearned: 7,
    totalTechniques: 11,
    sequence: 14,
    classesInRank: 42,
  },
  {
    studentId: "std-mat-04",
    studentName: "Chloe Martin",
    beltName: "White Belt",
    beltColor: "#ffffff",
    stripes: 3,
    streakWeeks: 6,
    techniquesLearned: 5,
    totalTechniques: 11,
    sequence: 13,
    classesInRank: 30,
  },
  {
    studentId: "std-mat-05",
    studentName: "David De La Haye",
    beltName: "White Belt",
    beltColor: "#ffffff",
    stripes: 2,
    streakWeeks: 4,
    techniquesLearned: 4,
    totalTechniques: 11,
    sequence: 12,
    classesInRank: 22,
  },
];

const sampleCurriculumTechniques = [
  { name: "Closed Guard Fundamentals", mastered: true },
  { name: "Scissor Sweep & Hip Bump", mastered: true },
  { name: "Cross Collar Choke from Mount", mastered: true },
  { name: "Armbar from Guard", mastered: true },
  { name: "Triangle Choke Setup", mastered: true },
  { name: "Side Control Escapes (Shrimp)", mastered: true },
  { name: "Back Take & Seatbelt Control", mastered: true },
  { name: "Single Leg Takedown Defense", mastered: false },
  { name: "Open Guard Retention", mastered: false },
  { name: "Half Guard Underhook Recovery", mastered: false },
  { name: "Rear Naked Choke Finishing", mastered: false },
];

export type PeerComparisonWidgetProps = Readonly<{
  currentStudentId?: string;
  students?: readonly PeerComparisonStudent[];
}>;

export function PeerComparisonWidget({
  currentStudentId = "current-user",
  students = defaultPeerCohort,
}: PeerComparisonWidgetProps) {
  const comparison: PeerComparisonResult | null = useMemo(() => {
    let effectiveCohort = students;
    if (!students.some((s) => s.studentId === currentStudentId)) {
      const placeholderIdx = students.findIndex((s) => s.studentId === "current-user");
      if (placeholderIdx !== -1) {
        effectiveCohort = students.map((s, idx) =>
          idx === placeholderIdx ? { ...s, studentId: currentStudentId } : s,
        );
      }
    }

    return buildPeerComparison({
      currentStudentId,
      students: effectiveCohort,
    });
  }, [currentStudentId, students]);

  if (!comparison) {
    return null;
  }

  const { currentStudent, peersAbove, peersBelow } = comparison;

  function renderPeerCard(peer: PeerComparisonStudent, role: "above" | "current" | "below") {
    const isCurrent = role === "current";
    const initials = peer.studentName
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return (
      <div
        key={peer.studentId}
        className={`peer-card ${
          isCurrent ? "peer-card-current" : role === "above" ? "peer-card-above" : "peer-card-below"
        }`}
        data-testid={`peer-card-${peer.studentId}`}
      >
        <div className="peer-info-left">
          <div className="peer-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="peer-details">
            <div className="peer-name-row">
              <span className="peer-name">{peer.studentName}</span>
              {isCurrent && <span className="peer-you-badge">You</span>}
            </div>
            <div className="peer-rank-row">
              <span className="peer-belt-badge">
                {peer.beltName} • {peer.stripes} {peer.stripes === 1 ? "Stripe" : "Stripes"}
              </span>
              <span>• {peer.classesInRank} classes in rank</span>
            </div>
          </div>
        </div>

        <div className="peer-stats-right">
          <div className="peer-stat-box">
            <span className="peer-stat-label">Streak</span>
            <span className="peer-streak-badge">🔥 {peer.streakWeeks} wks</span>
          </div>

          <div className="peer-stat-box">
            <span className="peer-stat-label">Techniques</span>
            <span className="peer-stat-value">
              {peer.techniquesLearned} / {peer.totalTechniques}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="peer-comparison-container" aria-labelledby="peer-comparison-heading">
      <div className="peer-comparison-header">
        <h2 id="peer-comparison-heading" className="peer-comparison-title">
          🥋 Peer Progression & Competitors
        </h2>
        <p className="peer-comparison-subtitle">
          Compare your mat consistency and curriculum progress with the 2 peers immediately ahead
          and 2 immediately behind in graduation ranking.
        </p>
      </div>

      <div className="peer-comparison-stack">
        {/* Peers Above (Up to 2) */}
        {peersAbove.map((peer) => renderPeerCard(peer, "above"))}

        {/* Current Student */}
        {renderPeerCard(currentStudent, "current")}

        {/* Peers Below (Up to 2) */}
        {peersBelow.map((peer) => renderPeerCard(peer, "below"))}
      </div>

      {/* Curriculum Breakdown */}
      <div className="techniques-breakdown">
        <h3 className="techniques-title">Curriculum Technique Comparison</h3>
        <div className="techniques-grid">
          {sampleCurriculumTechniques.map((tech) => (
            <div
              key={tech.name}
              className={`technique-item ${tech.mastered ? "mastered" : "pending"}`}
            >
              <span>{tech.mastered ? "✓" : "○"}</span>
              <span>{tech.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
