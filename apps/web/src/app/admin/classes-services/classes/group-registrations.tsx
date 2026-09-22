"use client";
import { useEffect, useRef, useState } from "react";
import type { GroupSessionView } from "@bpt-jersey/domain/schedule/groups";
import { listSessionGroups, registerMemberGroup, removeGroupSessionMember } from "../../../../lib/groups-client";
import "../groups/groups.css";

export function GroupRegistrations({ sessionId, canManage, onChanged }: { sessionId: string; canManage: boolean; onChanged: () => Promise<void> }) {
  const [groups, setGroups] = useState<GroupSessionView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    let alive = true; setStatus("loading");
    listSessionGroups(sessionId).then((rows) => { if (alive) { setGroups(rows); setStatus("ready"); } }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [sessionId, reload]);
  async function mutate(action: () => Promise<GroupSessionView[]>, message: string) {
    if (lock.current) return;
    lock.current = true; setPending(true); setNotice(null);
    try { setGroups(await action()); setNotice({ error: false, text: message }); await onChanged(); }
    catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "Unable to update registrations. Try again." }); }
    finally { lock.current = false; setPending(false); }
  }
  return <div aria-label="Group registrations" aria-busy={pending || status === "loading"}>
    {notice ? <p className="groups-notice" data-error={notice.error} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
    <button className="cs-button" type="button" disabled={pending || status === "loading"} onClick={() => setReload((value) => value + 1)}>Refresh groups</button>
    {status === "loading" ? <div className="groups-loading" role="status"><span className="visually-hidden">Loading groups…</span><div /><div /></div> : status === "error" ? <p role="alert">Unable to load groups. Use Refresh groups to try again.</p> : !groups.length ? <p>{canManage ? <>No groups yet. <a href="/admin/classes-services/groups/">Create a group</a> to register members together.</> : "No groups registered for this class."}</p> :
    <ul className="group-session-list">{groups.map((group) => {
      const open = expanded === group.groupId;
      const registered = group.members.filter((member) => member.state === "registered").length;
      const blocked = group.members.filter((member) => member.state === "blocked").length;
      return <li key={group.groupId}>
        <button className="group-session-toggle" type="button" aria-expanded={open} aria-controls={`group-session-${group.groupId}`} onClick={() => setExpanded(open ? null : group.groupId)}>
          <span><strong>{group.name}{group.active ? "" : " (deleted)"}</strong>{group.assigned ? `${registered} registered${blocked ? `, ${blocked} not registered` : ""}` : `${group.members.length} members`}</span><span>{open ? "Close" : "View members"}</span>
        </button>
        {open ? <div className="group-session-detail" id={`group-session-${group.groupId}`}>
          <p className="groups-hint">{group.recurring ? "Registers this class and following weeks in the same series. Each date requires an active subscription." : "Registers members for this class only."}</p>
          {canManage && group.active ? <button className="cs-button groups-primary" type="button" disabled={pending || !group.members.length} onClick={() => void mutate(() => registerMemberGroup(group.groupId, sessionId), group.recurring ? "Registration processed. Review each member below; future weeks are processed automatically." : "Registration processed. Review each member below.")}>{pending ? "Updating registrations…" : group.assigned ? "Retry eligible members" : "Register group"}</button> : null}
          {!group.members.length ? <p>No members in this group.</p> : <ul className="groups-members">{group.members.map((member) => <li key={member.studentId}>
            <div><strong>{member.fullName}</strong><p className="group-session-state" data-state={member.state}>{member.reason}</p>{member.missingPayment && member.reason !== "Missing Payment" ? <span className="groups-payment">Missing Payment</span> : null}</div>
            {canManage && group.assigned && member.state !== "excluded" ? <button className="cs-button" type="button" disabled={pending} aria-label={`Remove ${member.fullName} from this class only`} onClick={() => void mutate(() => removeGroupSessionMember(group.groupId, sessionId, member.studentId), "Member removed from this class only. Group membership and other dates are unchanged.")}>Remove from class</button> : null}
          </li>)}</ul>}
        </div> : null}
      </li>;
    })}</ul>}
  </div>;
}
