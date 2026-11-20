import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, type Me } from "../api";
import { Badge, ErrorText, Section } from "../components/ui";
import { errorMessage, formatDate, timeAgo } from "../format";
import { useT } from "../i18n";
import { Link } from "../router";
import { PENDING_AUTHORIZE } from "./Authorize";

export function Account({ me, onChange }: { me: Me; onChange: () => void }) {
  const t = useT();
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_AUTHORIZE);
  } catch {
    /* ignore */
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <h1 className="text-[22px] font-semibold">{t("Account")}</h1>
      {pending && me.user.totpEnabled && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
          <span className="flex-1">{t("Two-factor authentication is on. You can now connect Claude Code.")}</span>
          <Link to={pending} className="btn btn-primary">
            {t("Continue")}
          </Link>
        </div>
      )}
      <Profile me={me} onChange={onChange} />
      <TwoFactor me={me} onChange={onChange} />
      <Tokens />
      <Password />
    </div>
  );
}

function Profile({ me, onChange }: { me: Me; onChange: () => void }) {
  const t = useT();
  const [name, setName] = useState(me.user.name);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  return (
    <Section title={t("Profile")} description={me.user.email}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          api
            .put("/api/panel/me", { name })
            .then(() => {
              setMsg(t("Saved"));
              onChange();
            })
            .catch((err) => setError(t(errorMessage(err))));
        }}
      >
        <input className="input" aria-label={t("Your name")} value={name} onChange={(e) => (setName(e.target.value), setMsg(""))} />
        <button className="btn shrink-0" disabled={!name.trim() || name === me.user.name}>
          {msg || t("Save")}
        </button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

function TwoFactor({ me, onChange }: { me: Me; onChange: () => void }) {
  const t = useT();
  const [step, setStep] = useState<"idle" | "password" | "scan" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string } | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(undefined);
    setError("");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(t(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t("Two-factor authentication")}
      description={t("A 6-digit code from an authenticator app (1Password, Google Authenticator…) on top of your password. Required to connect Claude Code.")}
      actions={me.user.totpEnabled ? <Badge tone="ok">{t("On")}</Badge> : <Badge tone="muted">{t("Off")}</Badge>}
    >
      {step === "idle" &&
        (me.user.totpEnabled ? (
          <button className="btn" onClick={() => setStep("disable")}>
            {t("Turn off")}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setStep("password")}>
            {t("Turn on")}
          </button>
        ))}

      {step === "password" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api.post<{ secret: string; otpauthUrl: string }>("/api/panel/me/2fa/setup", { password });
              setSetup({ ...r, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 220 }) });
              setStep("scan");
            });
          }}
        >
          <label className="label" htmlFor="tf-pw">{t("Confirm your password")}</label>
          <input id="tf-pw" className="input" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>{t("Continue")}</button>
            <button type="button" className="btn" onClick={reset}>{t("Cancel")}</button>
          </div>
        </form>
      )}

      {step === "scan" && setup && (
        <form
          className="flex flex-col gap-4 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post("/api/panel/me/2fa/enable", { code });
              reset();
              onChange();
            });
          }}
        >
          <img src={setup.qr} alt={t("QR code for your authenticator app")} className="h-44 w-44 shrink-0 rounded-lg border border-line" />
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[13.5px]">{t("Scan the code with your authenticator app, then enter the 6-digit code it shows.")}</p>
            <p className="text-[12.5px] text-muted">
              {t("Can't scan? Enter this key by hand:")} <code className="font-mono break-all text-ink">{setup.secret}</code>
            </p>
            <input className="input max-w-40 text-center font-mono text-[18px] tracking-[0.25em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus aria-label={t("Code")} value={code} onChange={(e) => setCode(e.target.value)} />
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy}>{t("Turn on")}</button>
              <button type="button" className="btn" onClick={reset}>{t("Cancel")}</button>
            </div>
          </div>
        </form>
      )}

      {step === "disable" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post("/api/panel/me/2fa/disable", { password, code });
              reset();
              onChange();
            });
          }}
        >
          <p className="text-[13.5px] text-warn">{t("Turning it off also disconnects Claude Code everywhere.")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="d-pw">{t("Password")}</label>
              <input id="d-pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="d-code">{t("Code")}</label>
              <input id="d-code" className="input font-mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <button className="btn btn-danger" disabled={busy}>{t("Turn off")}</button>
            <button type="button" className="btn" onClick={reset}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </Section>
  );
}

interface Token {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

function Tokens() {
  const t = useT();
  const [tokens, setTokens] = useState<Token[] | undefined>();
  const [error, setError] = useState("");
  const load = () => api.get<Token[]>("/api/panel/me/tokens").then(setTokens).catch((e) => setError(errorMessage(e)));
  useEffect(() => void load(), []);

  return (
    <Section title={t("Claude Code connections")} description={t("Every computer where you signed in with the Prototyper MCP. Remove one to disconnect it.")}>
      {tokens?.length === 0 && <p className="text-muted">{t("No connections.")}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {tokens?.map((tk) => (
          <li key={tk.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{tk.name}</p>
              <p className="text-[12.5px] text-muted">
                {t("Connected {date}", { date: formatDate(tk.createdAt) })} · {tk.lastUsedAt ? t("last used {ago}", { ago: timeAgo(tk.lastUsedAt, t) }) : t("never used")} ·{" "}
                {t("expires {date}", { date: new Date(tk.expiresAt).toLocaleDateString() })}
              </p>
            </div>
            <button className="btn btn-danger" onClick={() => void api.del(`/api/panel/me/tokens/${tk.id}`).then(load)}>
              {t("Disconnect")}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

function Password() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  return (
    <Section title={t("Password")} description={t("Changing it signs you out everywhere else.")}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setMsg("");
          api
            .put("/api/panel/me/password", { current, password: next })
            .then(() => {
              setMsg(t("Password changed."));
              setCurrent("");
              setNext("");
            })
            .catch((err) => setError(t(errorMessage(err))));
        }}
      >
        <div>
          <label className="label" htmlFor="pw-cur">{t("Current password")}</label>
          <input id="pw-cur" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw-new">{t("New password")}</label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <button className="btn">{t("Change")}</button>
      </form>
      {msg && <p className="mt-2 text-[13px] text-ok">{msg}</p>}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}
