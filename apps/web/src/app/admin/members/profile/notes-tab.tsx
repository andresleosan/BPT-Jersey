"use client";

export function NotesTab({ note, onEdit }: { note?: string | undefined; onEdit: () => void }) {
  return (
    <section aria-label="Office notes">
      <h3>Office notes</h3>
      <p>Internal. Never shown to the member.</p>
      {note?.trim() ? (
        <p className="member-office-note">{note}</p>
      ) : (
        <p role="status">No office notes recorded.</p>
      )}
      <button className="member-record-button" type="button" onClick={onEdit}>
        Edit in Details
      </button>
      <p>Earlier notes may still be in the imported archive.</p>
    </section>
  );
}
