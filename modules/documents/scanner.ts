/**
 * Malware / active-content scanning behind an interface. The built-in scanner
 * blocks the EICAR test signature and PDFs with active content (JavaScript,
 * launch actions, embedded files). Production deployments should plug in an
 * antivirus engine (e.g. ClamAV via the "document.scan" job) behind this interface.
 */
export type ScanVerdict = { status: "clean" } | { status: "infected"; reason: string };

export interface Scanner {
  scan(bytes: Uint8Array, kind: "pdf" | "png" | "jpg"): Promise<ScanVerdict>;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|OpenAction\s*<<[^>]*\/S\s*\/JavaScript)\b/;

export const basicScanner: Scanner = {
  async scan(bytes, kind) {
    const text = Buffer.from(bytes).toString("latin1");
    if (text.includes(EICAR)) return { status: "infected", reason: "Malware test signature detected." };
    if (kind === "pdf" && PDF_ACTIVE.test(text)) return { status: "infected", reason: "PDF contains active content (scripts, launch actions or embedded files)." };
    return { status: "clean" };
  },
};
