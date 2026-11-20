import { useState, type ReactNode } from "react";
import { copy } from "../format";
import { useT } from "../i18n";
import type { ProjectSummary, RoundSummary } from "../api";

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner />
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-[13px] text-danger">{children}</p> : null;
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn"
      onClick={() =>
        void copy(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? t("Copied") : (label ?? t("Copy"))}
    </button>
  );
}

/** Where the review stands, in the developer's terms. */
export function roundState(p: Pick<ProjectSummary, "shareStatus" | "round">): { label: string; tone: "ok" | "warn" | "muted" | "accent" | "danger" } {
  if (p.shareStatus === "revoked") return { label: "Link disabled", tone: "danger" };
  const r: RoundSummary | null = p.round;
  if (!r) return { label: "Not published", tone: "muted" };
  if (r.status === "submitted") return { label: "Feedback to import", tone: "warn" };
  if (r.status === "imported") return { label: "Feedback imported", tone: "ok" };
  if (r.edits + r.comments > 0) return { label: "Client is reviewing", tone: "accent" };
  return { label: "Waiting for the client", tone: "muted" };
}

const TONES = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  muted: "bg-canvas text-muted border border-line",
  accent: "bg-accent-soft text-accent",
  danger: "bg-danger/10 text-danger",
};

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function Section(props: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{props.title}</h2>
          {props.description && <p className="mt-0.5 text-[13px] text-muted">{props.description}</p>}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}
