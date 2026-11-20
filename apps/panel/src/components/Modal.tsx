import { useEffect, useRef, type ReactNode } from "react";
import { X } from "./icons";

/** A native <dialog>: focus is trapped and restored by the browser, Esc closes. */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener("cancel", onCancel);
    return () => d?.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={props.title}
      className={`m-auto w-[calc(100%-32px)] rounded-[6px] bg-stock p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/30 ${props.width ?? "max-w-lg"}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-6 py-4">
        <h2 className="flex-1 text-[16px] font-bold tracking-[-0.01em]">{props.title}</h2>
        <button type="button" className="btn btn-ghost btn-sm -mr-2 px-2" aria-label="Close" onClick={onClose}>
          <X aria-hidden />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{props.children}</div>
      {props.footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-paper px-6 py-4">{props.footer}</div>}
    </dialog>
  );
}
