import { useState } from "react";
import { api } from "../api";
import { ErrorText, Logo } from "../components/ui";
import { errorMessage } from "../format";
import { useT } from "../i18n";
import { navigate } from "../router";

export function AuthCard(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={36} />
          <div>
            <h1 className="text-[26px] font-bold tracking-[-0.02em]">{props.title}</h1>
            {props.subtitle && <p className="mt-1 text-muted">{props.subtitle}</p>}
          </div>
        </div>
        <div className="sheet p-7">{props.children}</div>
      </div>
    </div>
  );
}

export function Login(props: { onSignedIn: () => void; next: string }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const done = () => {
    const next = props.next.startsWith("/") && !props.next.startsWith("//") ? props.next : "/";
    navigate(next === "/login" ? "/" : next, true);
    props.onSignedIn();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!mfa) {
        const r = await api.post<{ mfaRequired?: boolean }>("/api/panel/login", { email, password });
        if (r.mfaRequired) setMfa(true);
        else done();
      } else {
        await api.post("/api/panel/login/mfa", { code });
        done();
      }
    } catch (err) {
      setError(t(errorMessage(err)));
      if (mfa && errorMessage(err).startsWith("Sign in again")) setMfa(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("Sign in to Prototyper")} subtitle={mfa ? t("Enter the 6-digit code from your authenticator app.") : undefined}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {!mfa ? (
          <>
            <div>
              <label className="label" htmlFor="email">{t("Email")}</label>
              <input id="email" className="input" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="password">{t("Password")}</label>
              <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="code">{t("Code")}</label>
            <input
              id="code"
              className="input text-center font-mono text-[19px] tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary h-10" disabled={busy}>
          {mfa ? t("Verify") : t("Sign in")}
        </button>
        {mfa && (
          <button type="button" className="text-[13px] text-muted hover:underline" onClick={() => setMfa(false)}>
            {t("Use a different account")}
          </button>
        )}
      </form>
    </AuthCard>
  );
}
