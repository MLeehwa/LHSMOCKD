"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { normalizeBarcode } from "../../lib/barcode";

type ScanItem = { text: string };

export default function SearchPage() {
    const [prefixText, setPrefixText] = useState<string>("2M");
    const [status, setStatus] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState<string>(""); // Search query for filtering list
    const expectedCacheRef = useRef<Set<string>>(new Set());
    const seenRef = useRef<Set<string>>(new Set());
    const [expectedList, setExpectedList] = useState<string[]>([]); // Store full expected list for display
    const [matched, setMatched] = useState<ScanItem[]>([]);
    const [unmatched, setUnmatched] = useState<ScanItem[]>([]);
    const [uploading, setUploading] = useState<boolean>(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const pathname = usePathname();
    const hasUnsavedData = useRef<boolean>(false); // Track if there's unsaved data
    const [showSimilarPairs, setShowSimilarPairs] = useState<boolean>(false); // Toggle for similar pairs section

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
        const isMatched = exists;
        
        // Update UI immediately
        if (exists) {
            setMatched(prev => [...prev, { text: normalized }]);
            setStatus(`Matched: ${normalized}`);
        } else {
            setUnmatched(prev => [...prev, { text: normalized }]);
            setStatus(`Unmatched: ${normalized}`);
        }
        
        // Save to DB immediately on add (same as scan)
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
            setStatus(`Expected list loaded: ${set.size}`);
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
            setStatus(`Saved ${payload.length} items to DB`);
            hasUnsavedData.current = false; // Mark as saved
            // Keep UI lists - don't clear so counts remain visible
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
        setSearchQuery("");
        setStatus("");
        hasUnsavedData.current = false;
    }, []);

    // Auto-save function (reusable)
    const autoSaveData = useCallback(async () => {
        if (!hasUnsavedData.current) return;
        const items = [...matched, ...unmatched];
        if (items.length === 0) return;
        
        try {
            const seen = new Set<string>();
            const payload = items.filter(i => {
                if (seen.has(i.text)) return false;
                seen.add(i.text);
                return true;
            }).map(i => ({ text: i.text, prefixes: prefixText, matched: matched.some(m => m.text === i.text) }));

            await supabase
                .from("mo_scan_items")
                .upsert(payload, { onConflict: "text" });
            hasUnsavedData.current = false;
            // Don't show status message for auto-save to avoid UI spam
            // Status will only show on manual save or errors
        } catch (e) {
            console.error("Auto-save failed:", e);
        }
    }, [matched, unmatched, prefixText]);

    // Periodic auto-save (every 5 seconds if there's unsaved data)
    useEffect(() => {
        if (!hasUnsavedData.current) return;
        
        const interval = setInterval(() => {
            if (hasUnsavedData.current && (matched.length > 0 || unmatched.length > 0)) {
                autoSaveData();
            }
        }, 5000); // Auto-save every 5 seconds
        
        return () => clearInterval(interval);
    }, [matched, unmatched, autoSaveData]);

    // Auto-save when navigating away from search page
    useEffect(() => {
        // Save when pathname changes away from /search
        if (pathname !== "/search" && hasUnsavedData.current && (matched.length > 0 || unmatched.length > 0)) {
            autoSaveData();
        }
    }, [pathname, matched, unmatched, autoSaveData]);

    // Calculate missing items (expected but not scanned yet)
    const missing = expectedList.filter(text => !seenRef.current.has(text));

    // Calculate similarity between two barcodes
    // Returns object with similarity score and match details
    const calculateSimilarity = useCallback((text1: string, text2: string): { score: number; details: string } | null => {
        const t1 = text1.toUpperCase();
        const t2 = text2.toUpperCase();
        
        // Extract numeric parts (after prefix)
        const num1 = t1.replace(/^[A-Z]+/, '');
        const num2 = t2.replace(/^[A-Z]+/, '');
        
        // Check if last 3 digits match (most common OCR error pattern)
        if (num1.length >= 3 && num2.length >= 3) {
            const last3_1 = num1.slice(-3);
            const last3_2 = num2.slice(-3);
            if (last3_1 === last3_2) {
                // Last 3 digits match - check how similar the rest is
                const prefix1 = num1.slice(0, -3);
                const prefix2 = num2.slice(0, -3);
                
                // Count differences in prefix
                let diff = 0;
                const maxLen = Math.max(prefix1.length, prefix2.length);
                const minLen = Math.min(prefix1.length, prefix2.length);
                
                for (let i = 0; i < minLen; i++) {
                    if (prefix1[i] !== prefix2[i]) diff++;
                }
                diff += Math.abs(prefix1.length - prefix2.length);
                
                // If only 1-2 digits differ, consider it similar
                if (diff <= 2 && maxLen > 0) {
                    const score = 1.0 - (diff / maxLen);
                    return {
                        score: score,
                        details: `끝 3자리 일치, 앞부분 ${diff}자리 차이`
                    };
                } else if (diff <= 1) {
                    return {
                        score: 0.9,
                        details: `끝 3자리 일치, 앞부분 1자리 차이`
                    };
                }
            }
        }
        
        // Check if same length and only 1-2 digits differ
        if (num1.length === num2.length && num1.length > 0) {
            let diff = 0;
            for (let i = 0; i < num1.length; i++) {
                if (num1[i] !== num2[i]) diff++;
            }
            if (diff <= 2 && diff > 0) {
                return {
                    score: 1.0 - (diff / num1.length),
                    details: `길이 같음, ${diff}자리 차이`
                };
            }
        }
        
        return null;
    }, []);

    // Find similar pairs between missing (OCR) and unmatched (barcode scan - accurate)
    // Only show when there's exactly 1 missing and 1 unmatched (1:1 matching scenario)
    // unmatched is the accurate barcode scan, missing is OCR which might be wrong
    const similarPairs = useMemo(() => {
        // Only show matching when there's exactly 1 missing and 1 unmatched
        if (missing.length !== 1 || unmatched.length !== 1) {
            return [];
        }
        
        const missingItem = missing[0];
        const unmatchedItem = unmatched[0];
        const result = calculateSimilarity(missingItem, unmatchedItem.text);
        
        if (result && result.score >= 0.7) {
            return [{
                missing: missingItem,
                unmatched: unmatchedItem.text,
                similarity: result.score,
                details: result.details
            }];
        }
        
        return [];
    }, [missing, unmatched, calculateSimilarity]);

    // Handle matching similar items
    // unmatchedText (barcode scan) is accurate, missingText (OCR) is wrong
    // Update mo_ocr_results to replace OCR value with barcode scan value
    const handleMatchSimilar = useCallback(async (missingText: string, unmatchedText: string) => {
        try {
            // Update mo_ocr_results: replace OCR value (missingText) with barcode scan value (unmatchedText)
            // First, delete the old OCR value
            await supabase
                .from("mo_ocr_results")
                .delete()
                .eq("text", missingText);
            
            // Then, insert the barcode scan value as the correct OCR result
            await supabase
                .from("mo_ocr_results")
                .upsert([{
                    text: unmatchedText,
                    prefixes: prefixText,
                    confidence: 0
                }], { onConflict: "text" });
            
            // Update mo_scan_items: mark barcode scan as matched
            await supabase
                .from("mo_scan_items")
                .upsert([{
                    text: unmatchedText,
                    prefixes: prefixText,
                    matched: true
                }], { onConflict: "text" });
            
            // Remove from unmatched list
            setUnmatched(prev => prev.filter(item => item.text !== unmatchedText));
            seenRef.current.delete(unmatchedText);
            
            // Add to matched
            setMatched(prev => [...prev, { text: unmatchedText }]);
            seenRef.current.add(unmatchedText);
            
            // Reload expected cache to reflect the change
            await loadExpectedCache();
            
            setStatus(`매칭 완료: OCR "${missingText}" → 바코드 "${unmatchedText}"로 업데이트됨`);
            setSearchQuery(""); // Clear search
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`매칭 실패: ${msg}`);
        }
    }, [prefixText, loadExpectedCache]);

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

    // Handle adding item from list
    const handleAddItem = useCallback(async (text: string, status: 'unmatched' | 'missing' | 'matched') => {
        // Only process missing items (expected but not scanned) and unmatched items
        if (status === 'missing' || status === 'unmatched') {
            await addItem(text); // addItem now saves to DB immediately
            setSearchQuery(""); // Clear search query after adding item
        }
    }, [addItem]);

    return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			<h1 className="text-2xl sm:text-3xl font-semibold">검색 (2층)</h1>
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
				
				{/* Buttons - full width on mobile, wrapped - PDA touch-friendly */}
				<div className="flex flex-wrap gap-2">
					<button onClick={loadExpectedCache} className="flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 touch-manipulation min-h-[44px]">Refresh expected</button>
					<button onClick={uploadBatch} disabled={(matched.length+unmatched.length)===0 || uploading} className={`flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm touch-manipulation min-h-[44px] ${(matched.length+unmatched.length)===0 || uploading ? "bg-gray-300 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"}`}>{uploading?"Saving...":"Save"}</button>
					<button onClick={clearList} className="flex-1 sm:flex-none rounded px-4 py-3 sm:py-2 text-base sm:text-sm bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400 touch-manipulation min-h-[44px]">Clear list</button>
				</div>
			</div>

            <div className="rounded border bg-white p-3 sm:p-4">
                <label className="block text-base sm:text-sm text-gray-800 mb-2 font-semibold">검색 (끝 3자리)</label>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded border px-4 py-3 text-base font-mono text-gray-900 placeholder-gray-500 bg-blue-50 border-blue-300 focus:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="끝 3자리 입력..."
                    autoComplete="off"
                    inputMode="numeric"
                />
            </div>
            {/* Similar Items Matching Section - Collapsible */}
            {similarPairs.length > 0 && (
                <div className="rounded border bg-yellow-50 border-yellow-300 p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-medium text-base sm:text-sm text-yellow-900">
                            유사 항목 매칭 ({similarPairs.length}개)
                        </h2>
                        <button
                            onClick={() => setShowSimilarPairs(!showSimilarPairs)}
                            className="px-3 py-1.5 text-xs font-medium rounded touch-manipulation bg-yellow-600 text-white hover:bg-yellow-700 active:bg-yellow-800"
                        >
                            {showSimilarPairs ? '숨기기' : '보기'}
                        </button>
                    </div>
                    {showSimilarPairs && (
                        <div className="space-y-2 max-h-[40vh] sm:max-h-96 overflow-auto">
                            <div className="text-xs text-yellow-800 mb-2 p-2 bg-yellow-100 rounded">
                                💡 바코드 스캔(Unmatched)이 정확한 번호입니다. OCR 인식(Missing)이 잘못되었을 가능성이 높으니 직접 확인 후 매칭하세요.
                            </div>
                            {similarPairs.map((pair, idx) => (
                                <div 
                                    key={`${pair.missing}-${pair.unmatched}-${idx}`}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded border border-yellow-200"
                                >
                                    <div className="flex-1 flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-600">OCR (Missing):</span>
                                            <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">{pair.missing}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-orange-600">바코드 (Unmatched):</span>
                                            <span className="font-mono text-sm text-orange-700 bg-orange-50 px-2 py-1 rounded">{pair.unmatched}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 italic">
                                            {pair.details} (유사도: {Math.round(pair.similarity * 100)}%)
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleMatchSimilar(pair.missing, pair.unmatched)}
                                        className="min-w-[80px] px-4 py-2 text-sm font-medium rounded touch-manipulation bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                                        title="바코드 스캔을 OCR 예상값으로 매칭"
                                    >
                                        매칭
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

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
                                className={`rounded border px-3 py-2.5 sm:px-3 sm:py-2 flex items-center ${item.status === 'matched' ? 'justify-start' : 'justify-between'} gap-2 ${bgColor} ${textColor} ${borderColor}`}
                            >
                                <span className="font-mono text-base sm:text-sm flex-1">{item.text}</span>
                                {item.status !== 'matched' && (
                                    <button
                                        onClick={() => handleAddItem(item.text, item.status)}
                                        className="min-w-[60px] sm:min-w-[50px] px-3 py-2 sm:px-2 sm:py-1.5 text-sm sm:text-xs font-medium rounded touch-manipulation bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                                        title="스캔 작업 추가"
                                    >
                                        추가
                                    </button>
                                )}
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

