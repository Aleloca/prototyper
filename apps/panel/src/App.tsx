import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Me } from "./api";
import { Loading } from "./components/ui";
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
  const workspaceId = ws?.id ?? (me.workspaces.some((w) => w.id === remembered) ? remembered! : me.workspaces[0]?.id);

  useEffect(() => {
    if (path === "/" || path === "/login") navigate(workspaceId ? `/w/${workspaceId}` : "/account", true);
  }, [path, workspaceId]);
  useEffect(() => {
    if (!ws?.id) return;
    try {
      localStorage.setItem(LAST_WS, ws.id);
    } catch {
      /* private mode */
    }
  }, [ws?.id]);

  const project = match("/p/:id", path);
  const logout = async () => {
    await api.post("/api/panel/logout").catch(() => {});
    navigate("/login", true);
    await reload();
  };

  let screen;
  if (ws && workspaceId) screen = <Projects key={workspaceId} workspaceId={workspaceId} isAdmin={me.user.isAdmin} />;
  else if (project) screen = <ProjectScreen key={project.id} id={project.id!} />;
  else if (path === "/account") screen = <Account me={me} onChange={() => void reload()} />;
  else if (path === "/admin" && me.user.isAdmin) screen = <Admin me={me} onChange={() => void reload()} />;
  else if (path === "/" || path === "/login") screen = <Loading />;
  else screen = <p className="py-24 text-center text-muted">{t("Page not found.")}</p>;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to={workspaceId ? `/w/${workspaceId}` : "/account"} className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="hidden sm:inline">Prototyper</span>
          </Link>
          {me.workspaces.length > 0 && (
            <select
              className="input w-auto max-w-48 py-1 text-[13.5px]"
              aria-label={t("Workspace")}
              value={workspaceId ?? ""}
              onChange={(e) => navigate(`/w/${e.target.value}`)}
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <nav className="ml-auto flex items-center gap-1">
            {me.user.isAdmin && (
              <Link to="/admin" className={`btn btn-ghost ${path === "/admin" ? "bg-black/5" : ""}`}>
                {t("Admin")}
              </Link>
            )}
            <Link to="/account" className={`btn btn-ghost ${path === "/account" ? "bg-black/5" : ""}`} title={me.user.email}>
              {me.user.name || me.user.email}
            </Link>
            <button className="btn btn-ghost text-muted" onClick={() => void logout()}>
              {t("Sign out")}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {me.workspaces.length === 0 && path !== "/account" && path !== "/admin" ? (
          <p className="py-24 text-center text-muted">{t("You are not in any workspace yet. Ask an admin to add you.")}</p>
        ) : (
          screen
        )}
      </main>
    </div>
  );
}
