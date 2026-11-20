import { useEffect, useState, type AnchorHTMLAttributes } from "react";

/** Minimal history-based router: the panel has a handful of screens. */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event("pt:navigate"));
  window.scrollTo(0, 0);
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const read = () => ({ path: location.pathname, search: new URLSearchParams(location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener("popstate", on);
    window.addEventListener("pt:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("pt:navigate", on);
    };
  }, []);
  return loc;
}

/** Match `/p/:id` style patterns. */
export function match(pattern: string, path: string): Record<string, string> | undefined {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(":")) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return undefined;
  }
  return params;
}

export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { to, onClick, ...rest } = props;
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
