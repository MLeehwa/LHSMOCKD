"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normalizeBarcode } from "../../lib/barcode";

type ScanItem = { text: string };

export default function ScanPage() {
    const [prefixText, setPrefixText] = useState<string>("2M");
    const [autoUpload, setAutoUpload] = useState<boolean>(false);
    const [matched, setMatched] = useState<ScanItem[]>([]);
    const [unmatched, setUnmatched] = useState<ScanItem[]>([]);
    const [status, setStatus] = useState<string>("");
    const [uploading, setUploading] = useState<boolean>(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [currentCode, setCurrentCode] = useState<string>("");
    const [autoSubmit, setAutoSubmit] = useState<boolean>(true);
    const [submitDelayMs, setSubmitDelayMs] = useState<number>(200);
    const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expectedCacheRef = useRef<Set<string>>(new Set());
    const seenRef = useRef<Set<string>>(new Set());

    const allowedPrefixes = useCallback(() =>
        prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);

    const shouldInclude = useCallback((text: string) => {
        const p = allowedPrefixes();
        if (p.length === 0) return true;
        return p.some(pref => text.startsWith(pref));
    }, [allowedPrefixes]);

    const addItem = useCallback(async (text: string) => {
        const normalized = normalizeBarcode(text);
        if (!shouldInclude(normalized)) return;
        if (seenRef.current.has(normalized)) return;
        seenRef.current.add(normalized);
        // Fast path: local cache lookup (no network)
        const exists = expectedCacheRef.current.has(normalized);
        if (exists) {
            setMatched(prev => [...prev, { text: normalized }]);
        } else {
            setUnmatched(prev => [...prev, { text: normalized }]);
        }

        if (autoUpload) {
            try {
                await supabase.from("mo_ocr_results").upsert(
                    [{ text: normalized, prefixes: prefixText, confidence: 0 }],
                    { onConflict: "text" }
                );
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setStatus(`Auto-upload failed: ${msg}`);
            }
        }
    }, [autoUpload, prefixText, shouldInclude]);

    // Focus input for hardware barcode scanners (keyboard wedge)
    useEffect(() => {
        inputRef.current?.focus();
        const onFocus = () => inputRef.current?.focus();
        window.addEventListener("click", onFocus);
        return () => window.removeEventListener("click", onFocus);
    }, []);

    // No session handling – items will be saved standalone

    const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        const key = e.key;
        if (key === "Enter") {
            const code = currentCode;
            setCurrentCode("");
            if (code.length > 0) addItem(code);
            e.preventDefault();
            return;
        }
    }, [addItem, currentCode]);

    // Auto submit when typing stops (for scanners that don't send Enter)
    useEffect(() => {
        if (!autoSubmit) return;
        if (!currentCode) return;
        if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
        submitTimerRef.current = setTimeout(() => {
            const code = currentCode;
            setCurrentCode("");
            if (code.length > 0) addItem(code);
        }, Math.max(100, submitDelayMs));
        return () => {
            if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
        };
    }, [autoSubmit, submitDelayMs, currentCode, addItem]);

    // Load expected cache from DB once (and provide a manual refresh)
    const loadExpectedCache = useCallback(async () => {
        try {
            const { data, error } = await supabase.from("mo_ocr_results").select("text");
            if (error) throw error;
            const set = new Set<string>();
            for (const r of data ?? []) set.add(normalizeBarcode((r as any).text));
            expectedCacheRef.current = set;
            setStatus(`Expected list loaded: ${set.size}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Load expected failed: ${msg}`);
        }
    }, []);

    useEffect(() => { void loadExpectedCache(); }, [loadExpectedCache]);

    const uploadBatch = useCallback(async () => {
        const items = [...matched, ...unmatched];
        if (items.length === 0) return;
        setUploading(true);
        try {
            // Save items into mo_scan_items with matched flag
            const seen = new Set<string>();
            const payload = items.filter(i => {
                if (seen.has(i.text)) return false;
                seen.add(i.text);
                return true;
            }).map(i => ({ text: i.text, prefixes: prefixText, matched: matched.some(m => m.text === i.text) }));

            const { error } = await supabase
                .from("mo_scan_items")
                .upsert(payload, { onConflict: "text" });
            if (error) throw error;
            setStatus("Uploaded batch");
            // Clear UI lists after successful save (DB remains)
            setMatched([]);
            setUnmatched([]);
            seenRef.current.clear();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Upload failed: ${msg}`);
        } finally {
            setUploading(false);
        }
    }, [matched, unmatched, prefixText]);

    const clearList = useCallback(() => {
        seenRef.current.clear();
        setMatched([]);
        setUnmatched([]);
    }, []);

    return (
		<div className="max-w-5xl mx-auto space-y-4">
			<h1 className="text-2xl font-semibold">Scan</h1>
			{status && (
				<div className="rounded border bg-white p-3 text-sm text-gray-700">{status}</div>
			)}
			<div className="flex items-center gap-3 text-sm">
				<label htmlFor="prefixes" className="text-gray-600">Allowed prefixes</label>
				<input
					id="prefixes"
					value={prefixText}
					onChange={(e) => setPrefixText(e.target.value)}
					className="rounded border px-2 py-1"
				/>
                <label className="flex items-center gap-2 text-gray-600">
					<input type="checkbox" checked={autoUpload} onChange={(e) => setAutoUpload(e.target.checked)} />
					<span>Auto upload</span>
				</label>
                <button onClick={loadExpectedCache} className="rounded px-3 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700">Refresh expected</button>
                <label className="flex items-center gap-2 text-gray-600">
                    <input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} />
                    <span>Auto submit (no Enter)</span>
                </label>
                <input
                    type="number"
                    value={submitDelayMs}
                    onChange={(e) => setSubmitDelayMs(Number(e.target.value) || 200)}
                    className="w-20 rounded border px-2 py-1"
                    title="Auto submit delay (ms)"
                />
                <button onClick={uploadBatch} disabled={(matched.length+unmatched.length)===0 || uploading} className={`rounded px-3 py-2 text-sm ${(matched.length+unmatched.length)===0 || uploading ? "bg-gray-300 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>{uploading?"Saving...":"Save"}</button>
				<button onClick={clearList} className="rounded px-3 py-2 text-sm bg-gray-200 text-gray-800 hover:bg-gray-300">Clear list</button>
			</div>

            <div className="rounded border bg-gray-50 p-3">
                <label className="block text-sm text-gray-800 mb-1">Barcode</label>
                <input
                    ref={inputRef}
                    value={currentCode}
                    onChange={(e) => setCurrentCode(e.target.value)}
                    onKeyDown={handleKey}
                className="w-full rounded border px-3 py-2 font-mono text-gray-900 placeholder-gray-500 bg-amber-50 border-amber-300 focus:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Focus here and scan..."
                />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded border bg-white p-3">
                    <h2 className="mb-2 font-medium">Matched ({matched.length})</h2>
                    <ul className="space-y-2">
                        {matched.map((it, idx) => (
                            <li key={idx} className="rounded border px-3 py-2 text-sm font-mono bg-emerald-50 text-gray-900 border-emerald-200">{it.text}</li>
                        ))}
                    </ul>
                </div>
                <div className="rounded border bg-white p-3">
                    <h2 className="mb-2 font-medium">Unmatched ({unmatched.length})</h2>
                    <ul className="space-y-2">
                        {unmatched.map((it, idx) => (
                            <li key={idx} className="rounded border px-3 py-2 text-sm font-mono bg-amber-50 text-gray-900 border-amber-200">{it.text}</li>
                        ))}
                    </ul>
                </div>
            </div>
		</div>
    );
}
