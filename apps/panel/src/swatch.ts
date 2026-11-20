/**
 * Client spot colours: every client keeps the same chip everywhere in the panel.
 * The colour identifies the client; it never encodes a review state.
 */
export interface Spot {
  name: string;
  bg: string;
  /** Text on the chip: ink or white, whichever reads. */
  fg: string;
  /** Secondary text on the chip (full strength: every spot passes AA with it). */
  fg2: string;
}

const SPOTS: Spot[] = [
  { name: "Warm Red", bg: "#C84C28", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Process Blue", bg: "#2B7DA0", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Yellow", bg: "#F2C14E", fg: "#151515", fg2: "#151515" },
  { name: "Green", bg: "#32835A", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Violet", bg: "#6E56A8", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Rhodamine", bg: "#C94279", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Teal", bg: "#138378", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Orange", bg: "#F28C28", fg: "#151515", fg2: "#151515" },
  { name: "Navy", bg: "#2B3A67", fg: "#FFFFFF", fg2: "#FFFFFF" },
  { name: "Olive", bg: "#6E7B2F", fg: "#FFFFFF", fg2: "#FFFFFF" },
];

const NEUTRAL: Spot = { name: "Neutral", bg: "#D6D5CD", fg: "#151515", fg2: "#151515" };

/** The client's spot, by the palette index the server assigned (distinct within a workspace). */
export function spotFor(swatch: number | undefined | null): Spot {
  return swatch === undefined || swatch === null ? NEUTRAL : SPOTS[((swatch % SPOTS.length) + SPOTS.length) % SPOTS.length]!;
}
/** Two-letter client code: "Officina Verdi" → "OV", "Acme" → "AC". */
export function clientCode(name: string | undefined | null): string {
  const words = (name ?? "").normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  const code = words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2);
  return code.toUpperCase();
}
