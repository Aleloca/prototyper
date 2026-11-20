import { useState, type ReactNode } from "react";
import { copy } from "../format";
import { useT } from "../i18n";
import type { ProjectSummary } from "../api";
import { clientCode, spotFor } from "../swatch";
import { Check, Copy } from "./icons";

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-ink ${className}`} role="status" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner />
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] font-medium text-danger">
      {children}
    </p>
  ) : null;
}

export function CopyButton({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${className}`}
      onClick={() =>
        void copy(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        })
      }
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{done ? t("Copied") : (label ?? t("Copy"))}</span>
    </button>
  );
}

// --- review states, as printed marks -------------------------------------------------------

export type MarkKind = "attention" | "reviewing" | "waiting" | "done" | "off" | "none";

/** Where the review stands, in the team's words, with the mark that prints it. */
export function roundState(p: Pick<ProjectSummary, "shareStatus" | "round">): { label: string; mark: MarkKind } {
  if (p.shareStatus === "revoked") return { label: "Link disabled", mark: "off" };
  const r = p.round;
  if (!r) return { label: "Not published", mark: "none" };
  if (r.status === "submitted") return { label: "Feedback to import", mark: "attention" };
  if (r.status === "imported") return { label: "Feedback imported", mark: "done" };
  if (r.edits + r.comments > 0) return { label: "Client is reviewing", mark: "reviewing" };
  return { label: "Waiting for the client", mark: "waiting" };
}

const MARK_TEXT: Record<MarkKind, string> = {
  attention: "text-attention",
  reviewing: "text-reviewing",
  waiting: "text-ink",
  done: "text-done",
  off: "text-faint",
  none: "text-faint",
};

/** Filled = needs you; half = client at work; ring = waiting; check = done; struck = off. */
export function Mark({ kind, className = "" }: { kind: MarkKind; className?: string }) {
  const c = `size-[11px] shrink-0 ${MARK_TEXT[kind]} ${className}`;
  switch (kind) {
    case "attention":
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "reviewing":
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 .75a5.25 5.25 0 0 1 0 10.5Z" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.6 6.2 5.3 7.8 8.5 4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "off":
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1.5 10.5 10.5 1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "none":
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 12 12" className={c} aria-hidden>
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

/** A state as the label strip prints it: mark plus caps. */
export function StateLabel({ kind, children, className = "" }: { kind: MarkKind; children: ReactNode; className?: string }) {
  return (
    <span className={`caps inline-flex items-center gap-2 ${MARK_TEXT[kind]} ${kind === "off" ? "line-through decoration-[1.5px]" : ""} ${className}`}>
      <Mark kind={kind} />
      {children}
    </span>
  );
}

/** Small square chip of a client's spot colour. */
export function ClientChip({ swatch, size = 14 }: { swatch: number | null | undefined; size?: number }) {
  const s = spotFor(swatch);
  return <span aria-hidden className="inline-block shrink-0 rounded-[2px]" style={{ width: size, height: size, background: s.bg, boxShadow: "inset 0 0 0 1px rgb(21 21 21 / .08)" }} />;
}

/** The swatch code printed on chips: client code plus the project's number for that client. */
export function swatchCode(clientName: string | null | undefined, n: number | undefined): string {
  return `${clientCode(clientName)}·${String(n ?? 1).padStart(3, "0")}`;
}

/** The four-chip mark of Prototyper. */
export function Logo({ size = 22 }: { size?: number }) {
  const q = (size - 2) / 2;
  return (
    <span aria-hidden className="inline-grid shrink-0 grid-cols-2 gap-[2px]" style={{ width: size, height: size }}>
      {["#C84C28", "#F2C14E", "#2B7DA0", "#32835A"].map((c) => (
        <span key={c} className="rounded-[1.5px]" style={{ width: q, height: q, background: c }} />
      ))}
    </span>
  );
}

export function Section(props: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="sheet p-6" aria-labelledby={props.id}>
      <div className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 id={props.id} className="text-[16px] font-bold tracking-[-0.01em]">
            {props.title}
          </h2>
          {props.description && <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted">{props.description}</p>}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function PageTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">{title}</h1>
      {children && <div className="mt-1.5 text-[14px] text-muted">{children}</div>}
    </div>
  );
}

const TAG_TONES = {
  ink: "bg-ink text-white",
  neutral: "bg-wash text-ink-2",
  done: "bg-done-wash text-done",
  attention: "bg-attention-wash text-attention",
  reviewing: "bg-reviewing-wash text-reviewing",
  danger: "bg-danger-wash text-danger",
};

/** A small printed tag: role or status words (Admin, 2FA, Invite pending). */
export function Tag({ tone = "neutral", children }: { tone?: keyof typeof TAG_TONES; children: ReactNode }) {
  return <span className={`caps inline-flex h-[22px] items-center rounded-[2px] px-1.5 text-[11px] ${TAG_TONES[tone]}`}>{children}</span>;
}
