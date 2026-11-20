import { useEffect, type ReactNode } from "react";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className={`flex max-h-full w-full flex-col rounded-xl border border-line bg-panel shadow-xl ${props.width ?? "max-w-lg"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">{props.title}</div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{props.children}</div>
        {props.footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{props.footer}</div>}
      </div>
    </div>
  );
}
