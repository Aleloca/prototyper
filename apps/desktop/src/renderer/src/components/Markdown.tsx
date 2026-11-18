/** Minimal Markdown for Claude's messages: headings, bullets, **bold**, `code`. No HTML is injected. */
export function Markdownish({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
        <code key={i} className="rounded bg-black/5 px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
  return (
    <div className="flex flex-col gap-1 leading-relaxed">
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1" />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) return <p key={i} className="mt-1 font-semibold">{inline(heading[1]!)}</p>;
        const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2" style={{ paddingLeft: bullet[1]!.length * 6 }}>
              <span className="text-faint">•</span>
              <span>{inline(bullet[2]!)}</span>
            </div>
          );
        }
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
