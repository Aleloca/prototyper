import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorText, Loading } from "../components/ui";
import { errorMessage } from "../format";
import { useT } from "../i18n";
import { navigate } from "../router";
import { AuthCard } from "./Login";

export function Invite({ token }: { token: string }) {
  const t = useT();
  const [info, setInfo] = useState<{ email: string; name: string; reset: boolean } | null | undefined>();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ email: string; name: string; reset: boolean }>(`/api/panel/invites/${encodeURIComponent(token)}`)
      .then((i) => {
        setInfo(i);
        setName(i.name);
      })
      .catch(() => setInfo(null));
  }, [token]);

  if (info === undefined) return <Loading />;
  if (info === null)
    return (
      <AuthCard title={t("Invite not valid")}>
        <p className="text-muted">{t("This invite is not valid any more. Ask for a new one.")}</p>
      </AuthCard>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(t("The passwords don't match."));
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/panel/invites/${encodeURIComponent(token)}`, { name, password });
      navigate("/login", true);
      window.dispatchEvent(new Event("pt:signed-out"));
    } catch (err) {
      setError(t(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={info.reset ? t("Set a new password") : t("Welcome to Prototyper")} subtitle={info.email}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <div>
          <label className="label" htmlFor="name">{t("Your name")}</label>
          <input id="name" className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">{t("Password")}</label>
          <input id="pw" className="input" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-[12px] text-faint">{t("At least 10 characters.")}</p>
        </div>
        <div>
          <label className="label" htmlFor="pw2">{t("Repeat the password")}</label>
          <input id="pw2" className="input" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-2" disabled={busy}>
          {t("Save and sign in")}
        </button>
      </form>
    </AuthCard>
  );
}
