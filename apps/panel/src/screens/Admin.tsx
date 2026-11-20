import { useCallback, useEffect, useState } from "react";
import { api, type Me, type User } from "../api";
import { Modal } from "../components/Modal";
import { Badge, CopyButton, ErrorText, Loading } from "../components/ui";
import { errorMessage, formatDate, timeAgo } from "../format";
import { useT } from "../i18n";
import { navigate, useLocation } from "../router";

interface AdminUser extends User {
  workspaceIds: string[];
  invitePending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
interface AdminWorkspace {
  id: string;
  name: string;
  memberIds: string[];
  domains: { id: string; hostname: string; status: string }[];
  projects: number;
}
interface AdminDomain {
  id: string;
  workspaceId: string;
  hostname: string;
  status: "pending" | "active" | "error" | "disabled";
  certExpiresAt: string | null;
  lastError: string | null;
}

type Tab = "users" | "workspaces" | "domains";

export function Admin({ me, onChange }: { me: Me; onChange: () => void }) {
  const t = useT();
  const { search } = useLocation();
  const tab = (["users", "workspaces", "domains"] as const).find((x) => x === search.get("tab")) ?? "users";
  const [users, setUsers] = useState<AdminUser[]>();
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>();
  const [domains, setDomains] = useState<AdminDomain[]>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [u, w, d] = await Promise.all([
        api.get<AdminUser[]>("/api/panel/admin/users"),
        api.get<AdminWorkspace[]>("/api/panel/admin/workspaces"),
        api.get<AdminDomain[]>("/api/panel/admin/domains"),
      ]);
      setUsers(u);
      setWorkspaces(w);
      setDomains(d);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  // Domains get their certificate in the background: refresh while one is pending.
  useEffect(() => {
    if (!domains?.some((d) => d.status === "pending")) return;
    const timer = setTimeout(() => void load(), 4000);
    return () => clearTimeout(timer);
  }, [domains, load]);

  const reload = async () => {
    await load();
    onChange();
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold">{t("Admin")}</h1>
      <div className="flex gap-1 border-b border-line">
        {(["users", "workspaces", "domains"] as const).map((k) => (
          <button
            key={k}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] font-medium ${tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            onClick={() => navigate(`/admin?tab=${k}`, true)}
          >
            {t(k === "users" ? "People" : k === "workspaces" ? "Workspaces" : "Preview domains")}
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {!users || !workspaces || !domains ? (
        <Loading />
      ) : tab === "users" ? (
        <Users me={me} users={users} workspaces={workspaces} reload={reload} />
      ) : tab === "workspaces" ? (
        <Workspaces users={users} workspaces={workspaces} reload={reload} />
      ) : (
        <Domains domains={domains} workspaces={workspaces} reload={reload} />
      )}
    </div>
  );
}

function useAction() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(t(errorMessage(e)));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

// --- people --------------------------------------------------------------------------------------

function Users({ me, users, workspaces, reload }: { me: Me; users: AdminUser[]; workspaces: AdminWorkspace[]; reload: () => Promise<void> }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | undefined>();
  const [editing, setEditing] = useState<AdminUser | undefined>();
  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? "?";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <p className="flex-1 text-muted">{t("People sign in with email and password. They see every project in the workspaces they belong to.")}</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          {t("Invite someone")}
        </button>
      </div>
      <div className="card divide-y divide-line">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{u.name || u.email}</span>
                {u.isAdmin && <Badge tone="accent">{t("Admin")}</Badge>}
                {u.disabled && <Badge tone="danger">{t("Disabled")}</Badge>}
                {u.invitePending && <Badge tone="warn">{t("Invite pending")}</Badge>}
                {u.totpEnabled && <Badge tone="ok">2FA</Badge>}
              </div>
              <p className="truncate text-[12.5px] text-muted">
                {u.email} · {u.workspaceIds.length ? u.workspaceIds.map(wsName).join(", ") : t("no workspace")} ·{" "}
                {u.lastLoginAt ? t("last sign-in {ago}", { ago: timeAgo(u.lastLoginAt, t) }) : t("never signed in")}
              </p>
            </div>
            <button className="btn" onClick={() => setEditing(u)}>
              {t("Manage")}
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <InviteModal
          workspaces={workspaces}
          onClose={() => setAdding(false)}
          onDone={(email, url) => {
            setAdding(false);
            setLink({ email, url });
            void reload();
          }}
        />
      )}
      {link && <InviteLinkModal email={link.email} url={link.url} onClose={() => setLink(undefined)} />}
      {editing && (
        <UserModal
          me={me}
          user={editing}
          workspaces={workspaces}
          onClose={() => setEditing(undefined)}
          onInvite={(url) => {
            setLink({ email: editing.email, url });
            setEditing(undefined);
          }}
          reload={reload}
        />
      )}
    </div>
  );
}

function InviteModal({ workspaces, onClose, onDone }: { workspaces: AdminWorkspace[]; onClose: () => void; onDone: (email: string, url: string) => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [ws, setWs] = useState<string[]>(workspaces.length === 1 ? [workspaces[0]!.id] : []);
  const { busy, error, run } = useAction();
  const submit = () =>
    void run(async () => {
      const r = await api.post<{ inviteUrl: string; user: User }>("/api/panel/admin/users", { email, name, isAdmin, workspaceIds: ws });
      onDone(r.user.email, r.inviteUrl);
    });
  return (
    <Modal
      title={t("Invite someone")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn btn-primary" disabled={busy || !email.trim()} onClick={submit}>
            {t("Create invite link")}
          </button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), submit())}>
        <div>
          <label className="label" htmlFor="inv-email">{t("Email")}</label>
          <input id="inv-email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="inv-name">{t("Name (optional)")}</label>
          <input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">{t("Workspaces")}</legend>
          <WorkspaceChecks workspaces={workspaces} value={ws} onChange={setWs} />
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          <span>{t("Admin: manages people, workspaces and domains, and sees everything")}</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <button hidden />
      </form>
    </Modal>
  );
}

function WorkspaceChecks({ workspaces, value, onChange }: { workspaces: AdminWorkspace[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  if (!workspaces.length) return <p className="text-[13px] text-muted">{t("No workspaces yet.")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {workspaces.map((w) => (
        <label key={w.id} className="flex items-center gap-2">
          <input type="checkbox" checked={value.includes(w.id)} onChange={(e) => onChange(e.target.checked ? [...value, w.id] : value.filter((x) => x !== w.id))} />
          <span>{w.name}</span>
        </label>
      ))}
    </div>
  );
}

function InviteLinkModal({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t("Invite link for {email}", { email })} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>{t("Done")}</button>}>
      <p className="mb-3">{t("Send this link to the person: they choose their name and password. It works once, for 7 days.")}</p>
      <div className="flex gap-2">
        <input className="input font-mono text-[12.5px]" readOnly value={url} onFocus={(e) => e.target.select()} />
        <CopyButton text={url} />
      </div>
    </Modal>
  );
}

function UserModal(props: { me: Me; user: AdminUser; workspaces: AdminWorkspace[]; onClose: () => void; onInvite: (url: string) => void; reload: () => Promise<void> }) {
  const t = useT();
  const { user: u, workspaces } = props;
  const [ws, setWs] = useState(u.workspaceIds);
  const { busy, error, run } = useAction();
  const self = u.id === props.me.user.id;

  const saveWorkspaces = (next: string[]) =>
    void run(async () => {
      for (const id of next.filter((x) => !ws.includes(x))) await api.put(`/api/panel/admin/workspaces/${id}/members/${u.id}`);
      for (const id of ws.filter((x) => !next.includes(x))) await api.del(`/api/panel/admin/workspaces/${id}/members/${u.id}`);
      setWs(next);
      await props.reload();
    });
  const patch = (body: object) => void run(async () => (await api.patch(`/api/panel/admin/users/${u.id}`, body), await props.reload(), props.onClose()));

  return (
    <Modal title={u.name || u.email} onClose={props.onClose} footer={<button className="btn" onClick={props.onClose}>{t("Close")}</button>}>
      <div className="flex flex-col gap-5">
        <p className="text-[13px] text-muted">
          {u.email} · {t("added {date}", { date: formatDate(u.createdAt) })}
        </p>
        <fieldset>
          <legend className="label">{t("Workspaces")}</legend>
          <WorkspaceChecks workspaces={workspaces} value={ws} onChange={saveWorkspaces} />
          {u.isAdmin && <p className="mt-1 text-[12.5px] text-faint">{t("Admins see every workspace anyway.")}</p>}
        </fieldset>
        <div className="flex flex-col gap-2">
          <span className="label">{t("Access")}</span>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => void run(async () => props.onInvite((await api.post<{ inviteUrl: string }>(`/api/panel/admin/users/${u.id}/invite`)).inviteUrl))}>
              {u.invitePending || !u.lastLoginAt ? t("New invite link") : t("Password reset link")}
            </button>
            {u.totpEnabled && (
              <button className="btn" disabled={busy} onClick={() => void run(async () => (await api.post(`/api/panel/admin/users/${u.id}/reset-2fa`), await props.reload(), props.onClose()))}>
                {t("Reset 2FA")}
              </button>
            )}
            {!self && (
              <button className="btn" disabled={busy} onClick={() => patch({ isAdmin: !u.isAdmin })}>
                {u.isAdmin ? t("Remove admin") : t("Make admin")}
              </button>
            )}
            {!self && (
              <button className={`btn ${u.disabled ? "" : "btn-danger"}`} disabled={busy} onClick={() => patch({ disabled: !u.disabled })}>
                {u.disabled ? t("Enable") : t("Disable")}
              </button>
            )}
          </div>
          <p className="text-[12.5px] text-faint">{t("Disabling signs the person out and disconnects their Claude Code.")}</p>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}

// --- workspaces ----------------------------------------------------------------------------------

function Workspaces({ users, workspaces, reload }: { users: AdminUser[]; workspaces: AdminWorkspace[]; reload: () => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<AdminWorkspace | undefined>();
  const { busy, error, run } = useAction();
  const userName = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.email : "?";
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t("A workspace groups clients, projects and preview domains. Its members see everything inside it.")}</p>
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), void run(async () => (await api.post("/api/panel/admin/workspaces", { name }), setName(""), await reload())))}>
        <input className="input" placeholder={t("New workspace name")} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary shrink-0" disabled={busy || !name.trim()}>
          {t("Create")}
        </button>
      </form>
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-3 md:grid-cols-2">
        {workspaces.map((w) => (
          <div key={w.id} className="card p-4">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[15px] font-semibold">{w.name}</span>
              <button className="btn btn-ghost" onClick={() => setRenaming(w)}>
                {t("Rename")}
              </button>
              {w.projects === 0 && (
                <button className="btn btn-ghost text-danger" disabled={busy} onClick={() => void run(async () => (await api.del(`/api/panel/admin/workspaces/${w.id}`), await reload()))}>
                  {t("Delete")}
                </button>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {t("{n} projects", { n: w.projects })} · {w.domains.length ? w.domains.map((d) => d.hostname).join(", ") : t("no domain")}
            </p>
            <p className="mt-2 text-[13px]">
              <span className="text-muted">{t("Members")}: </span>
              {w.memberIds.length ? w.memberIds.map(userName).join(", ") : <span className="text-faint">{t("nobody yet (manage people in the People tab)")}</span>}
            </p>
          </div>
        ))}
      </div>
      {renaming && <RenameModal ws={renaming} onClose={() => setRenaming(undefined)} reload={reload} />}
    </div>
  );
}

function RenameModal({ ws, onClose, reload }: { ws: AdminWorkspace; onClose: () => void; reload: () => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(ws.name);
  const { busy, error, run } = useAction();
  const save = () => void run(async () => (await api.patch(`/api/panel/admin/workspaces/${ws.id}`, { name }), await reload(), onClose()));
  return (
    <Modal
      title={t("Rename workspace")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{t("Save")}</button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), save())}>
        <input className="input" autoFocus aria-label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} />
      </form>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

// --- domains -------------------------------------------------------------------------------------

function Domains({ domains, workspaces, reload }: { domains: AdminDomain[]; workspaces: AdminWorkspace[]; reload: () => Promise<void> }) {
  const t = useT();
  const [hostname, setHostname] = useState("");
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const { busy, error, run } = useAction();
  const panelHost = location.hostname;

  const STATUS: Record<AdminDomain["status"], { label: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
    active: { label: "Active", tone: "ok" },
    pending: { label: "Getting the certificate…", tone: "warn" },
    error: { label: "Error", tone: "danger" },
    disabled: { label: "Disabled", tone: "muted" },
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 text-[13.5px]">
        <p className="font-medium">{t("How to add a domain")}</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted">
          <li>{t("At your DNS provider, point the domain (an A record, or a CNAME) to this server, the same one that answers on {host}.", { host: panelHost })}</li>
          <li>{t("Add it here and pick its workspace. Prototyper checks the DNS and gets the HTTPS certificate by itself, in under a minute.")}</li>
        </ol>
      </div>
      {workspaces.length === 0 ? (
        <p className="text-muted">{t("Create a workspace first.")}</p>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => (e.preventDefault(), void run(async () => (await api.post("/api/panel/admin/domains", { hostname, workspaceId: ws }), setHostname(""), await reload())))}
        >
          <input className="input max-w-72" placeholder="preview.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} />
          <select className="input w-auto" aria-label={t("Workspace")} value={ws} onChange={(e) => setWs(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={busy || !hostname.trim()}>
            {t("Add domain")}
          </button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="card divide-y divide-line">
        {domains.length === 0 && <p className="px-4 py-6 text-center text-muted">{t("No domains yet.")}</p>}
        {domains.map((d) => {
          const st = STATUS[d.status];
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13.5px]">{d.hostname}</span>
                  <Badge tone={st.tone}>{t(st.label)}</Badge>
                </div>
                <p className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
                  <select
                    className="rounded border border-transparent bg-transparent py-0.5 pr-1 text-[12.5px] text-muted hover:border-line focus:border-accent"
                    aria-label={t("Workspace of {domain}", { domain: d.hostname })}
                    value={d.workspaceId}
                    disabled={busy}
                    onChange={(e) => void run(async () => (await api.patch(`/api/panel/admin/domains/${d.id}`, { workspaceId: e.target.value }), await reload()))}
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  {d.certExpiresAt && ` · ${t("certificate until {date}", { date: new Date(d.certExpiresAt).toLocaleDateString() })}`}
                </p>
                {d.status === "error" && d.lastError && <p className="mt-0.5 text-[12.5px] text-danger">{d.lastError}</p>}
              </div>
              {(d.status === "error" || d.status === "pending") && (
                <button className="btn" disabled={busy} onClick={() => void run(async () => (await api.post(`/api/panel/admin/domains/${d.id}/verify`), await reload()))}>
                  {t("Try again")}
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => void run(async () => (await api.patch(`/api/panel/admin/domains/${d.id}`, { disabled: d.status !== "disabled" }), await reload()))}>
                {d.status === "disabled" ? t("Enable") : t("Disable")}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void run(async () => (await api.del(`/api/panel/admin/domains/${d.id}`), await reload()))}>
                {t("Remove")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
