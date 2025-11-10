// Normalize barcodes consistently across OCR, Scan, and Match flows
// - trims whitespace
// - uppercases letters
// - removes hyphens and spaces
// - optionally could restrict to [A-Z0-9] only; for now strip non-printing
export function normalizeBarcode(text: string): string {
	if (!text) return "";
	const trimmed = String(text).trim();
	// Remove zero-width and control chars
	const cleaned = trimmed.replace(/[\u200B-\u200D\uFEFF]/g, "");
	// Drop spaces and hyphens which often appear inconsistently
	const noSep = cleaned.replace(/[\s-]+/g, "");
	return noSep.toUpperCase();
}


