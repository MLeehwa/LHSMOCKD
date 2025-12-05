"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normalizeBarcode } from "../../lib/barcode";

type Row = { text: string };

export default function MatchPage() {
    const [prefixText, setPrefixText] = useState<string>("2M");
    const [loading, setLoading] = useState<boolean>(true); // Start with true to show loading state
    const [error, setError] = useState<string>("");
    const [expected, setExpected] = useState<Row[]>([]); // from mo_ocr_results
    const [scanned, setScanned] = useState<Row[]>([]);   // from mo_scan_items

    const allowedPrefixes = useMemo(() => prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);
    const include = useCallback((t: string) => {
        const v = normalizeBarcode(t);
        return allowedPrefixes.length === 0 ? true : allowedPrefixes.some(p => v.startsWith(p.toUpperCase()));
    }, [allowedPrefixes]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            // Load expected from mo_ocr_results (no prefix filter needed, we'll filter client-side)
            const expRes = await supabase.from("mo_ocr_results").select("text");
            if (expRes.error) throw expRes.error;
            
            // Load scanned from mo_scan_items with prefix filter (same as SEARCH page)
            const scanRes = await supabase
                .from("mo_scan_items")
                .select("text, matched")
                .eq("prefixes", prefixText);
            if (scanRes.error) throw scanRes.error;
            
            // Normalize and filter expected items
            const normalizedExpected: Row[] = [];
            for (const r of expRes.data ?? []) {
                const normalized = normalizeBarcode(String((r as any).text));
                if (include(normalized)) {
                    normalizedExpected.push({ text: normalized });
                }
            }
            
            // Normalize and filter scanned items (include all scanned items for comparison)
            const normalizedScanned: Row[] = [];
            for (const r of scanRes.data ?? []) {
                const normalized = normalizeBarcode(String((r as any).text));
                if (include(normalized)) {
                    // Include all scanned items (both matched and unmatched) for proper comparison
                    normalizedScanned.push({ text: normalized });
                }
            }
            
            setExpected(normalizedExpected);
            setScanned(normalizedScanned);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [prefixText, include]);

    useEffect(() => { 
        refresh(); 
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh]); // Refresh when prefixText changes

    const expectedSet = useMemo(() => {
        const s = new Set<string>();
        for (const r of expected) {
            s.add(r.text); // Already normalized and filtered in refresh
        }
        return s;
    }, [expected]);
    const scannedSet = useMemo(() => {
        const s = new Set<string>();
        for (const r of scanned) {
            s.add(r.text); // Already normalized and filtered in refresh
        }
        return s;
    }, [scanned]);

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

    const clearScanItems = useCallback(async () => {
        if (!confirm("스캔 데이터(mo_scan_items)를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
        setLoading(true);
        setError("");
        try {
            const { error } = await supabase
                .from("mo_scan_items")
                .delete()
                .gt("id", 0); // delete all rows
            if (error) throw error;
            await refresh(); // Refresh data after clearing
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(`Clear failed: ${msg}`);
        } finally {
            setLoading(false);
        }
    }, [refresh]);

    return (
		<div className="max-w-6xl mx-auto space-y-4">
			<h1 className="text-2xl sm:text-3xl font-semibold">Match</h1>
			<div className="flex items-center gap-3 text-sm">
				<label htmlFor="prefixes" className="text-gray-600">Allowed prefixes</label>
				<input id="prefixes" value={prefixText} onChange={(e)=>setPrefixText(e.target.value)} className="rounded border px-2 py-1" />
				<button onClick={refresh} disabled={loading} className={`rounded px-3 py-2 text-sm ${loading?"bg-gray-300 text-gray-500":"bg-black text-white hover:bg-gray-800"}`}>{loading?"Refreshing...":"Refresh"}</button>
				<button onClick={clearScanItems} disabled={loading} className="rounded px-3 py-2 text-sm bg-red-200 text-red-800 hover:bg-red-300">Clear Scan Data</button>
			</div>

			{error && (
				<div className="rounded border bg-white p-3 text-sm text-red-600">{error}</div>
			)}

			{loading && (
				<div className="rounded border bg-white p-4 text-center text-gray-600">Loading data...</div>
			)}

			{!loading && (
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
			)}
		</div>
    );
}
