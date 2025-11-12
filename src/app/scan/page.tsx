"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [currentCode, setCurrentCode] = useState<string>("");
    const [autoSubmit, setAutoSubmit] = useState<boolean>(true);
    const [submitDelayMs, setSubmitDelayMs] = useState<number>(200);
    const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expectedCacheRef = useRef<Set<string>>(new Set());
    const seenRef = useRef<Set<string>>(new Set());
    const [expectedList, setExpectedList] = useState<string[]>([]); // Store full expected list for display
    const [searchQuery, setSearchQuery] = useState<string>(""); // Search query for filtering list
    const [focusTarget, setFocusTarget] = useState<"barcode" | "search" | "none">("barcode"); // Which input to auto-focus

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

    // Focus input based on selected focus target
    useEffect(() => {
        if (focusTarget === "barcode") {
            inputRef.current?.focus();
        } else if (focusTarget === "search") {
            searchInputRef.current?.focus();
        }
        // If focusTarget is "none", don't auto-focus
        
        const onFocus = () => {
            if (focusTarget === "barcode") {
                // Don't focus barcode input if search input is currently focused
                if (document.activeElement === searchInputRef.current) {
                    return;
                }
                inputRef.current?.focus();
            } else if (focusTarget === "search") {
                // Don't focus search input if barcode input is currently focused
                if (document.activeElement === inputRef.current) {
                    return;
                }
                searchInputRef.current?.focus();
            }
            // If focusTarget is "none", do nothing
        };
        window.addEventListener("click", onFocus);
        return () => window.removeEventListener("click", onFocus);
    }, [focusTarget]);

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
                const normalized = normalizeBarcode((r as any).text);
                if (shouldInclude(normalized)) {
                    set.add(normalized);
                    list.push(normalized);
                }
            }
            expectedCacheRef.current = set;
            setExpectedList(list.sort());
            setStatus(`Expected list loaded: ${set.size}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Load expected failed: ${msg}`);
        }
    }, [shouldInclude]);

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
        setCurrentCode("");
        setStatus("");
        inputRef.current?.focus();
    }, []);

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
        let list = [...unmatchedItems, ...missingItems, ...matchedItems];
        
        // Apply search filter if search query exists - match by last 3 digits
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toUpperCase();
            // Extract last 3 characters from search query (or all if less than 3)
            const searchSuffix = query.length >= 3 ? query.slice(-3) : query;
            list = list.filter(item => {
                const itemUpper = item.text.toUpperCase();
                // Get last 3 characters of item text
                const itemSuffix = itemUpper.length >= 3 ? itemUpper.slice(-3) : itemUpper;
                return itemSuffix === searchSuffix;
            });
        }
        
        return list;
    }, [unmatched, missing, matched, searchQuery]);

    const clearScanDatabase = useCallback(async () => {
        if (!confirm("스캔 데이터베이스를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
        try {
            const { error } = await supabase
                .from("mo_scan_items")
                .delete()
                .gt("id", 0); // delete all rows
            if (error) throw error;
            setStatus("Scan database cleared");
            // Also reload expected cache after clearing
            await loadExpectedCache();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Clear failed: ${msg}`);
        }
    }, [loadExpectedCache]);

    // Handle double-click on list items to mark as scanned
    const handleItemDoubleClick = useCallback((text: string, status: 'unmatched' | 'missing' | 'matched') => {
        // Only process missing items (expected but not scanned) and unmatched items
        if (status === 'missing' || status === 'unmatched') {
            addItem(text);
            setStatus(`Added: ${text}`);
        }
    }, [addItem]);

    return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			<h1 className="text-2xl sm:text-3xl font-semibold">Scan</h1>
			{status && (
				<div className="rounded border bg-white p-3 text-sm sm:text-base text-gray-700">{status}</div>
			)}
			{/* Mobile-optimized controls */}
			<div className="space-y-3">
				{/* Prefix input - full width on mobile */}
				<div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
					<label htmlFor="prefixes" className="text-sm sm:text-base text-gray-600 whitespace-nowrap">Allowed prefixes</label>
					<input
						id="prefixes"
						value={prefixText}
						onChange={(e) => setPrefixText(e.target.value)}
						className="w-full sm:w-auto rounded border px-3 py-2.5 text-base sm:text-sm"
					/>
				</div>
				
				{/* Checkboxes - stacked on mobile */}
				<div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
					<label className="flex items-center gap-2 text-sm sm:text-base text-gray-600">
						<input type="checkbox" checked={autoUpload} onChange={(e) => setAutoUpload(e.target.checked)} className="w-5 h-5" />
						<span>Auto upload</span>
					</label>
					<label className="flex items-center gap-2 text-sm sm:text-base text-gray-600">
						<input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} className="w-5 h-5" />
						<span>Auto submit (no Enter)</span>
					</label>
					{autoSubmit && (
						<div className="flex items-center gap-2">
							<label className="text-sm sm:text-base text-gray-600">Delay (ms):</label>
							<input
								type="number"
								value={submitDelayMs}
								onChange={(e) => setSubmitDelayMs(Number(e.target.value) || 200)}
								className="w-24 rounded border px-2 py-2.5 text-base sm:text-sm"
								title="Auto submit delay (ms)"
							/>
						</div>
					)}
				</div>
				
				{/* Focus target selection */}
				<div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
					<label className="text-sm sm:text-base text-gray-600 whitespace-nowrap">Auto Focus:</label>
					<div className="flex gap-3 sm:gap-4">
						<label className="flex items-center gap-2 text-sm sm:text-base text-gray-600 cursor-pointer">
							<input 
								type="radio" 
								name="focusTarget" 
								value="barcode"
								checked={focusTarget === "barcode"} 
								onChange={(e) => setFocusTarget("barcode")} 
								className="w-4 h-4"
							/>
							<span>Barcode</span>
						</label>
						<label className="flex items-center gap-2 text-sm sm:text-base text-gray-600 cursor-pointer">
							<input 
								type="radio" 
								name="focusTarget" 
								value="search"
								checked={focusTarget === "search"} 
								onChange={(e) => setFocusTarget("search")} 
								className="w-4 h-4"
							/>
							<span>Search</span>
						</label>
						<label className="flex items-center gap-2 text-sm sm:text-base text-gray-600 cursor-pointer">
							<input 
								type="radio" 
								name="focusTarget" 
								value="none"
								checked={focusTarget === "none"} 
								onChange={(e) => setFocusTarget("none")} 
								className="w-4 h-4"
							/>
							<span>None</span>
						</label>
					</div>
				</div>
				
				{/* Buttons - full width on mobile, wrapped */}
				<div className="flex flex-wrap gap-2">
					<button onClick={loadExpectedCache} className="flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800">Refresh expected</button>
					<button onClick={uploadBatch} disabled={(matched.length+unmatched.length)===0 || uploading} className={`flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm ${(matched.length+unmatched.length)===0 || uploading ? "bg-gray-300 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"}`}>{uploading?"Saving...":"Save"}</button>
					<button onClick={clearList} className="flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400">Clear list</button>
					<button onClick={clearScanDatabase} className="flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm bg-red-200 text-red-800 hover:bg-red-300 active:bg-red-400">Clear Scan DB</button>
				</div>
			</div>

            <div className="rounded border bg-gray-50 p-3 sm:p-4">
                <label className="block text-base sm:text-sm text-gray-800 mb-2 font-semibold">Barcode</label>
                <input
                    ref={inputRef}
                    value={currentCode}
                    onChange={(e) => setCurrentCode(e.target.value)}
                    onKeyDown={handleKey}
                    className="w-full rounded border px-4 py-4 sm:py-3 text-lg sm:text-base font-mono text-gray-900 placeholder-gray-500 bg-amber-50 border-amber-300 focus:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Focus here and scan..."
                    autoComplete="off"
                />
            </div>
            <div className="rounded border bg-white p-3 sm:p-4">
                <label className="block text-base sm:text-sm text-gray-800 mb-2 font-semibold">검색</label>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => {
                        // When search input is focused, don't let other input steal focus
                    }}
                    onBlur={() => {
                        // When search input loses focus, return focus based on focusTarget setting
                        if (focusTarget === "barcode") {
                            setTimeout(() => {
                                if (document.activeElement !== searchInputRef.current) {
                                    inputRef.current?.focus();
                                }
                            }, 100);
                        } else if (focusTarget === "search") {
                            // Keep focus on search if that's the target
                            setTimeout(() => {
                                if (document.activeElement !== inputRef.current && document.activeElement !== searchInputRef.current) {
                                    searchInputRef.current?.focus();
                                }
                            }, 100);
                        }
                    }}
                    className="w-full rounded border px-4 py-3 text-base font-mono text-gray-900 placeholder-gray-500 bg-blue-50 border-blue-300 focus:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="검색어를 입력하세요..."
                    autoComplete="off"
                />
            </div>
            <div className="rounded border bg-white p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                    <h2 className="font-medium text-base sm:text-sm">
                        List ({unifiedList.length}){searchQuery && ` (검색: "${searchQuery}")`}
                    </h2>
                    <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm">
                        <span className="text-orange-600 font-semibold">Unmatched: {unmatched.length}</span>
                        <span className="text-gray-600 font-semibold">Missing: {missing.length}</span>
                        <span className="text-emerald-600 font-semibold">Matched: {matched.length}</span>
                    </div>
                </div>
                <ul className="space-y-2 max-h-[60vh] sm:max-h-96 overflow-auto">
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
                                className={`rounded border px-4 py-3 sm:px-3 sm:py-2 text-base sm:text-sm font-mono ${bgColor} ${textColor} ${borderColor} ${item.status === 'missing' || item.status === 'unmatched' ? 'cursor-pointer hover:opacity-80 active:opacity-60' : ''}`}
                                onDoubleClick={() => handleItemDoubleClick(item.text, item.status)}
                                title={item.status === 'missing' || item.status === 'unmatched' ? '더블 클릭하여 스캔된 것으로 표시' : ''}
                            >
                                {item.text}
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
