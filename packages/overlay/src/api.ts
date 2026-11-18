export type Kind = "text" | "rich" | "image" | "link" | "bg";

export type Value =
  | { kind: "text"; text: string }
  | { kind: "rich"; html: string }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "bg"; src: string };

export interface Anchor {
  key?: string;
  selector?: string;
  /** Position inside the anchor element, as fractions of its box. */
  x: number;
  y: number;
  viewportWidth?: number;
}

export interface Comment {
  id: string;
  page: string;
  anchor: Anchor;
  text: string;
  author: string;
  status: "open" | "resolved" | "answered";
  reply: string | null;
  createdAt: string;
}

export interface State {
  editable: boolean;
  shareStatus: "open" | "readonly" | "revoked";
  version: { number: number; changelog: string; publishedAt: string };
  round: { id: number; status: "open" | "submitted" | "imported"; submittedAt: string | null };
  edits: { key: string; page: string; value: Value; author: string; updatedAt: string }[];
  originals: Record<string, Value | null>;
  comments: Comment[];
  previousComments: Comment[];
}

export class Api {
  constructor(private readonly base: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  state = () => this.req<State>("GET", "/state");
  putEdit = (key: string, value: Value, page: string, author: string) =>
    this.req<{ value: Value }>("PUT", `/edits/${encodeURIComponent(key)}`, { value, page, author });
  deleteEdit = (key: string, author: string) =>
    this.req<unknown>("DELETE", `/edits/${encodeURIComponent(key)}?author=${encodeURIComponent(author)}`);
  upload = (key: string, file: Blob) => {
    const form = new FormData();
    form.append("key", key);
    form.append("file", file, "image");
    return this.req<{ id: string; src: string }>("POST", "/uploads", form);
  };
  addComment = (page: string, anchor: Anchor, text: string, author: string) =>
    this.req<Comment>("POST", "/comments", { page, anchor, text, author });
  updateComment = (id: string, text: string) => this.req<Comment>("PATCH", `/comments/${id}`, { text });
  deleteComment = (id: string) => this.req<unknown>("DELETE", `/comments/${id}`);
  submit = (author: string) => this.req<unknown>("POST", "/submit", { author });
}
