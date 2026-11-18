import { createContext, useContext, type ReactNode } from "react";

export type Lang = "en" | "it";

/**
 * Italian translations, keyed by the English text. Missing entries fall back to English.
 * Placeholders: {name}.
 */
const IT: Record<string, string> = {
  // Library
  "Search clients and demos": "Cerca clienti e demo",
  Settings: "Impostazioni",
  "New demo": "Nuova demo",
  demo: "demo",
  demos: "demo",
  "No demos yet.": "Ancora nessuna demo.",
  "No preview yet": "Nessuna anteprima",
  Brand: "Brand",
  "Add brand": "Aggiungi brand",
  Draft: "Bozza",
  "In client review": "In revisione dal cliente",
  "Feedback received": "Feedback ricevuto",
  Approved: "Approvata",
  Exported: "Esportata",
  "Your demo library is empty": "La tua libreria di demo è vuota",
  "Create a demo from a brief. Claude builds a first version you can preview here, then share with your client for feedback.":
    "Crea una demo da un brief. Claude prepara una prima versione da vedere qui, poi la condividi con il cliente per avere il suo feedback.",
  "Create your first demo": "Crea la tua prima demo",
  "Claude Code unavailable.": "Claude Code non disponibile.",
  // time
  "just now": "adesso",
  "{n} min ago": "{n} min fa",
  "{n} h ago": "{n} h fa",
  "{n} d ago": "{n} g fa",
  // New demo
  Cancel: "Annulla",
  "Creating…": "Creazione…",
  "Create and propose structure": "Crea e proponi la struttura",
  "Create and generate": "Crea e genera",
  Client: "Cliente",
  "+ New client…": "+ Nuovo cliente…",
  "Client name": "Nome del cliente",
  "Client website (optional, used later for brand extraction)": "Sito del cliente (facoltativo, serve per estrarre il brand)",
  "Demo name": "Nome della demo",
  "Content language": "Lingua dei contenuti",
  Pages: "Pagine",
  "Add a page…": "Aggiungi una pagina…",
  Brief: "Brief",
  "Who the client is, who the site is for, what it must achieve, key messages, tone… Paste emails or meeting notes as they are.":
    "Chi è il cliente, a chi si rivolge il sito, cosa deve ottenere, messaggi chiave, tono… Incolla pure email o appunti delle riunioni.",
  "Uses the brand saved for {name}. Edit it from the library (Brand).": "Usa il brand salvato per {name}. Puoi modificarlo dalla libreria (Brand).",
  "Extract the brand from {site} first": "Estrai prima il brand da {site}",
  "Colors, fonts, logo and tone of voice from the client's current site. Adds a couple of minutes.":
    "Colori, font, logo e tono di voce dal sito attuale del cliente. Richiede un paio di minuti in più.",
  "No website for this client: Claude will propose a style from the brief.": "Nessun sito per questo cliente: Claude proporrà uno stile partendo dal brief.",
  "References (optional)": "Riferimenti (facoltativi)",
  "Drop screenshots of pages you like": "Trascina qui screenshot di pagine che ti piacciono",
  "…or websites to capture, separated by spaces: https://a.com https://b.com": "…o siti da catturare, separati da spazi: https://a.com https://b.com",
  "You can add notes to each reference later, in the demo's References tab.": "Puoi aggiungere una nota a ogni riferimento più tardi, nella scheda Riferimenti della demo.",
  "Show me the structure first": "Mostrami prima la struttura",
  "Claude proposes the sitemap and sections; it builds the pages after you approve.": "Claude propone mappa del sito e sezioni; costruisce le pagine dopo la tua approvazione.",
  // Settings
  "Library folder": "Cartella della libreria",
  "Change…": "Cambia…",
  "Plain folders and files; you can open any demo with Claude Code directly.": "Cartelle e file normali: puoi aprire qualsiasi demo direttamente con Claude Code.",
  "Claude Code binary": "Eseguibile di Claude Code",
  "Auto-detect": "Rilevamento automatico",
  Check: "Verifica",
  "Isolate Claude from your global configuration": "Isola Claude dalla tua configurazione globale",
  "Runs ignore your user-level Claude Code settings, hooks, plugins and MCP servers, for more predictable results. Your login is unaffected.":
    "Le esecuzioni ignorano impostazioni, hook, plugin e server MCP del tuo Claude Code, per risultati più prevedibili. Il login non cambia.",
  Model: "Modello",
  "Claude Code default": "Predefinito di Claude Code",
  "Haiku (fast, for quick tests)": "Haiku (veloce, per prove rapide)",
  "Interface language": "Lingua dell'interfaccia",
  "Same as system": "Come il sistema",
  Done: "Fatto",
  "Share domains": "Domini di condivisione",
  "Prototyper share servers where demos are published for clients. Each demo picks one. Admin tokens are stored in the macOS keychain.":
    "I server di condivisione dove pubblichi le demo per i clienti. Ogni demo ne usa uno. I token admin sono salvati nel portachiavi di macOS.",
  Test: "Prova",
  Edit: "Modifica",
  Remove: "Rimuovi",
  "Testing…": "Verifica…",
  "✓ Connected": "✓ Connesso",
  "Name (e.g. Preview)": "Nome (es. Preview)",
  "Admin token (leave empty to keep the current one)": "Token admin (lascia vuoto per mantenere quello attuale)",
  "Admin token": "Token admin",
  Save: "Salva",
  "Add share domain": "Aggiungi dominio",
  // Workspace
  "← Library": "← Libreria",
  "unsaved changes": "modifiche non salvate",
  Desktop: "Desktop",
  Tablet: "Tablet",
  Mobile: "Mobile",
  Browser: "Browser",
  Folder: "Cartella",
  Terminal: "Terminale",
  "Continue this demo's Claude session in Terminal": "Continua la sessione Claude di questa demo nel Terminale",
  Export: "Esporta",
  "Save version": "Salva versione",
  Share: "Condividi",
  Shared: "Condivisa",
  Claude: "Claude",
  References: "Riferimenti",
  Versions: "Versioni",
  Checks: "Controlli",
  "Sent by {name} on v{n}": "{name} ha inviato il feedback sulla v{n}",
  "{name} sent feedback on v{n}": "{name} ha inviato il feedback sulla v{n}",
  "The client": "Il cliente",
  "The client is reviewing v{n}": "Il cliente sta rivedendo la v{n}",
  "{n} edits": "{n} modifiche",
  "{n} edit": "{n} modifica",
  "{n} notes": "{n} note",
  "{n} note": "{n} nota",
  "Review feedback": "Rivedi il feedback",
  "Claude is building the first version": "Claude sta costruendo la prima versione",
  "This usually takes a few minutes. Follow along in the panel on the right.": "Di solito servono alcuni minuti. Puoi seguire i progressi nel pannello a destra.",
  "Structure ready for review": "Struttura pronta da rivedere",
  "Approve it in the Claude panel, with any changes, to build the pages.": "Approvala nel pannello di Claude, con eventuali modifiche, per costruire le pagine.",
  "No pages yet": "Ancora nessuna pagina",
  "Generate the site from the brief, or describe what you want in the Claude panel.": "Genera il sito dal brief, oppure descrivi cosa vuoi nel pannello di Claude.",
  "Generate site": "Genera il sito",
  'Ask Claude for changes: "make the hero more minimal", "add a pricing section"…': "Chiedi modifiche a Claude: «rendi la hero più essenziale», «aggiungi una sezione prezzi»…",
  "Approve this structure?": "Approvi questa struttura?",
  "Optional changes: add a FAQ to Home, merge About and Team…": "Modifiche facoltative: aggiungi le FAQ in Home, unisci Chi siamo e Team…",
  "Approve and build pages": "Approva e costruisci le pagine",
  "Claude is working…": "Claude sta lavorando…",
  "Describe a change…  (⌘↵ to send)": "Descrivi una modifica…  (⌘↵ per inviare)",
  Stop: "Ferma",
  Send: "Invia",
  "Proposed structure": "Struttura proposta",
  "Failed: {text}": "Non riuscito: {text}",
  "✓ Content contract OK": "✓ Contratto dei contenuti OK",
  "Checks: {e} error(s), {w} warning(s)": "Controlli: {e} errori, {w} avvisi",
  "Saved as v{n}": "Salvata come v{n}",
  "Published v{n} for client review": "Pubblicata la v{n} per la revisione del cliente",
  "Imported client feedback on v{v}: {e} edit(s) applied, {n} note(s) for Claude": "Importato il feedback sulla v{v}: {e} modifiche applicate, {n} note per Claude",
  "Exported the static site: {path}": "Esportato il sito statico: {path}",
  "Exported the handoff pack: {path}": "Esportato il pacchetto per gli sviluppatori: {path}",
  "No versions yet. The first one is saved when the site is generated.": "Ancora nessuna versione. La prima viene salvata quando il sito è generato.",
  "Every text and image must carry a {attr} key, so the client can edit it.": "Ogni testo e immagine deve avere una chiave {attr}, così il cliente può modificarlo.",
  "✓ No problems found.": "✓ Nessun problema.",
  "{e} error(s), {w} warning(s)": "{e} errori, {w} avvisi",
  "Save as v{n}": "Salva come v{n}",
  "What changed (optional)": "Cosa è cambiato (facoltativo)",
  "New hero, pricing section": "Nuova hero, sezione prezzi",
  "Starting Claude…": "Avvio di Claude…",
  "Applying client feedback…": "Applicazione del feedback del cliente…",
  "Exporting…": "Esportazione…",
  // References
  "Images Claude looks at when building or changing the demo. Say what to take from each one.": "Immagini che Claude guarda quando costruisce o modifica la demo. Indica cosa prendere da ognuna.",
  "Drop screenshots here": "Trascina qui gli screenshot",
  "or paste an image (⌘V)": "oppure incolla un'immagine (⌘V)",
  Capture: "Cattura",
  "Capturing {url}…": "Cattura di {url}…",
  "Adding images…": "Aggiunta immagini…",
  "Adding pasted image…": "Aggiunta dell'immagine incollata…",
  "Removing…": "Rimozione…",
  "What to take from it: “this hero layout”, “colors no, typography yes”…": "Cosa prendere: «il layout di questa hero», «colori no, tipografia sì»…",
  // Share
  "Share with the client": "Condividi con il cliente",
  Close: "Chiudi",
  "Client link": "Link per il cliente",
  Copy: "Copia",
  Copied: "Copiato",
  Open: "Apri",
  "v{n} published {ago} on {domain}.": "v{n} pubblicata {ago} su {domain}.",
  "an unknown domain": "un dominio sconosciuto",
  " Read-only: the client can look but not change anything.": " Sola lettura: il cliente può guardare ma non modificare.",
  " Revoked: the link no longer works.": " Revocato: il link non funziona più.",
  "Round for v{n}": "Giro sulla v{n}",
  "Client reviewing": "Revisione in corso",
  "Feedback submitted": "Feedback inviato",
  "Feedback imported": "Feedback importato",
  " · sent by {name} {ago}": " · inviato da {name} {ago}",
  "the client": "il cliente",
  "Share domain": "Dominio di condivisione",
  "Add a share domain in Settings first.": "Prima aggiungi un dominio di condivisione nelle Impostazioni.",
  "There are changes after {v}. Save a version to publish them.": "Ci sono modifiche dopo la {v}. Salva una versione per pubblicarle.",
  "the last version": "l'ultima versione",
  "Publishing…": "Pubblicazione…",
  "Publish v{n} on the same link": "Pubblica la v{n} sullo stesso link",
  "Publish v{n} and copy link": "Pubblica la v{n} e copia il link",
  "The client keeps the same link and sees what changed in v{n}.": "Il cliente mantiene lo stesso link e vede cosa è cambiato nella v{n}.",
  "Reopen for edits": "Riapri alle modifiche",
  "Make read-only": "Metti in sola lettura",
  "Revoke link": "Revoca il link",
  // Feedback
  "Client feedback on v{n}": "Feedback del cliente sulla v{n}",
  "Client feedback": "Feedback del cliente",
  "Apply edits only": "Applica solo le modifiche",
  "Apply the accepted edits to the demo without asking Claude": "Applica le modifiche accettate alla demo senza coinvolgere Claude",
  "Starting…": "Avvio…",
  "Apply and generate v{n}": "Applica e genera la v{n}",
  "Downloading feedback and preparing screenshots…": "Download del feedback e preparazione degli screenshot…",
  "Sent by {name} {ago}.": "Inviato da {name} {ago}.",
  "The client has not pressed “I'm done” yet: applying now closes the round, and later changes on this version will be lost.":
    "Il cliente non ha ancora premuto «Ho finito»: applicando ora il giro si chiude, e le modifiche successive su questa versione andranno perse.",
  "Accepted edits are written into the pages as they are; accepted notes go to Claude. The client's link is closed for edits while you work on the next version.":
    "Le modifiche accettate vengono scritte nelle pagine così come sono; le note accettate vanno a Claude. Il link del cliente resta chiuso alle modifiche mentre lavori alla prossima versione.",
  "No edits or notes in this round.": "Nessuna modifica o nota in questo giro.",
  "Direct edits": "Modifiche dirette",
  "{a} of {b} accepted": "{a} di {b} accettate",
  "Notes for Claude": "Note per Claude",
  "{a} of {b} included": "{a} di {b} incluse",
  "on {context}": "su {context}",
  "Your instructions for v{n} (optional, they take priority over the notes)": "Le tue istruzioni per la v{n} (facoltative, hanno la precedenza sulle note)",
  "e.g. keep the hero as it is; the client confirmed by phone they want a FAQ section": "es. lascia la hero com'è; il cliente ha confermato al telefono che vuole una sezione FAQ",
  // Brand
  "Brand — {name}": "Brand — {name}",
  "Save changes": "Salva le modifiche",
  "Client website": "Sito del cliente",
  "Extracting…": "Estrazione…",
  "Extract again": "Estrai di nuovo",
  "Extract brand": "Estrai il brand",
  "Reads the home page and up to three inner pages: colors, fonts, buttons, logo, tone of voice and screenshots. Claude turns them into guidelines. Takes a couple of minutes.":
    "Legge la home e fino a tre pagine interne: colori, font, pulsanti, logo, tono di voce e screenshot. Claude li trasforma in linee guida. Richiede un paio di minuti.",
  " Last extracted {ago}.": " Ultima estrazione {ago}.",
  Colors: "Colori",
  Primary: "Primario",
  "Text on primary": "Testo sul primario",
  Accent: "Accento",
  Text: "Testo",
  "Muted text": "Testo secondario",
  Background: "Sfondo",
  "Alt background": "Sfondo alternativo",
  Lines: "Linee",
  "Heading font": "Font dei titoli",
  "Body font": "Font del testo",
  "Corner radius": "Raggio degli angoli",
  Preview: "Anteprima",
  "Guidelines (BRAND.md) — Claude follows these when building demos": "Linee guida (BRAND.md): Claude le segue quando costruisce le demo",
  Screenshots: "Screenshot",
  "No brand yet. Extract it from the client's website, or create demos without one: Claude will propose a style.":
    "Ancora nessun brand. Estrailo dal sito del cliente, oppure crea demo senza: Claude proporrà uno stile.",
  "The extraction did not complete. See the log above.": "L'estrazione non è stata completata. Vedi il registro qui sopra.",
  "A headline in the brand": "Un titolo nel brand",
  "Body copy in the brand font, with ": "Testo nel font del brand, con ",
  "an accent": "un accento",
  "Primary button": "Pulsante primario",
  // Export
  "There are changes after v{n}: the export includes them. Save a version first if the client hasn't seen them.":
    "Ci sono modifiche dopo la v{n}: l'export le include. Salva prima una versione se il cliente non le ha viste.",
  "Developer handoff pack": "Pacchetto per gli sviluppatori",
  "The prototype plus everything needed to start the real project: approved copy (content.json), brand and tokens, review history, CLAUDE.md.":
    "Il prototipo più tutto il necessario per avviare il progetto vero: testi approvati (content.json), brand e token, storico delle revisioni, CLAUDE.md.",
  "Static site": "Sito statico",
  "The prototype as plain HTML, CSS and images, ready to host anywhere.": "Il prototipo in HTML, CSS e immagini, pronto da pubblicare ovunque.",
  "Remove the {attr} attributes from the HTML": "Rimuovi gli attributi {attr} dall'HTML",
  "They are only needed for client editing. content.json keeps the keys either way.": "Servono solo per le modifiche del cliente. content.json mantiene comunque le chiavi.",
  "Ask Claude to write HANDOFF.md": "Chiedi a Claude di scrivere HANDOFF.md",
  "Sitemap, sections, components, open content, integrations and a stack suggestion. Takes a minute or two.":
    "Mappa del sito, sezioni, componenti, contenuti da completare, integrazioni e uno stack consigliato. Richiede un paio di minuti.",
  "Export…": "Esporta…",
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, it: IT };

export function detectLang(setting: "auto" | "en" | "it" | undefined): Lang {
  if (setting === "en" || setting === "it") return setting;
  return navigator.language.toLowerCase().startsWith("it") ? "it" : "en";
}

export type T = (text: string, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): T {
  const dict = DICTS[lang];
  return (text, vars) => {
    let out = dict[text] ?? text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  };
}

const I18nContext = createContext<{ lang: Lang; t: T }>({ lang: "en", t: makeT("en") });

export function I18nProvider(props: { lang: Lang; children: ReactNode }) {
  return <I18nContext.Provider value={{ lang: props.lang, t: makeT(props.lang) }}>{props.children}</I18nContext.Provider>;
}

export function useT(): T {
  return useContext(I18nContext).t;
}

export function useLang(): Lang {
  return useContext(I18nContext).lang;
}
