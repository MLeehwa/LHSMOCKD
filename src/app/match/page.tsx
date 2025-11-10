"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Row = { text: string };

export default function MatchPage() {
    const [prefixText, setPrefixText] = useState<string>("2M");
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const [expected, setExpected] = useState<Row[]>([]); // from mo_ocr_results
    const [scanned, setScanned] = useState<Row[]>([]);   // from mo_scan_items

    const allowedPrefixes = useMemo(() => prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);
    const normalize = useCallback((t: string) => String(t ?? "").trim().toUpperCase(), []);
    const include = useCallback((t: string) => {
        const v = normalize(t);
        return allowedPrefixes.length === 0 ? true : allowedPrefixes.some(p => v.startsWith(p.toUpperCase()));
    }, [allowedPrefixes, normalize]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [expRes, scanRes] = await Promise.all([
                supabase.from("mo_ocr_results").select("text"),
                supabase.from("mo_scan_items").select("text")
            ]);
            if (expRes.error) throw expRes.error;
            if (scanRes.error) throw scanRes.error;
            setExpected((expRes.data ?? []).map(r => ({ text: String((r as any).text) })));
            setScanned((scanRes.data ?? []).map(r => ({ text: String((r as any).text) })));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const expectedSet = useMemo(() => {
        const s = new Set<string>();
        for (const r of expected) {
            const v = normalize(r.text);
            if (include(v)) s.add(v);
        }
        return s;
    }, [expected, include, normalize]);
    const scannedSet = useMemo(() => {
        const s = new Set<string>();
        for (const r of scanned) {
            const v = normalize(r.text);
            if (include(v)) s.add(v);
        }
        return s;
    }, [scanned, include, normalize]);

    const matched = useMemo(() => [...expectedSet].filter(t => scannedSet.has(t)), [expectedSet, scannedSet]);
    const missing = useMemo(() => [...expectedSet].filter(t => !scannedSet.has(t)), [expectedSet, scannedSet]);
    const unexpected = useMemo(() => [...scannedSet].filter(t => !expectedSet.has(t)), [expectedSet, scannedSet]);

    const downloadCsv = useCallback((filename: string, rows: string[]) => {
        const header = "barcode\n";
        const body = [...rows].sort().join("\n");
        const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    return (
		<div className="max-w-6xl mx-auto space-y-4">
			<h1 className="text-2xl font-semibold">Match</h1>
			<div className="flex items-center gap-3 text-sm">
				<label htmlFor="prefixes" className="text-gray-600">Allowed prefixes</label>
				<input id="prefixes" value={prefixText} onChange={(e)=>setPrefixText(e.target.value)} className="rounded border px-2 py-1" />
				<button onClick={refresh} disabled={loading} className={`rounded px-3 py-2 text-sm ${loading?"bg-gray-300 text-gray-500":"bg-black text-white hover:bg-gray-800"}`}>{loading?"Refreshing...":"Refresh"}</button>
			</div>

			{error && (
				<div className="rounded border bg-white p-3 text-sm text-red-600">{error}</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="rounded border bg-white p-4">
					<h2 className="font-medium mb-2">Overview</h2>
					<ul className="space-y-1 text-sm text-gray-700">
						<li>Total expected (DB): <span className="font-semibold">{expectedSet.size}</span></li>
						<li>Scanned: <span className="font-semibold">{scannedSet.size}</span></li>
						<li>Matched: <span className="font-semibold text-emerald-700">{matched.length}</span></li>
						<li>Missing: <span className="font-semibold text-amber-700">{missing.length}</span></li>
						<li>Unexpected: <span className="font-semibold text-rose-700">{unexpected.length}</span></li>
					</ul>
				</div>
				<div className="rounded border bg-white p-4">
					<div className="flex items-center justify-between mb-2">
						<h2 className="font-medium">Missing ({missing.length})</h2>
						<button onClick={()=>downloadCsv("missing.csv", missing)} className="rounded bg-amber-600 px-2 py-1 text-white text-xs hover:bg-amber-700">Download CSV</button>
					</div>
					<ul className="space-y-1 max-h-96 overflow-auto">
						{missing.map((t)=> (
							<li key={t} className="rounded border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-mono text-gray-900">{t}</li>
						))}
					</ul>
				</div>
				<div className="rounded border bg-white p-4">
					<div className="flex items-center justify-between mb-2">
						<h2 className="font-medium">Unexpected ({unexpected.length})</h2>
						<button onClick={()=>downloadCsv("unexpected.csv", unexpected)} className="rounded bg-rose-600 px-2 py-1 text-white text-xs hover:bg-rose-700">Download CSV</button>
					</div>
					<ul className="space-y-1 max-h-96 overflow-auto">
						{unexpected.map((t)=> (
							<li key={t} className="rounded border border-rose-200 bg-rose-50 px-3 py-1 text-sm font-mono text-gray-900">{t}</li>
						))}
					</ul>
				</div>
			</div>
		</div>
    );
}
