"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";

type ScanItem = { text: string };

export default function SearchPage() {
    const [prefixText, setPrefixText] = useState<string>("1M,2M,SR");
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
    const [showSimilarPairs, setShowSimilarPairs] = useState<boolean>(true); // Toggle for similar pairs section (default: open)
    const [editingItem, setEditingItem] = useState<string | null>(null); // Track which item is being edited
    const [editValue, setEditValue] = useState<string>(""); // Value for editing

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
            // Load all items and filter by prefix client-side (to handle "1M", "2M", "1M,2M" formats)
            const { data, error } = await supabase
                .from("mo_scan_items")
                .select("text, matched, prefixes");
            
            if (error) throw error;
            
            const loadedMatched: ScanItem[] = [];
            const loadedUnmatched: ScanItem[] = [];
            const allowedPrefixesList = allowedPrefixes();
            
            for (const item of data ?? []) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const normalized = normalizeBarcode((item as any).text);
                if (!shouldInclude(normalized)) continue;
                
                // Check if the item's prefix matches our allowed prefixes
                // Item can have "1M", "2M", or "1M,2M" as prefix
                const itemPrefix = String((item as any).prefixes || "");
                const itemPrefixes = itemPrefix.split(",").map((p: string) => p.trim());
                const hasMatchingPrefix = allowedPrefixesList.length === 0 || 
                    allowedPrefixesList.some(allowed => 
                        itemPrefixes.some(item => item === allowed) || itemPrefix === prefixText
                    );
                
                if (!hasMatchingPrefix) continue;
                
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
    // Handles cases where length differs (OCR errors)
    const calculateSimilarity = useCallback((text1: string, text2: string): { score: number; details: string } | null => {
        const t1 = text1.toUpperCase();
        const t2 = text2.toUpperCase();
        
        // Extract numeric parts (after prefix)
        const num1 = t1.replace(/^[A-Z]+/, '');
        const num2 = t2.replace(/^[A-Z]+/, '');
        
        // Normalize to same length for comparison (take shorter length or 14)
        const targetLen = Math.min(num1.length, num2.length, 14);
        const n1 = num1.slice(-targetLen); // Take last N digits
        const n2 = num2.slice(-targetLen); // Take last N digits
        
        // Check if last 3-4 digits match (most common OCR error pattern)
        const checkLen = Math.min(4, targetLen);
        if (checkLen >= 3) {
            const last1 = n1.slice(-checkLen);
            const last2 = n2.slice(-checkLen);
            if (last1 === last2) {
                // Last digits match - check how similar the rest is
                const prefix1 = n1.slice(0, -checkLen);
                const prefix2 = n2.slice(0, -checkLen);
                
                // Count differences in prefix
                let diff = 0;
                const maxLen = Math.max(prefix1.length, prefix2.length);
                const minLen = Math.min(prefix1.length, prefix2.length);
                
                for (let i = 0; i < minLen; i++) {
                    if (prefix1[i] !== prefix2[i]) diff++;
                }
                diff += Math.abs(prefix1.length - prefix2.length);
                
                // If only 1-3 digits differ, consider it similar
                if (diff <= 3 && maxLen > 0) {
                    const score = Math.max(0.7, 1.0 - (diff / Math.max(maxLen, 1)));
                    const lenDiff = Math.abs(num1.length - num2.length);
                    const lenInfo = lenDiff > 0 ? ` (자리수 차이: ${lenDiff})` : '';
                    return {
                        score: score,
                        details: `끝 ${checkLen}자리 일치, 앞부분 ${diff}자리 차이${lenInfo}`
                    };
                } else if (diff <= 1) {
                    const lenDiff = Math.abs(num1.length - num2.length);
                    const lenInfo = lenDiff > 0 ? ` (자리수 차이: ${lenDiff})` : '';
                    return {
                        score: 0.9,
                        details: `끝 ${checkLen}자리 일치, 앞부분 1자리 차이${lenInfo}`
                    };
                }
            }
        }
        
        // Check if same length (after normalization) and only 1-3 digits differ
        if (n1.length === n2.length && n1.length > 0) {
            let diff = 0;
            for (let i = 0; i < n1.length; i++) {
                if (n1[i] !== n2[i]) diff++;
            }
            if (diff <= 3 && diff > 0) {
                const lenDiff = Math.abs(num1.length - num2.length);
                const lenInfo = lenDiff > 0 ? ` (자리수 차이: ${lenDiff})` : '';
                return {
                    score: Math.max(0.7, 1.0 - (diff / n1.length)),
                    details: `길이 같음, ${diff}자리 차이${lenInfo}`
                };
            }
        }
        
        // Check if one is substring of the other (OCR might have extra/missing digits)
        if (num1.length !== num2.length) {
            const shorter = num1.length < num2.length ? num1 : num2;
            const longer = num1.length < num2.length ? num2 : num1;
            
            // Check if shorter is contained in longer (with some tolerance)
            if (longer.includes(shorter) || shorter.length >= 10) {
                // Check how many digits match when aligned
                let maxMatches = 0;
                for (let offset = 0; offset <= longer.length - shorter.length; offset++) {
                    let matches = 0;
                    for (let i = 0; i < shorter.length; i++) {
                        if (shorter[i] === longer[offset + i]) matches++;
                    }
                    maxMatches = Math.max(maxMatches, matches);
                }
                
                const similarity = maxMatches / shorter.length;
                if (similarity >= 0.85) {
                    const lenDiff = Math.abs(num1.length - num2.length);
                    return {
                        score: similarity,
                        details: `부분 일치 (${maxMatches}/${shorter.length}자리), 자리수 차이: ${lenDiff}`
                    };
                }
            }
        }
        
        return null;
    }, []);

    // Find similar pairs between missing (OCR) and unmatched (barcode scan - accurate)
    // unmatched is the accurate barcode scan, missing is OCR which might be wrong
    // Find all possible matches between unmatched and missing items
    const similarPairs = useMemo(() => {
        if (missing.length === 0 || unmatched.length === 0) {
            return [];
        }
        
        const pairs: Array<{
            missing: string;
            unmatched: string;
            similarity: number;
            details: string;
        }> = [];
        
        // For each unmatched item, find the most similar missing item
        for (const unmatchedItem of unmatched) {
            let bestMatch: { missing: string; similarity: number; details: string } | null = null;
            
            for (const missingItem of missing) {
                const result = calculateSimilarity(missingItem, unmatchedItem.text);
                if (result && result.score >= 0.7) {
                    if (!bestMatch || result.score > bestMatch.similarity) {
                        bestMatch = {
                            missing: missingItem,
                            similarity: result.score,
                            details: result.details
                        };
                    }
                }
            }
            
            if (bestMatch) {
                pairs.push({
                    missing: bestMatch.missing,
                    unmatched: unmatchedItem.text,
                    similarity: bestMatch.similarity,
                    details: bestMatch.details
                });
            }
        }
        
        // Sort by similarity score (highest first)
        return pairs.sort((a, b) => b.similarity - a.similarity);
    }, [missing, unmatched, calculateSimilarity]);

    // For each unmatched, find similar OCR results across the *entire* expected list
    // - 이미 스캔된 것(Scanned)과 아직 스캔 안 된 것(Missing)으로 나눠서 보여준다.
    // - 단순 참고용으로만 화면에 표시하고, 실제 DB 변경은 하지 않는다.
    const closestExpectedPairs = useMemo(() => {
        if (expectedList.length === 0 || unmatched.length === 0) {
            return [];
        }

        const missingSet = new Set(missing);

        const pairs: Array<{
            unmatched: string;
            scannedCandidates: Array<{
                expected: string;
                similarity: number;
                details: string;
            }>;
            missingCandidates: Array<{
                expected: string;
                similarity: number;
                details: string;
            }>;
        }> = [];

        for (const unmatchedItem of unmatched) {
            const scannedCandidates: Array<{
                expected: string;
                similarity: number;
                details: string;
            }> = [];
            const missingCandidates: Array<{
                expected: string;
                similarity: number;
                details: string;
            }> = [];

            for (const expectedText of expectedList) {
                const result = calculateSimilarity(expectedText, unmatchedItem.text);
                if (!result) continue;

                // 일정 수준(0.7 이상) 이상일 때만 후보로 본다
                if (result.score >= 0.7) {
                    const targetArray = missingSet.has(expectedText)
                        ? missingCandidates
                        : scannedCandidates;
                    targetArray.push({
                        expected: expectedText,
                        similarity: result.score,
                        details: result.details,
                    });
                }
            }

            if (scannedCandidates.length === 0 && missingCandidates.length === 0) continue;

            // 각 그룹별로 유사도 높은 순 정렬 후 상위 N개만 남긴다.
            const topN = 5;
            scannedCandidates.sort((a, b) => b.similarity - a.similarity);
            missingCandidates.sort((a, b) => b.similarity - a.similarity);

            pairs.push({
                unmatched: unmatchedItem.text,
                scannedCandidates: scannedCandidates.slice(0, topN),
                missingCandidates: missingCandidates.slice(0, topN),
            });
        }

        // 그룹 정렬 기준: 스캔된 후보 중 최고 유사도 → 없으면 미싱 후보 중 최고 유사도
        return pairs.sort((a, b) => {
            const aBest = a.scannedCandidates[0]?.similarity ?? a.missingCandidates[0]?.similarity ?? 0;
            const bBest = b.scannedCandidates[0]?.similarity ?? b.missingCandidates[0]?.similarity ?? 0;
            return bBest - aBest;
        });
    }, [unmatched, expectedList, missing, calculateSimilarity]);

    // Normalize barcode to target length (default 14)
    // If longer, take first N characters; if shorter, pad or take as-is
    const normalizeToLength = useCallback((text: string, targetLen: number = 14): string => {
        const normalized = normalizeBarcode(text);
        if (normalized.length === targetLen) return normalized;
        
        // Extract prefix (letters) and numbers
        const prefixMatch = normalized.match(/^([A-Z]+)/);
        const prefix = prefixMatch ? prefixMatch[1] : '';
        const numbers = normalized.replace(/^[A-Z]+/, '');
        
        if (numbers.length > targetLen - prefix.length) {
            // Too long: take first N digits
            const targetNumbers = numbers.slice(0, targetLen - prefix.length);
            return prefix + targetNumbers;
        } else if (numbers.length < targetLen - prefix.length) {
            // Too short: keep as-is (don't pad, as we don't know what to pad with)
            return normalized;
        }
        
        return normalized;
    }, []);

    // Handle matching similar items
    // unmatchedText (barcode scan) is accurate, missingText (OCR) is wrong
    // Update mo_ocr_results to replace OCR value with barcode scan value
    const handleMatchSimilar = useCallback(async (missingText: string, unmatchedText: string) => {
        try {
            // Normalize unmatchedText to 14 characters if needed (barcode scan is accurate)
            const normalizedUnmatched = normalizeToLength(unmatchedText, 14);
            
            // Update mo_ocr_results: replace OCR value (missingText) with barcode scan value (normalizedUnmatched)
            // First, delete the old OCR value
            await supabase
                .from("mo_ocr_results")
                .delete()
                .eq("text", missingText);
            
            // Then, insert the normalized barcode scan value as the correct OCR result
            await supabase
                .from("mo_ocr_results")
                .upsert([{
                    text: normalizedUnmatched,
                    prefixes: prefixText,
                    confidence: 0
                }], { onConflict: "text" });
            
            // If the original unmatchedText was different from normalized, update it in scan_items too
            if (normalizeBarcode(unmatchedText) !== normalizedUnmatched) {
                // Delete old unmatched item (text is unique, so no prefix filter needed)
                await supabase
                    .from("mo_scan_items")
                    .delete()
                    .eq("text", unmatchedText);
                
                // Remove from UI
                setUnmatched(prev => prev.filter(item => item.text !== unmatchedText));
                seenRef.current.delete(unmatchedText);
            } else {
                // Just update the matched flag
                await supabase
                    .from("mo_scan_items")
                    .upsert([{
                        text: normalizedUnmatched,
                        prefixes: prefixText,
                        matched: true
                    }], { onConflict: "text" });
                
                // Remove from unmatched list
                setUnmatched(prev => prev.filter(item => item.text !== unmatchedText));
            }
            
            // Add to matched (use normalized version)
            setMatched(prev => {
                if (prev.some(m => m.text === normalizedUnmatched)) {
                    return prev; // Already exists
                }
                return [...prev, { text: normalizedUnmatched }];
            });
            
            // Update seenRef
            seenRef.current.add(normalizedUnmatched);
            
            // Reload expected cache to reflect the change (this updates expectedList)
            await loadExpectedCache();
            
            // Reload scanned items from DB to ensure UI is in sync with DB
            await loadScannedItems();
            
            const lenInfo = normalizeBarcode(unmatchedText) !== normalizedUnmatched 
                ? ` (${unmatchedText} → ${normalizedUnmatched}로 정규화됨)`
                : '';
            setStatus(`매칭 완료: OCR "${missingText}" → 바코드 "${normalizedUnmatched}"로 업데이트됨${lenInfo}`);
            setSearchQuery(""); // Clear search
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`매칭 실패: ${msg}`);
        }
    }, [prefixText, loadExpectedCache, loadScannedItems, normalizeToLength]);

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
        if (status === 'missing') {
            // 이미 OCR 결과(mo_ocr_results)에 존재하지만 스캔되지 않은 값 -> 스캔만 추가
            await addItem(text); // addItem now saves to DB immediately
            setSearchQuery(""); // Clear search query after adding item
            return;
        }

        if (status === 'unmatched') {
            // Unmatched인 경우: 이 값이 실제로 존재한다고 판단하면
            // 1) OCR 결과 테이블(mo_ocr_results)에 추가하고
            // 2) 스캔 테이블(mo_scan_items)에서도 matched=true로 업데이트하여 매칭 처리
            try {
                const normalized = normalizeBarcode(text);

                // 1) mo_ocr_results에 추가 (이미 있으면 무시)
                const { error: ocrError } = await supabase
                    .from("mo_ocr_results")
                    .upsert([{
                        text: normalized,
                        prefixes: prefixText,
                        confidence: 0,
                    }], { onConflict: "text" });
                if (ocrError) throw ocrError;

                // 2) mo_scan_items에서 해당 항목을 matched=true 로 업데이트
                const { error: scanError } = await supabase
                    .from("mo_scan_items")
                    .upsert([{
                        text: normalized,
                        prefixes: prefixText,
                        matched: true,
                    }], { onConflict: "text" });
                if (scanError) throw scanError;

                // 3) 로컬 상태 업데이트: unmatched 목록에서 제거하고 matched로 이동
                setUnmatched(prev => prev.filter(item => item.text !== text));
                setMatched(prev => {
                    if (prev.some(m => m.text === normalized)) return prev;
                    return [...prev, { text: normalized }];
                });
                seenRef.current.add(normalized);

                // 4) expected 캐시/리스트를 갱신해서 missing 계산도 바로 반영
                await loadExpectedCache();
                setStatus(`Unmatched 항목 "${text}"을(를) OCR 결과에 추가하고 매칭 처리했습니다.`);
                setSearchQuery("");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setStatus(`추가 실패: ${msg}`);
            }
        }
    }, [addItem, prefixText, loadExpectedCache]);

    // Handle deleting unmatched item
    const handleDeleteItem = useCallback(async (text: string) => {
        if (!confirm(`"${text}" 항목을 삭제하시겠습니까?`)) return;
        
        try {
            // Delete from database (text is unique, so no prefix filter needed)
            await supabase
                .from("mo_scan_items")
                .delete()
                .eq("text", text);
            
            // Remove from UI
            setUnmatched(prev => prev.filter(item => item.text !== text));
            seenRef.current.delete(text);
            
            setStatus(`"${text}" 항목이 삭제되었습니다.`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`삭제 실패: ${msg}`);
        }
    }, [prefixText]);

    // Handle deleting missing (OCR) item
    const handleDeleteMissingItem = useCallback(async (text: string) => {
        if (!confirm(`OCR 항목 "${text}"을(를) 삭제하시겠습니까?`)) return;
        
        try {
            // Delete from mo_ocr_results
            await supabase
                .from("mo_ocr_results")
                .delete()
                .eq("text", text);
            
            // Reload expected cache to reflect the change
            await loadExpectedCache();
            
            setStatus(`OCR 항목 "${text}"이(가) 삭제되었습니다.`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`삭제 실패: ${msg}`);
        }
    }, [loadExpectedCache]);

    // Handle deleting all missing (OCR) items
    const handleDeleteAllMissing = useCallback(async () => {
        if (missing.length === 0) {
            setStatus("삭제할 OCR 항목이 없습니다.");
            return;
        }
        
        if (!confirm(`스캔되지 않은 OCR 항목 ${missing.length}개를 모두 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
        
        try {
            // Delete all missing items from mo_ocr_results
            for (const text of missing) {
                await supabase
                    .from("mo_ocr_results")
                    .delete()
                    .eq("text", text);
            }
            
            // Reload expected cache to reflect the change
            await loadExpectedCache();
            
            setStatus(`스캔되지 않은 OCR 항목 ${missing.length}개가 모두 삭제되었습니다.`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`삭제 실패: ${msg}`);
        }
    }, [missing, loadExpectedCache]);

    // Handle editing unmatched item
    const handleStartEdit = useCallback((text: string) => {
        setEditingItem(text);
        setEditValue(text);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingItem(null);
        setEditValue("");
    }, []);

    const handleSaveEdit = useCallback(async (oldText: string, newText: string) => {
        const normalized = normalizeBarcode(newText);
        if (!normalized || normalized.length === 0) {
            setStatus("유효하지 않은 바코드입니다.");
            return;
        }
        
        if (!shouldInclude(normalized)) {
            setStatus(`"${normalized}"는 허용된 prefix와 일치하지 않습니다.`);
            return;
        }

        if (oldText === normalized) {
            handleCancelEdit();
            return;
        }

        try {
            // Check if new text already exists
            if (seenRef.current.has(normalized)) {
                setStatus(`"${normalized}"는 이미 존재합니다.`);
                return;
            }

            // Delete old item from database (text is unique, so no prefix filter needed)
            await supabase
                .from("mo_scan_items")
                .delete()
                .eq("text", oldText);

            // Check if new text matches expected
            const exists = expectedCacheRef.current.has(normalized);
            const isMatched = exists;

            // Insert new item
            await supabase
                .from("mo_scan_items")
                .upsert([{
                    text: normalized,
                    prefixes: prefixText,
                    matched: isMatched
                }], { onConflict: "text" });

            // Update UI
            setUnmatched(prev => prev.filter(item => item.text !== oldText));
            seenRef.current.delete(oldText);
            seenRef.current.add(normalized);

            if (isMatched) {
                setMatched(prev => [...prev, { text: normalized }]);
                setStatus(`"${oldText}" → "${normalized}"로 변경되었고 매칭되었습니다.`);
            } else {
                setUnmatched(prev => [...prev, { text: normalized }]);
                setStatus(`"${oldText}" → "${normalized}"로 변경되었습니다.`);
            }

            handleCancelEdit();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`수정 실패: ${msg}`);
        }
    }, [prefixText, shouldInclude, handleCancelEdit]);

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
                            {similarPairs.map((pair, idx) => {
                                const missingLen = pair.missing.length;
                                const unmatchedLen = pair.unmatched.length;
                                const lenDiff = Math.abs(missingLen - unmatchedLen);
                                const hasLenDiff = lenDiff > 0;
                                
                                return (
                                    <div 
                                        key={`${pair.missing}-${pair.unmatched}-${idx}`}
                                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded border ${hasLenDiff ? 'border-orange-300 bg-orange-50' : 'border-yellow-200'}`}
                                    >
                                        <div className="flex-1 flex flex-col gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold text-gray-600">OCR (Missing):</span>
                                                <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">
                                                    {pair.missing}
                                                    {hasLenDiff && <span className="ml-1 text-orange-600 font-bold">({missingLen}자)</span>}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold text-orange-600">바코드 (Unmatched):</span>
                                                <span className="font-mono text-sm text-orange-700 bg-orange-50 px-2 py-1 rounded">
                                                    {pair.unmatched}
                                                    {hasLenDiff && <span className="ml-1 text-orange-600 font-bold">({unmatchedLen}자)</span>}
                                                </span>
                                            </div>
                                            {hasLenDiff && (
                                                <div className="text-xs text-orange-700 font-semibold bg-orange-100 px-2 py-1 rounded">
                                                    ⚠️ 자리수 차이: {lenDiff}자리 (자동 정규화됨)
                                                </div>
                                            )}
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
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* For each unmatched, show multiple closest OCR candidates from the entire expected list (read-only, 참고용)
                - 이미 스캔된 것(Scanned)과 아직 스캔 안 된 것(Missing)으로 나눠서 표시 */}
            {closestExpectedPairs.length > 0 && (
                <div className="rounded border bg-blue-50 border-blue-300 p-3 sm:p-4">
                    <h2 className="font-medium text-base sm:text-sm text-blue-900 mb-2">
                        Unmatched 별 근접한 OCR 후보들 (Scanned / Missing 구분, 참고용)
                    </h2>
                    <div className="text-xs text-blue-800 mb-2 p-2 bg-blue-100 rounded">
                        🔍 각 Unmatched 바코드가 전체 OCR 결과(이미 스캔된 것 포함) 중 어떤 번호들과 비슷한지 보여줍니다.
                        자동으로 매칭/수정하지 않고, 눈으로 확인용으로만 사용하세요.
                    </div>
                    <div className="space-y-2 max-h-[40vh] sm:max-h-96 overflow-auto">
                        {closestExpectedPairs.map((pair, idx) => {
                            const unmatchedLen = pair.unmatched.length;

                            return (
                                <div
                                    key={`${pair.unmatched}-${idx}`}
                                    className="flex flex-col gap-2 p-3 bg-white rounded border border-blue-200"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-orange-600">Unmatched:</span>
                                        <span className="font-mono text-sm text-orange-700 bg-orange-50 px-2 py-1 rounded">
                                            {pair.unmatched}
                                            <span className="ml-1 text-orange-600 text-[11px]">
                                                ({unmatchedLen}자)
                                            </span>
                                        </span>
                                    </div>
                                    <div className="mt-1 space-y-2">
                                        {pair.scannedCandidates.length > 0 && (
                                            <div className="space-y-1">
                                                <div className="text-[11px] font-semibold text-emerald-700">
                                                    이미 스캔된 OCR 후보 (Scanned)
                                                </div>
                                                {pair.scannedCandidates.map((c, i) => {
                                                    const expectedLen = c.expected.length;
                                                    const lenDiff = Math.abs(unmatchedLen - expectedLen);
                                                    return (
                                                        <div
                                                            key={`${pair.unmatched}-scanned-${c.expected}-${i}`}
                                                            className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-2 py-1 rounded ${
                                                                lenDiff > 0 ? "bg-emerald-50" : "bg-emerald-100"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-semibold text-emerald-700">
                                                                    후보 {i + 1}:
                                                                </span>
                                                                <span className="font-mono text-xs sm:text-sm text-emerald-900 bg-white px-2 py-0.5 rounded">
                                                                    {c.expected}
                                                                    <span className="ml-1 text-emerald-700 text-[10px]">
                                                                        ({expectedLen}자)
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-gray-600 italic">
                                                                {c.details} (유사도: {Math.round(c.similarity * 100)}%)
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {pair.missingCandidates.length > 0 && (
                                            <div className="space-y-1">
                                                <div className="text-[11px] font-semibold text-amber-700">
                                                    아직 스캔 안 된 OCR 후보 (Missing)
                                                </div>
                                                {pair.missingCandidates.map((c, i) => {
                                                    const expectedLen = c.expected.length;
                                                    const lenDiff = Math.abs(unmatchedLen - expectedLen);
                                                    return (
                                                        <div
                                                            key={`${pair.unmatched}-missing-${c.expected}-${i}`}
                                                            className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-2 py-1 rounded ${
                                                                lenDiff > 0 ? "bg-amber-50" : "bg-amber-100"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-semibold text-amber-700">
                                                                    후보 {i + 1}:
                                                                </span>
                                                                <span className="font-mono text-xs sm:text-sm text-amber-900 bg-white px-2 py-0.5 rounded">
                                                                    {c.expected}
                                                                    <span className="ml-1 text-amber-700 text-[10px]">
                                                                        ({expectedLen}자)
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-gray-600 italic">
                                                                {c.details} (유사도: {Math.round(c.similarity * 100)}%)
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="rounded border bg-white p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                    <h2 className="font-medium text-base sm:text-sm">
                        List ({unifiedList.length}){searchQuery && ` (검색: "${searchQuery}")`}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm">
                            <span className="text-orange-600 font-semibold">Unmatched: {unmatched.length}</span>
                            <span className="text-gray-600 font-semibold">Missing: {missing.length}</span>
                            <span className="text-emerald-600 font-semibold">Matched: {matched.length}</span>
                        </div>
                        {missing.length > 0 && (
                            <button
                                onClick={handleDeleteAllMissing}
                                className="px-2 py-1 text-xs font-medium rounded touch-manipulation bg-red-500 text-white hover:bg-red-600 active:bg-red-700"
                                title="스캔되지 않은 모든 OCR 항목 삭제"
                            >
                                Missing 전체 삭제
                            </button>
                        )}
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
                        
                        const isEditing = editingItem === item.text && item.status === 'unmatched';
                        
                        return (
                            <li 
                                key={`${item.text}-${idx}`} 
                                className={`rounded border px-3 py-2.5 sm:px-3 sm:py-2 flex items-center ${item.status === 'matched' ? 'justify-start' : 'justify-between'} gap-2 ${bgColor} ${textColor} ${borderColor}`}
                            >
                                {isEditing ? (
                                    <>
                                        <input
                                            type="text"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    handleSaveEdit(item.text, editValue);
                                                } else if (e.key === 'Escape') {
                                                    handleCancelEdit();
                                                }
                                            }}
                                            className="flex-1 font-mono text-base sm:text-sm px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                            autoFocus
                                        />
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleSaveEdit(item.text, editValue)}
                                                className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-green-600 text-white hover:bg-green-700 active:bg-green-800"
                                                title="저장"
                                            >
                                                저장
                                            </button>
                                            <button
                                                onClick={handleCancelEdit}
                                                className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-gray-400 text-white hover:bg-gray-500 active:bg-gray-600"
                                                title="취소"
                                            >
                                                취소
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <span className="font-mono text-base sm:text-sm flex-1">{item.text}</span>
                                        {item.status === 'unmatched' && (
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => handleStartEdit(item.text)}
                                                    className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-yellow-600 text-white hover:bg-yellow-700 active:bg-yellow-800"
                                                    title="수정"
                                                >
                                                    수정
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteItem(item.text)}
                                                    className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
                                                    title="삭제"
                                                >
                                                    삭제
                                                </button>
                                                <button
                                                    onClick={() => handleAddItem(item.text, item.status)}
                                                    className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                                                    title="스캔 작업 추가"
                                                >
                                                    추가
                                                </button>
                                            </div>
                                        )}
                                        {item.status === 'missing' && (
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => handleDeleteMissingItem(item.text)}
                                                    className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
                                                    title="OCR 항목 삭제"
                                                >
                                                    삭제
                                                </button>
                                                <button
                                                    onClick={() => handleAddItem(item.text, item.status)}
                                                    className="min-w-[50px] px-2 py-1.5 text-xs font-medium rounded touch-manipulation bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                                                    title="스캔 작업 추가"
                                                >
                                                    추가
                                                </button>
                                            </div>
                                        )}
                                    </>
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

