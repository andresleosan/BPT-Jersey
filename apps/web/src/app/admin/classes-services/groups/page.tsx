"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";
import type { MemberGroupView, SaveMemberGroup } from "@bpt-jersey/domain/schedule/groups";
import { listMemberNames } from "../../../../lib/members-client";
import { deleteMemberGroup, listMemberGroups, saveMemberGroup } from "../../../../lib/groups-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import "./groups.css";

export default function GroupsPage() {
  const session = useAdminOrStaffSession();
  const allowed = session.role === "owner" || session.role === "administrator";
  const [groups, setGroups] = useState<MemberGroupView[]>([]);
  const [members, setMembers] = useState<readonly MemberNameRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [draft, setDraft] = useState<SaveMemberGroup | null>(null);
  const [deleting, setDeleting] = useState<MemberGroupView | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    setStatus("loading");
    Promise.all([listMemberGroups(), listMemberNames()]).then(([groups, members]) => {
      if (alive) { setGroups(groups); setMembers(members); setStatus("ready"); }
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [allowed, reload]);
  useEffect(() => { if (draft) nameInput.current?.focus(); }, [draft?.groupId]);
  if (!allowed) return <p role="alert">Groups are managed by the office.</p>;
  const visible = groups.filter((group) => group.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = new Set(draft?.studentIds ?? []);
  const current = groups.find((group) => group.groupId === draft?.groupId);
  const matchingMembers = members.filter((member) => !selected.has(member.studentId) && member.fullName.toLowerCase().includes(memberSearch.trim().toLowerCase())).slice(0, 30);
  function edit(group?: MemberGroupView) {
    setDeleting(null); setNotice(null); setMemberSearch("");
    setDraft(group ? { groupId: group.groupId, name: group.name, studentIds: [...group.studentIds], revision: group.revision } : { groupId: crypto.randomUUID(), name: "", studentIds: [], revision: 0 });
  }
  async function mutate(action: () => Promise<void>, text: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(null);
    try {
      await action();
      setDraft(null); setDeleting(null);
      setNotice({ error: false, text }); setReload((value) => value + 1);
      heading.current?.focus();
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "Unable to save changes. Try again." }); }
    finally { pending.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (draft) void mutate(() => saveMemberGroup(draft), "Group saved. Use the calendar to register it for a class.");
  }
  return <div className="groups-page">
    <header className="groups-heading">
      <div><h3 ref={heading} tabIndex={-1}>Groups</h3><p>Keep members together when booking classes.</p></div>
      <button className="cs-button groups-primary" type="button" disabled={busy || status !== "ready"} onClick={() => edit()}>Create group</button>
    </header>
    {notice ? <p className="groups-notice" data-error={notice.error} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
    {draft ? <section className="groups-editor" aria-labelledby="group-editor-title">
      <h4 id="group-editor-title">{draft.revision === 0 ? "Create group" : "Edit group"}</h4>
      <form onSubmit={save}><fieldset disabled={busy}>
        <legend className="visually-hidden">Group details</legend>
        <label className="cs-field"><span>Group name</span><input ref={nameInput} required minLength={2} maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <div className="groups-member-picker">
          <section aria-labelledby="group-selected-title"><h5 id="group-selected-title">Members in this group <span>({selected.size})</span></h5>
            <p className="groups-hint">A member can belong to more than one group.</p>
            {selected.size ? <ul className="groups-members">{draft.studentIds.map((id) => {
              const member = members.find((row) => row.studentId === id);
              return <li key={id}><div><strong>{member?.fullName ?? "Member no longer available"}</strong>{current?.members.find((row) => row.studentId === id)?.missingPayment ? <span className="groups-payment">Missing Payment</span> : null}</div>
                <button type="button" className="cs-button" aria-label={`Remove ${member?.fullName ?? "member"} from group`} onClick={() => setDraft({ ...draft, studentIds: draft.studentIds.filter((value) => value !== id) })}>Remove</button></li>;
            })}</ul> : <p className="groups-empty-inline">Search for members to build this group.</p>}
          </section>
          <section aria-labelledby="group-add-title"><h5 id="group-add-title">Add existing members</h5>
            <label className="cs-field"><span>Search members</span><input type="search" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></label>
            <ul className="groups-members groups-search-results">{matchingMembers.map((member) => <li key={member.studentId}><span>{member.fullName}</span><button className="cs-button" type="button" disabled={selected.size >= 300} aria-label={`Add ${member.fullName} to group`} onClick={() => setDraft({ ...draft, studentIds: [...draft.studentIds, member.studentId] })}>Add</button></li>)}</ul>
            {!matchingMembers.length ? <p className="groups-hint">No matching members to add.</p> : <p className="groups-hint">Showing up to 30 matches. Search by name to narrow the list.</p>}
            {selected.size >= 300 ? <p role="status">This group has reached 300 members.</p> : null}
          </section>
        </div>
        <p className="groups-hint">Only members with an active subscription can be registered. Editing the group does not cancel existing bookings.</p>
        <div className="groups-actions"><button className="cs-button groups-primary" type="submit">{busy ? "Saving group…" : "Save group"}</button><button className="cs-button" type="button" onClick={() => setDraft(null)}>Cancel</button></div>
      </fieldset></form>
    </section> : null}
    <section aria-label="Group directory" aria-busy={status === "loading"}>
      <label className="cs-field groups-search"><span>Search groups</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {status === "loading" ? <div className="groups-loading" role="status"><span className="visually-hidden">Loading groups…</span><div /><div /><div /></div> : status === "error" ? <div className="groups-empty" role="alert"><p>Unable to load groups and members.</p><button className="cs-button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : !visible.length ? <div className="groups-empty"><h4>{search ? "No matching groups" : "Your first group starts here"}</h4><p>{search ? "Try another group name." : "Create a group, add members, then register it from a class in the calendar."}</p></div> :
      <ul className="groups-list">{visible.map((group) => <li key={group.groupId}>
        <div className="groups-row"><div><h4>{group.name}</h4><p>{group.members.length} {group.members.length === 1 ? "member" : "members"}{group.members.some((member) => member.missingPayment) ? ` · ${group.members.filter((member) => member.missingPayment).length} Missing Payment` : ""}</p></div>
          <div className="groups-actions"><button className="cs-button" type="button" disabled={busy} aria-label={`Edit ${group.name}`} onClick={() => edit(group)}>Edit group</button><button className="cs-button groups-delete" type="button" disabled={busy} aria-label={`Delete ${group.name}`} onClick={() => setDeleting(group)}>Delete group</button></div>
        </div>
        {deleting?.groupId === group.groupId ? <div className="groups-confirm" role="alert"><p>Delete <strong>{group.name}</strong>? Existing bookings will stay. This group will stop registering for future classes.</p><div className="groups-actions"><button className="cs-button groups-delete" type="button" disabled={busy} onClick={() => void mutate(() => deleteMemberGroup(group.groupId, group.revision), "Group deleted. Existing bookings have been kept.")}>{busy ? "Deleting…" : "Delete group"}</button><button className="cs-button" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep group</button></div></div> : null}
      </li>)}</ul>}
    </section>
  </div>;
}
