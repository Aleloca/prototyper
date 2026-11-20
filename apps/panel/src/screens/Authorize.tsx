import { useState } from "react";
import { api, type Me } from "../api";
import { ErrorText } from "../components/ui";
import { errorMessage } from "../format";
import { useT } from "../i18n";
import { Link } from "../router";
import { AuthCard } from "./Login";

export const PENDING_AUTHORIZE = "pt:authorize";

/**
 * Consent page for the MCP login: Claude Code opened this URL with a loopback redirect. Approving it
 * needs 2FA on and a fresh code; the browser is then sent back to Claude Code with a one-time code.
 */
export function Authorize({ me }: { me: Me; onChange: () => void }) {
  const t = useT();
  const q = new URLSearchParams(location.search);
  const redirectUri = q.get("redirect_uri") ?? "";
  const clientName = q.get("client_name") ?? "Claude Code";
  const valid = q.get("response_type") === "code" && q.get("code_challenge_method") === "S256" && !!q.get("code_challenge") && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/callback$/.test(redirectUri);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | undefined>();

  if (!valid) {
    return (
      <AuthCard title={t("Invalid request")}>
        <p className="text-muted">{t("This authorization link is incomplete. Start the login again from Claude Code.")}</p>
      </AuthCard>
    );
  }

  if (!me.user.totpEnabled) {
    try {
      sessionStorage.setItem(PENDING_AUTHORIZE, location.pathname + location.search);
    } catch {
      /* ignore */
    }
    return (
      <AuthCard title={t("Turn on two-factor authentication")} subtitle={me.user.email}>
        <p className="mb-4">{t("Connecting Claude Code requires two-factor authentication. Turn it on in your account, then come back here.")}</p>
        <Link to="/account" className="btn btn-primary h-10 w-full">
          {t("Go to Account")}
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title={done === "approved" ? t("Claude Code is connected") : t("Request denied")}>
        <p className="text-muted">{done === "approved" ? t("You can close this tab and go back to the terminal.") : t("Nothing was shared. You can close this tab.")}</p>
      </AuthCard>
    );
  }

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ redirect: string }>("/api/panel/oauth/authorize", {
        redirectUri,
        codeChallenge: q.get("code_challenge"),
        state: q.get("state") ?? "",
        clientName,
        code,
      });
      try {
        sessionStorage.removeItem(PENDING_AUTHORIZE);
      } catch {
        /* ignore */
      }
      setDone("approved");
      location.assign(r.redirect);
    } catch (err) {
      setError(t(errorMessage(err)));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("Connect Claude Code")} subtitle={me.user.email}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void approve(e)}>
        <p>
          {t("{client} wants to use Prototyper as you: publish projects and read client feedback in your workspaces.", { client: clientName })}
        </p>
        <ul className="rounded-md bg-wash px-3 py-2 text-[13px] text-muted">
          {me.workspaces.map((w) => (
            <li key={w.id}>· {w.name}</li>
          ))}
        </ul>
        <div>
          <label className="label" htmlFor="az-code">{t("Code from your authenticator app")}</label>
          <input
            id="az-code"
            className="input text-center font-mono text-[19px] tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary h-10" disabled={busy}>
          {t("Authorize")}
        </button>
        <button type="button" className="text-[13px] text-muted hover:underline" onClick={() => setDone("denied")}>
          {t("Deny")}
        </button>
        <p className="text-center text-[12.5px] text-faint">{t("You can disconnect it anytime from Account.")}</p>
      </form>
    </AuthCard>
  );
}
