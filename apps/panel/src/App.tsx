import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Me } from "./api";
import { ChevronDown, LogOut } from "./components/icons";
import { Loading, Logo } from "./components/ui";
import { useT } from "./i18n";
import { Link, match, navigate, useLocation } from "./router";
import { Account } from "./screens/Account";
import { Admin } from "./screens/Admin";
import { Authorize } from "./screens/Authorize";
import { Invite } from "./screens/Invite";
import { Login } from "./screens/Login";
import { ProjectScreen } from "./screens/Project";
import { Projects } from "./screens/Projects";

const LAST_WS = "pt:workspace";

export function App() {
  const { path, search } = useLocation();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/api/panel/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    void load();
    const out = () => setMe(null);
    window.addEventListener("pt:signed-out", out);
    return () => window.removeEventListener("pt:signed-out", out);
  }, [load]);

  const invite = match("/invite/:token", path);
  if (invite) return <Invite token={invite.token!} />;
  if (me === undefined) return <Loading />;
  if (me === null) return <Login onSignedIn={() => void load()} next={path === "/login" ? (search.get("next") ?? "/") : path + location.search} />;
  if (path === "/oauth/authorize") return <Authorize me={me} onChange={() => void load()} />;

  return <Shell me={me} path={path} reload={load} />;
}

function Shell({ me, path, reload }: { me: Me; path: string; reload: () => Promise<void> }) {
  const t = useT();
  const remembered = (() => {
    try {
      return localStorage.getItem(LAST_WS);
    } catch {
      return null;
    }
  })();
  const ws = match("/w/:id", path);
  // On a project page, the project's workspace (set by the screen once loaded).
  const [shown, setShown] = useState<string | undefined>();
  const workspaceId = ws?.id ?? shown ?? (me.workspaces.some((w) => w.id === remembered) ? remembered! : me.workspaces[0]?.id);

  useEffect(() => {
    if (path === "/" || path === "/login") navigate(workspaceId ? `/w/${workspaceId}` : "/account", true);
  }, [path, workspaceId]);
  useEffect(() => {
    const id = ws?.id ?? shown;
    if (!id) return;
    try {
      localStorage.setItem(LAST_WS, id);
    } catch {
      /* private mode */
    }
  }, [ws?.id, shown]);

  const project = match("/p/:id", path);
  const logout = async () => {
    await api.post("/api/panel/logout").catch(() => {});
    navigate("/login", true);
    await reload();
  };

  let screen;
  if (ws && workspaceId) screen = <Projects key={workspaceId} workspaceId={workspaceId} isAdmin={me.user.isAdmin} />;
  else if (project) screen = <ProjectScreen key={project.id} id={project.id!} onWorkspace={setShown} />;
  else if (path === "/account") screen = <Account me={me} onChange={() => void reload()} />;
  else if (path === "/admin" && me.user.isAdmin) screen = <Admin me={me} onChange={() => void reload()} />;
  else if (path === "/" || path === "/login") screen = <Loading />;
  else screen = <p className="py-24 text-center text-muted">{t("Page not found.")}</p>;

  const navItem = (to: string, label: string, active: boolean) => (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-14 items-center px-1 text-[14px] font-medium transition-colors duration-150 ${active ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  const initials = (me.user.name || me.user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line bg-stock">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-5 px-4 sm:px-8">
          <Link to={workspaceId ? `/w/${workspaceId}` : "/account"} className="flex items-center gap-2.5 text-[16px] font-bold tracking-[-0.01em]">
            <Logo />
            <span className="hidden sm:inline">Prototyper</span>
          </Link>
          {me.workspaces.length > 0 && (
            <label className="relative">
              <span className="sr-only">{t("Workspace")}</span>
              <select
                className="h-9 max-w-52 cursor-pointer appearance-none truncate rounded-[4px] border border-line-strong bg-stock pr-8 pl-3 text-[13.5px] font-semibold outline-none hover:border-ink/40 focus-visible:border-ink"
                value={workspaceId ?? ""}
                onChange={(e) => navigate(`/w/${e.target.value}`)}
              >
                {me.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" />
            </label>
          )}
          <nav className="hidden items-center gap-5 sm:flex" aria-label={t("Main")}>
            {workspaceId && navItem(`/w/${workspaceId}`, t("Projects"), !!ws || !!project)}
            {me.user.isAdmin && navItem("/admin", t("Admin"), path === "/admin")}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/account"
              title={me.user.email}
              aria-current={path === "/account" ? "page" : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-[4px] pr-3 pl-1.5 text-[13.5px] font-medium transition-colors duration-150 hover:bg-ink/5 ${path === "/account" ? "bg-ink/5" : ""}`}
            >
              <span className="grid size-7 place-items-center rounded-[3px] bg-ink text-[11px] font-bold text-white">{initials}</span>
              <span className="hidden max-w-40 truncate md:inline">{me.user.name || me.user.email}</span>
            </Link>
            <button type="button" className="btn btn-ghost px-2.5 text-muted" onClick={() => void logout()} aria-label={t("Sign out")} title={t("Sign out")}>
              <LogOut aria-hidden />
            </button>
          </div>
        </div>
        <nav className="flex gap-5 border-t border-line px-4 sm:hidden" aria-label={t("Main")}>
          {workspaceId && navItem(`/w/${workspaceId}`, t("Projects"), !!ws || !!project)}
          {me.user.isAdmin && navItem("/admin", t("Admin"), path === "/admin")}
          {navItem("/account", t("Account"), path === "/account")}
        </nav>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 py-8 sm:px-8">
        {me.workspaces.length === 0 && path !== "/account" && path !== "/admin" ? (
          <div className="mx-auto max-w-md py-24 text-center">
            <h1 className="text-[19px] font-bold">{t("No workspace yet")}</h1>
            <p className="mt-2 text-muted">{t("You are not in any workspace yet. Ask an admin to add you.")}</p>
          </div>
        ) : (
          screen
        )}
      </main>
    </div>
  );
}
