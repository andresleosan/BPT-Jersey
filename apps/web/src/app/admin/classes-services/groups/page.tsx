"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { groupSites, type GroupSite, type MemberGroupView, type SaveMemberGroup } from "@bpt-jersey/domain/schedule/groups";
import { getMemberOverview } from "../../../../lib/member-overview-client";
import { deleteMemberGroup, listMemberGroups, saveMemberGroup } from "../../../../lib/groups-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import "./groups.css";

/** Older groups have no site until the office picks one while editing them. */
type Draft = Omit<SaveMemberGroup, "site"> & { site?: GroupSite };
const siteSections: readonly { key: GroupSite | "none"; title: string }[] = [
  { key: "Town", title: "Town" }, { key: "West", title: "West" }, { key: "none", title: "Unassigned site" },
];

export default function GroupsPage() {
  const session = useAdminOrStaffSession();
  const allowed = session.role === "owner" || session.role === "administrator";
  const [groups, setGroups] = useState<MemberGroupView[]>([]);
  const [members, setMembers] = useState<readonly MemberOverviewRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<GroupSite | "all">("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [siteError, setSiteError] = useState(false);
  const [membersFailed, setMembersFailed] = useState(false);
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
    // The group list still renders when the member directory fails; only the picker reports it.
    void Promise.allSettled([listMemberGroups(), getMemberOverview()]).then(([groups, overview]) => {
      if (!alive) return;
      setMembersFailed(overview.status === "rejected");
      if (overview.status === "fulfilled") setMembers(overview.value.rows);
      if (groups.status === "fulfilled") { setGroups(groups.value); setStatus("ready"); } else setStatus("error");
    });
    return () => { alive = false; };
  }, [allowed, reload]);
  useEffect(() => { if (draft) nameInput.current?.focus(); }, [draft?.groupId]);
  if (!allowed) return <p role="alert">Groups are managed by the office.</p>;
  const visible = groups.filter((group) => group.name.toLowerCase().includes(search.trim().toLowerCase()) && (siteFilter === "all" || group.site === siteFilter));
  const selected = new Set(draft?.studentIds ?? []);
  const current = groups.find((group) => group.groupId === draft?.groupId);
  // Guardians and inactive members cannot join a group; the server refuses them as well.
  const matchingMembers = members.filter((member) => member.rowKind === "member" && member.active && !selected.has(member.studentId) && member.fullName.toLowerCase().includes(memberSearch.trim().toLowerCase())).slice(0, 30);
  function edit(group?: MemberGroupView) {
    setDeleting(null); setNotice(null); setMemberSearch(""); setSiteError(false);
    setDraft(group ? { groupId: group.groupId, name: group.name, ...(group.site ? { site: group.site } : {}), studentIds: [...group.studentIds], revision: group.revision } : { groupId: crypto.randomUUID(), name: "", studentIds: [], revision: 0 });
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
    if (!draft) return;
    const site = draft.site;
    if (!site) { setSiteError(true); return; }
    void mutate(() => saveMemberGroup({ ...draft, site }), "Group saved. Use the calendar to register it for a class.");
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
        <div className="cs-field groups-site" data-error={siteError} role="radiogroup" aria-labelledby="group-site-label" aria-required="true" aria-describedby={siteError ? "group-site-error" : undefined}>
          <span id="group-site-label">Site</span>
          <div className="groups-site-options">{groupSites.map((site) => <label key={site}><input type="radio" name="group-site" value={site} checked={draft.site === site} onChange={() => { setDraft({ ...draft, site }); setSiteError(false); }} />{site}</label>)}</div>
          {siteError ? <p className="groups-field-error" id="group-site-error">Choose Town or West.</p> : null}
        </div>
        <div className="groups-member-picker">
          <section aria-labelledby="group-selected-title"><h5 id="group-selected-title">Members in this group <span>({selected.size})</span></h5>
            <p className="groups-hint">A member can belong to more than one group.</p>
            {selected.size ? <ul className="groups-members">{draft.studentIds.map((id) => {
              const row = members.find((candidate) => candidate.studentId === id);
              const member = row ?? current?.members.find((candidate) => candidate.studentId === id);
              const refusal = row?.rowKind === "guardian" ? "Guardian. Remove before saving." : row && !row.active ? "Inactive. Remove before saving." : null;
              return <li key={id}><div><strong>{member?.fullName ?? "Member no longer available"}</strong>{refusal ? <span className="groups-payment">{refusal}</span> : null}{current?.members.find((row) => row.studentId === id)?.missingPayment ? <span className="groups-payment">Missing Payment</span> : null}</div>
                <button type="button" className="cs-button" aria-label={`Remove ${member?.fullName ?? "member"} from group`} onClick={() => setDraft({ ...draft, studentIds: draft.studentIds.filter((value) => value !== id) })}>Remove</button></li>;
            })}</ul> : <p className="groups-empty-inline">Search for members to build this group.</p>}
          </section>
          <section aria-labelledby="group-add-title"><h5 id="group-add-title">Add existing members</h5>
            {membersFailed ? <div className="groups-notice" data-error="true"><p role="alert">Unable to load members. Use Try again to reload them.</p><button className="cs-button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : null}
            <label className="cs-field"><span>Search members</span><input type="search" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></label>
            <ul className="groups-members groups-search-results">{matchingMembers.map((member) => <li key={member.studentId}><span>{member.fullName}</span><button className="cs-button" type="button" disabled={selected.size >= 300} aria-label={`Add ${member.fullName} to group`} onClick={() => setDraft({ ...draft, studentIds: [...draft.studentIds, member.studentId] })}>Add</button></li>)}</ul>
            {!matchingMembers.length ? <p className="groups-hint">No matching members to add.</p> : <p className="groups-hint">Showing up to 30 matches. Search by name to narrow the list.</p>}
            {selected.size >= 300 ? <p role="status">This group has reached 300 members.</p> : null}
          </section>
        </div>
        <p className="groups-hint">Only members with an active subscription can be registered. A group books its members even where the class type or plan limits age, site or weekly classes. Editing the group does not cancel existing bookings.</p>
        <div className="groups-actions"><button className="cs-button groups-primary" type="submit">{busy ? "Saving group…" : "Save group"}</button><button className="cs-button" type="button" onClick={() => setDraft(null)}>Cancel</button></div>
      </fieldset></form>
    </section> : null}
    <section aria-label="Group directory" aria-busy={status === "loading"}>
      <div className="groups-filters">
        <label className="cs-field groups-search"><span>Search groups</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="cs-field"><span>Show site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value as GroupSite | "all")}><option value="all">All sites</option>{groupSites.map((site) => <option key={site} value={site}>{site}</option>)}</select></label>
      </div>
      {status === "loading" ? <div className="groups-loading" role="status"><span className="visually-hidden">Loading groups…</span><div /><div /><div /></div> : status === "error" ? <div className="groups-empty" role="alert"><p>Unable to load groups and members.</p><button className="cs-button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : !visible.length ? <div className="groups-empty"><h4>{search || siteFilter !== "all" ? "No matching groups" : "Your first group starts here"}</h4><p>{search || siteFilter !== "all" ? "Try another group name or site." : "Create a group, add members, then register it from a class in the calendar."}</p></div> :
      siteSections.map(({ key, title }) => {
        const rows = visible.filter((group) => (group.site ?? "none") === key);
        return rows.length ? <section key={key} className="groups-site-section" aria-labelledby={`groups-site-${key}`}><h4 id={`groups-site-${key}`}>{title}</h4>
      <ul className="groups-list">{rows.map((group) => <li key={group.groupId}>
        <div className="groups-row"><div><h5>{group.name}</h5><p>{group.members.length} {group.members.length === 1 ? "member" : "members"}{group.members.some((member) => member.missingPayment) ? ` · ${group.members.filter((member) => member.missingPayment).length} Missing Payment` : ""}</p></div>
          <div className="groups-actions"><button className="cs-button" type="button" disabled={busy} aria-label={`Edit ${group.name}`} onClick={() => edit(group)}>Edit group</button><button className="cs-button groups-delete" type="button" disabled={busy} aria-label={`Delete ${group.name}`} onClick={() => setDeleting(group)}>Delete group</button></div>
        </div>
        {deleting?.groupId === group.groupId ? <div className="groups-confirm" role="alert"><p>Delete <strong>{group.name}</strong>? Existing bookings will stay. This group will stop registering for future classes.</p><div className="groups-actions"><button className="cs-button groups-delete" type="button" disabled={busy} onClick={() => void mutate(() => deleteMemberGroup(group.groupId, group.revision), "Group deleted. Existing bookings have been kept.")}>{busy ? "Deleting…" : "Delete group"}</button><button className="cs-button" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep group</button></div></div> : null}
      </li>)}</ul></section> : null;
      })}
    </section>
  </div>;
}
