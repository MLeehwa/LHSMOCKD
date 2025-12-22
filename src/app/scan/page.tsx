"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normalizeBarcode } from "../../lib/barcode";

type ScanItem = { text: string };

export default function ScanPage() {
    const [prefixText] = useState<string>("1M,2M"); // Keep for filtering, but don't show UI
    const [matched, setMatched] = useState<ScanItem[]>([]);
    const [unmatched, setUnmatched] = useState<ScanItem[]>([]);
    const [status, setStatus] = useState<string>("");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [currentCode, setCurrentCode] = useState<string>("");
    const [autoSubmit] = useState<boolean>(true); // Always enabled, no UI
    const [submitDelayMs] = useState<number>(200); // Fixed delay, no UI
    const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expectedCacheRef = useRef<Set<string>>(new Set());
    const seenRef = useRef<Set<string>>(new Set());
    const [expectedList, setExpectedList] = useState<string[]>([]); // Store full expected list for display
    const hasUnsavedData = useRef<boolean>(false); // Track if there's unsaved data (for error handling)

    const allowedPrefixes = useCallback(() =>
        prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);

    const shouldInclude = useCallback((text: string) => {
        const p = allowedPrefixes();
        if (p.length === 0) return true;
        return p.some(pref => text.startsWith(pref));
    }, [allowedPrefixes]);

    const addItem = useCallback(async (text: string) => {
        if (!text || text.trim().length === 0) return;
        const normalized = normalizeBarcode(text);
        if (!normalized || normalized.length === 0) return;
        if (!shouldInclude(normalized)) {
            setStatus(`Skipped: ${normalized} (doesn't match prefix)`);
            return;
        }
        if (seenRef.current.has(normalized)) {
            setStatus(`Already scanned: ${normalized}`);
            return;
        }
        seenRef.current.add(normalized);
        
        // Fast path: local cache lookup (no network)
        const exists = expectedCacheRef.current.has(normalized);
        const isMatched = exists;
        
        // Update UI immediately
        if (exists) {
            setMatched(prev => [...prev, { text: normalized }]);
            setStatus(`Matched: ${normalized}`);
        } else {
            setUnmatched(prev => [...prev, { text: normalized }]);
            setStatus(`Unmatched: ${normalized}`);
        }
        
        // Save to DB immediately on scan
        try {
            const payload = [{
                text: normalized,
                prefixes: prefixText,
                matched: isMatched
            }];
            
            await supabase
                .from("mo_scan_items")
                .upsert(payload, { onConflict: "text" });
            
            hasUnsavedData.current = false; // Mark as saved
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Save failed: ${msg}`);
            hasUnsavedData.current = true; // Mark as unsaved on error
        }
    }, [prefixText, shouldInclude]);

    // Always focus barcode input for scanning (1층 스캔)
    useEffect(() => {
        // Focus barcode input on mount and keep it focused
        const focusBarcode = () => {
            inputRef.current?.focus();
        };
        
        // Focus immediately
        setTimeout(focusBarcode, 100);
        
        // Keep focus on barcode input when clicking anywhere
        const onFocus = () => {
            // Only refocus if not already focused on barcode input
            if (document.activeElement !== inputRef.current) {
                focusBarcode();
            }
        };
        
        window.addEventListener("click", onFocus);
        // Also refocus when window regains focus (e.g., after scanning)
        window.addEventListener("focus", focusBarcode);
        
        return () => {
            window.removeEventListener("click", onFocus);
            window.removeEventListener("focus", focusBarcode);
        };
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
            const list: string[] = [];
            for (const r of data ?? []) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const normalized = normalizeBarcode((r as any).text);
                if (shouldInclude(normalized)) {
                    set.add(normalized);
                    list.push(normalized);
                }
            }
            expectedCacheRef.current = set;
            setExpectedList(list.sort());
            // Don't show status message for expected list loading
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Load expected failed: ${msg}`);
        }
    }, [shouldInclude]);

    useEffect(() => { void loadExpectedCache(); }, [loadExpectedCache]);

    // Load scanned items from database on page load
    const loadScannedItems = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from("mo_scan_items")
                .select("text, matched")
                .eq("prefixes", prefixText);
            
            if (error) throw error;
            
            const loadedMatched: ScanItem[] = [];
            const loadedUnmatched: ScanItem[] = [];
            
            for (const item of data ?? []) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const normalized = normalizeBarcode((item as any).text);
                if (!shouldInclude(normalized)) continue;
                
                seenRef.current.add(normalized);
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((item as any).matched) {
                    loadedMatched.push({ text: normalized });
                } else {
                    loadedUnmatched.push({ text: normalized });
                }
            }
            
            setMatched(loadedMatched);
            setUnmatched(loadedUnmatched);
            setStatus(`Loaded ${loadedMatched.length + loadedUnmatched.length} scanned items from DB`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("Load scanned items failed:", msg);
        }
    }, [prefixText, shouldInclude]);

    // Load scanned items on mount and when prefixText changes
    useEffect(() => { 
        void loadScannedItems(); 
    }, [loadScannedItems]);

    // uploadBatch removed - items are saved immediately on scan

    // clearList removed - not needed for PDA usage

    // Auto-save function removed - items are saved immediately on scan

    // No need for periodic auto-save - items are saved immediately on scan

    // Calculate missing items (expected but not scanned yet)
    const missing = expectedList.filter(text => !seenRef.current.has(text));

    // Create unified list with proper ordering:
    // 1. Unmatched (orange) - always on top
    // 2. Missing (gray) - not scanned yet
    // 3. Matched (green) - scanned and matched, move to bottom
    const unifiedList = useMemo(() => {
        const unmatchedItems = unmatched.map(it => ({ text: it.text, status: 'unmatched' as const }));
        const missingItems = missing.map(text => ({ text, status: 'missing' as const }));
        const matchedItems = matched.map(it => ({ text: it.text, status: 'matched' as const }));
        
        // Order: Unmatched first, then Missing, then Matched
        return [...unmatchedItems, ...missingItems, ...matchedItems];
    }, [unmatched, missing, matched]);

    // clearScanDatabase removed - not needed for PDA usage


    // Handle double-click on list items to mark as scanned
    const handleItemDoubleClick = useCallback(async (text: string, status: 'unmatched' | 'missing' | 'matched') => {
        // Only process missing items (expected but not scanned) and unmatched items
        if (status === 'missing' || status === 'unmatched') {
            await addItem(text); // addItem now saves to DB immediately
        }
    }, [addItem]);

    return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			<h1 className="text-xl sm:text-2xl font-semibold">1층 스캔</h1>
			
			{/* Scan Count Cards */}
			<div className="grid grid-cols-3 gap-2 sm:gap-3">
				<div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-emerald-700 font-medium mb-1">Matched</div>
					<div className="text-2xl sm:text-3xl font-bold text-emerald-800">{matched.length}</div>
				</div>
				<div className="rounded-lg border-2 border-orange-400 bg-orange-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-orange-700 font-medium mb-1">Unmatched</div>
					<div className="text-2xl sm:text-3xl font-bold text-orange-800">{unmatched.length}</div>
				</div>
				<div className="rounded-lg border-2 border-gray-400 bg-gray-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-gray-700 font-medium mb-1">Missing</div>
					<div className="text-2xl sm:text-3xl font-bold text-gray-800">{missing.length}</div>
				</div>
			</div>

			{/* Barcode input - compact size */}
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
                <label className="block text-sm text-gray-800 mb-2 font-semibold">바코드 스캔</label>
                <input
                    ref={inputRef}
                    type="text"
                    value={currentCode}
                    onChange={(e) => setCurrentCode(e.target.value)}
                    onKeyDown={handleKey}
                    className="w-full rounded border border-amber-400 px-3 py-3 text-lg font-mono text-gray-900 placeholder-gray-500 bg-white focus:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="바코드를 스캔하세요..."
                    autoComplete="off"
                    autoFocus
                />
            </div>

			{/* Status message - only show important messages */}
			{status && (status.includes("Added") || status.includes("Uploaded") || status.includes("failed") || status.includes("cleared") || status.includes("Loaded")) ? (
				<div className="rounded border bg-white p-2 text-sm text-gray-700">{status}</div>
			) : null}

			{/* No save button needed - items are saved immediately on scan */}
            <div className="rounded border bg-white p-3 sm:p-4">
                <h2 className="font-medium text-base sm:text-sm mb-3">
                    List ({unifiedList.length})
                </h2>
                <ul className="space-y-2 max-h-[50vh] sm:max-h-96 overflow-auto touch-pan-y">
                    {unifiedList.map((item, idx) => {
                        let bgColor = "bg-gray-50";
                        let borderColor = "border-gray-200";
                        let textColor = "text-gray-600";
                        
                        if (item.status === 'unmatched') {
                            bgColor = "bg-orange-50";
                            borderColor = "border-orange-200";
                            textColor = "text-gray-900";
                        } else if (item.status === 'matched') {
                            bgColor = "bg-emerald-50";
                            borderColor = "border-emerald-200";
                            textColor = "text-gray-900";
                        }
                        
                        return (
                            <li 
                                key={`${item.text}-${idx}`} 
                                className={`rounded border px-3 py-2.5 sm:px-3 sm:py-2 flex items-center justify-between gap-2 ${bgColor} ${textColor} ${borderColor}`}
                            >
                                <span className="font-mono text-base sm:text-sm flex-1">{item.text}</span>
                                <button
                                    onClick={() => {
                                        if (item.status === 'missing' || item.status === 'unmatched') {
                                            handleItemDoubleClick(item.text, item.status);
                                        }
                                    }}
                                    disabled={item.status === 'matched'}
                                    className={`min-w-[60px] sm:min-w-[50px] px-3 py-2 sm:px-2 sm:py-1.5 text-sm sm:text-xs font-medium rounded touch-manipulation ${
                                        item.status === 'matched' 
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                                            : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                                    }`}
                                    title={item.status === 'matched' ? '이미 스캔됨' : '스캔된 것으로 표시'}
                                >
                                    {item.status === 'matched' ? '완료' : '추가'}
                                </button>
                            </li>
                        );
                    })}
                    {unifiedList.length === 0 && (
                        <li className="text-base sm:text-sm text-gray-500 italic py-4">No items</li>
                    )}
                </ul>
            </div>
		</div>
    );
}
