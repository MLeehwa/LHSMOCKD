"use client";
import { useCallback, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";

type OcrLine = { text: string; confidence: number };

export default function UploadPage() {
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [lines, setLines] = useState<OcrLine[]>([]);
	const [progress, setProgress] = useState<number>(0);
    const [status, setStatus] = useState<string>("");
	const [prefixText, setPrefixText] = useState<string>("1M,2M");
	const [uploading, setUploading] = useState<boolean>(false);
	const [clearing, setClearing] = useState<boolean>(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

// confidence formatting removed from UI; keep function out to avoid unused warnings

	// Preprocess image to improve OCR accuracy
	function preprocessImageForOCR(canvas: HTMLCanvasElement): HTMLCanvasElement {
		const ctx = canvas.getContext("2d");
		if (!ctx) return canvas;
		
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imageData.data;
		
		// Convert to grayscale and enhance contrast
		for (let i = 0; i < data.length; i += 4) {
			// Convert to grayscale using luminance formula
			const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
			
			// Enhance contrast (increase difference between text and background)
			// Higher contrast helps OCR distinguish text from background
			const contrast = 2.0; // Increased contrast multiplier for better text recognition
			const enhanced = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
			
			// Apply to all channels (grayscale)
			data[i] = enhanced;     // R
			data[i + 1] = enhanced; // G
			data[i + 2] = enhanced; // B
			// Alpha channel (data[i + 3]) remains unchanged
		}
		
		ctx.putImageData(imageData, 0, 0);
		return canvas;
	}

	// Post-process OCR text to fix common misrecognitions, especially 8 and 9
	function postProcessOcrText(text: string): string {
		if (!text) return text;
		// Common OCR misrecognitions for numbers
		// Fix 8/9 misrecognitions: B->8, S->5, O->0, but be careful with context
		let processed = text;
		
		// Pattern-based fixes for common barcode-like strings
		// If text looks like a barcode (alphanumeric, starts with prefix), apply fixes
		// Replace B with 8 in numeric contexts (but keep B in letter contexts)
		processed = processed.replace(/(\d)B(\d)/g, '$18$2'); // B between numbers -> 8
		processed = processed.replace(/B(\d{2,})/g, '8$1'); // B followed by 2+ digits -> 8
		processed = processed.replace(/(\d{2,})B/g, '$18'); // 2+ digits followed by B -> 8
		
		// Replace S with 5 in numeric contexts
		processed = processed.replace(/(\d)S(\d)/g, '$15$2'); // S between numbers -> 5
		processed = processed.replace(/S(\d{2,})/g, '5$1'); // S followed by 2+ digits -> 5
		processed = processed.replace(/(\d{2,})S/g, '$15'); // 2+ digits followed by S -> 5
		
		// Replace O with 0 in numeric contexts (but keep O in letter contexts)
		processed = processed.replace(/(\d)O(\d)/g, '$10$2'); // O between numbers -> 0
		processed = processed.replace(/O(\d{2,})/g, '0$1'); // O followed by 2+ digits -> 0
		processed = processed.replace(/(\d{2,})O/g, '$10'); // 2+ digits followed by O -> 0
		
		// Fix common 8/9 misrecognitions
		// If we see patterns like "2M8" where 8 might be B, or "2M9" where 9 might be something else
		// More aggressive: in barcode-like strings (alphanumeric), fix common patterns
		if (/^[A-Z0-9]{6,}$/.test(processed)) {
			// Looks like a barcode - apply more aggressive fixes
			processed = processed.replace(/B(?=\d)/g, '8'); // B before digit -> 8
			processed = processed.replace(/(?<=\d)B/g, '8'); // B after digit -> 8
		}
		
		return processed;
	}

	function buildLineResultsFromWords(words: Array<{ text: string; confidence?: number; bbox?: { y0: number; y1: number } }>, include: (t: string) => boolean): OcrLine[] {
		if (!words || words.length === 0) return [];
		// Group words by approximate baseline (y position). Tesseract gives bbox; use y0 with a small tolerance.
		const sorted = words
			.filter(w => (w.text || "").trim().length > 0)
			.sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0));
		const groups: Array<typeof sorted> = [];
		const tolerance = 6; // pixels
		for (const w of sorted) {
			const y = w.bbox?.y0 ?? 0;
			const last = groups[groups.length - 1];
			if (!last) {
				groups.push([w]);
				continue;
			}
			const lastY = last[0].bbox?.y0 ?? 0;
			if (Math.abs(y - lastY) <= tolerance) {
				last.push(w);
			} else {
				groups.push([w]);
			}
		}
		const results: OcrLine[] = groups.map(g => {
			let text = g.map(w => w.text.trim()).join(" ").trim();
			text = postProcessOcrText(text); // Apply post-processing
			const confidences = g.map(w => (typeof w.confidence === "number" ? w.confidence! : 0));
			const conf = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
			return { text, confidence: conf };
		}).filter(l => l.text.length > 0 && include(l.text));
		return results;
	}

	// Helper function to show OCR recognition results
	function showOcrResults(
		allLines: OcrLine[],
		extracted: OcrLine[],
		prefixes: string[],
		includeFn: (text: string) => boolean,
		fileType: string,
		pageInfo?: string
	) {
		const totalLines = allLines.length;
		const nonEmptyLines = allLines.filter(l => l.text.length > 0).length;
		const afterPrefixFilter = extracted.length;
		const filteredOut = nonEmptyLines - afterPrefixFilter;
		const emptyLines = totalLines - nonEmptyLines;
		
		let resultMsg = `\n\n[OCR 인식 결과${pageInfo ? ` (${pageInfo})` : ""}]`;
		resultMsg += `\n전체 인식된 라인: ${totalLines}개`;
		if (emptyLines > 0) {
			resultMsg += `\n  - 빈 항목: ${emptyLines}개`;
		}
		resultMsg += `\n빈 항목 제거 후: ${nonEmptyLines}개`;
		
		if (prefixes.length > 0) {
			resultMsg += `\nPrefix 필터링 후: ${afterPrefixFilter}개`;
			if (filteredOut > 0) {
				resultMsg += ` (필터링 제외: ${filteredOut}개)`;
			}
			resultMsg += `\n  - 허용된 prefix: ${prefixes.join(", ")}`;
		} else {
			resultMsg += `\n최종 인식된 항목: ${afterPrefixFilter}개`;
		}
		
		if (filteredOut > 0) {
			const filteredItems = allLines
				.filter(l => l.text.length > 0 && !includeFn(l.text))
				.slice(0, 15)
				.map(l => l.text);
			resultMsg += `\n\n[제외된 항목 예시 (최대 15개)]:`;
			filteredItems.forEach(item => {
				resultMsg += `\n  - "${item}"`;
			});
			if (filteredOut > 15) {
				resultMsg += `\n  ... 외 ${filteredOut - 15}개 항목`;
			}
		}
		
		return resultMsg;
	}

	const uploadToSupabase = useCallback(async () => {
		if (lines.length === 0) return;
		setUploading(true);
		try {
			setStatus("Deleting existing data from OCR and SCAN databases...");
			
			// Delete all existing rows from both OCR and SCAN databases before upload
			const [ocrDelRes, scanDelRes] = await Promise.all([
				supabase
					.from("mo_ocr_results")
					.delete()
					.neq("id", -1), // delete all rows (id is never -1, so this matches all)
				supabase
					.from("mo_scan_items")
					.delete()
					.neq("id", -1) // delete all rows
			]);
			
			if (ocrDelRes.error) {
				console.error("OCR delete error:", ocrDelRes.error);
				throw new Error(`OCR DB 삭제 실패: ${ocrDelRes.error.message}`);
			}
			if (scanDelRes.error) {
				console.error("SCAN delete error:", scanDelRes.error);
				throw new Error(`SCAN DB 삭제 실패: ${scanDelRes.error.message}`);
			}

			setStatus("OCR 및 SCAN DB 삭제 완료. 새로운 데이터 업로드 중...");

			// Normalize and deduplicate by normalized text within the current batch to avoid Postgres upsert multi-hit error
			// This ensures items with different whitespace/formatting but same normalized value are treated as duplicates
			const seen = new Map<string, string>(); // normalized -> first original text
			const duplicates: Array<{ original: string; normalized: string; kept: string }> = [];
			const emptyAfterNormalize: Array<{ original: string; normalized: string }> = [];
			
			// Step 1: Normalize all items
			const normalizedItems = lines.map(l => {
				const normalized = normalizeBarcode(l.text);
				return {
					original: l.text,
					normalized: normalized,
					confidence: l.confidence ?? 0,
					becameEmpty: !normalized || normalized.length === 0
				};
			});
			
			// Step 2: Filter and track what's removed
			const payload = normalizedItems
				.filter(l => {
					// Skip empty or invalid items after normalization
					if (l.becameEmpty) {
						emptyAfterNormalize.push({
							original: l.original,
							normalized: l.normalized || "(빈 문자열)"
						});
						return false;
					}
					// Deduplicate by normalized text
					if (seen.has(l.normalized)) {
						const keptOriginal = seen.get(l.normalized)!;
						duplicates.push({
							original: l.original,
							normalized: l.normalized,
							kept: keptOriginal
						});
						return false;
					}
					seen.set(l.normalized, l.original);
					return true;
				})
				.map((l) => ({
					text: l.normalized,
					confidence: l.confidence,
					prefixes: prefixText,
				}));
			
			// Use upsert to gracefully ignore duplicates already in DB (batch-internal dups removed above)
			// Process in batches to avoid Supabase request size limits (typically 1000 rows per request)
			const BATCH_SIZE = 500;
			let uploadedCount = 0;
			const batchResults: Array<{ batchNum: number; size: number; success: boolean; error?: string }> = [];
			
			for (let i = 0; i < payload.length; i += BATCH_SIZE) {
				const batch = payload.slice(i, i + BATCH_SIZE);
				const batchNum = Math.floor(i / BATCH_SIZE) + 1;
				const { data, error } = await supabase
					.from("mo_ocr_results")
					.upsert(batch, { onConflict: "text" });
				
				if (error) {
					batchResults.push({ batchNum, size: batch.length, success: false, error: error.message });
					throw new Error(`Batch ${batchNum} 업로드 실패: ${error.message}`);
				}
				
				// Note: upsert doesn't return inserted count, so we track by batch size
				uploadedCount += batch.length;
				batchResults.push({ batchNum, size: batch.length, success: true });
				setStatus(`업로드 중... 배치 ${batchNum}: ${batch.length}개 항목 처리됨 (총 ${uploadedCount}/${payload.length}개)`);
			}
			
			// Verify upload by counting actual rows in database
			const { count, error: countError } = await supabase
				.from("mo_ocr_results")
				.select("*", { count: "exact", head: true });
			
			// Also get actual data to verify what was stored
			const { data: storedData, error: dataError } = await supabase
				.from("mo_ocr_results")
				.select("text")
				.order("created_at", { ascending: false })
				.limit(1000);
			
			const originalCount = lines.length;
			const normalizedCount = payload.length;
			const skippedCount = originalCount - normalizedCount;
			const actualCount = countError ? null : count;
			const storedTexts = storedData ? new Set(storedData.map((r: any) => r.text)) : null;
			
			// Check which items from payload are actually in DB
			const missingInDb: string[] = [];
			if (storedTexts) {
				payload.forEach(item => {
					if (!storedTexts.has(item.text)) {
						missingInDb.push(item.text);
					}
				});
			}
			
			let statusMsg = `\n\n[업로드 결과]`;
			statusMsg += `\nOCR 인식 항목: ${originalCount}개`;
			statusMsg += `\n정규화 후 항목: ${normalizedCount}개`;
			
			if (originalCount !== normalizedCount) {
				statusMsg += `\n제외된 항목: ${skippedCount}개`;
				statusMsg += `\n  - 정규화 후 빈 항목: ${emptyAfterNormalize.length}개`;
				statusMsg += `\n  - 정규화 후 중복: ${duplicates.length}개`;
			}
			
			statusMsg += `\n업로드 시도: ${normalizedCount}개`;
			if (countError) {
				statusMsg += `\n⚠️ DB 확인 실패: ${countError.message}`;
			} else if (actualCount !== null && actualCount !== normalizedCount) {
				statusMsg += `\n⚠️ 경고: DB에 실제 저장된 항목: ${actualCount}개 (예상: ${normalizedCount}개, 차이: ${normalizedCount - actualCount}개)`;
			} else if (actualCount === normalizedCount) {
				statusMsg += `\n✅ DB 확인: ${actualCount}개 모두 저장됨`;
			}
			
			// Show batch results
			statusMsg += `\n\n[배치 처리 결과]`;
			batchResults.forEach(result => {
				if (result.success) {
					statusMsg += `\n배치 ${result.batchNum}: ${result.size}개 항목 성공`;
				} else {
					statusMsg += `\n배치 ${result.batchNum}: 실패 - ${result.error}`;
				}
			});
			
			// Show missing items if any
			if (missingInDb.length > 0) {
				statusMsg += `\n\n⚠️ [DB에 저장되지 않은 항목 ${missingInDb.length}개]:`;
				const displayMissing = missingInDb.slice(0, 20);
				displayMissing.forEach(text => {
					statusMsg += `\n  - "${text}"`;
				});
				if (missingInDb.length > 20) {
					statusMsg += `\n  ... 외 ${missingInDb.length - 20}개 항목`;
				}
				console.error("DB에 저장되지 않은 항목들:", missingInDb);
			}
			
			// Always show detailed information about processing
			statusMsg += `\n\n[처리 결과]`;
			statusMsg += `\n원본 항목: ${originalCount}개`;
			statusMsg += `\n정규화 후 항목: ${normalizedCount}개`;
			statusMsg += `\n업로드 시도 항목: ${normalizedCount}개`;
			
			if (originalCount !== normalizedCount) {
				statusMsg += `\n제외된 항목: ${skippedCount}개 (중복: ${duplicates.length}개, 빈 항목: ${emptyAfterNormalize.length}개)`;
			}
			
			// Log payload details for debugging
			console.log("=== OCR Upload Debug Info ===");
			console.log(`원본 항목 수: ${originalCount}`);
			console.log(`정규화 후 항목 수: ${normalizedCount}`);
			console.log(`중복 제거: ${duplicates.length}개`);
			console.log(`정규화 후 빈 항목: ${emptyAfterNormalize.length}개`);
			console.log(`업로드할 payload:`, payload.slice(0, 10), "... (총", payload.length, "개)");
			if (emptyAfterNormalize.length > 0) {
				console.log("정규화 후 빈 항목들:", emptyAfterNormalize);
			}
			if (duplicates.length > 0) {
				console.log("중복 제거된 항목들:", duplicates);
			}
			
			// Always show duplicate count (even if 0)
			statusMsg += `\n\n[정규화 후 중복 제거: ${duplicates.length}개]`;
			if (duplicates.length > 0) {
				// Show first 20 duplicates to avoid message being too long
				const displayDuplicates = duplicates.slice(0, 20);
				displayDuplicates.forEach(dup => {
					statusMsg += `\n  - "${dup.original}" → 정규화: "${dup.normalized}" (이미 "${dup.kept}" 존재)`;
				});
				if (duplicates.length > 20) {
					statusMsg += `\n  ... 외 ${duplicates.length - 20}개 중복 항목`;
				}
			} else {
				statusMsg += `\n  (중복 없음)`;
			}
			
			// Always show empty items count (even if 0)
			statusMsg += `\n\n[정규화 후 빈 항목: ${emptyAfterNormalize.length}개]`;
			if (emptyAfterNormalize.length > 0) {
				const displayEmpty = emptyAfterNormalize.slice(0, 15);
				displayEmpty.forEach(item => {
					statusMsg += `\n  - "${item.original}" → 정규화 후: "${item.normalized}"`;
				});
				if (emptyAfterNormalize.length > 15) {
					statusMsg += `\n  ... 외 ${emptyAfterNormalize.length - 15}개 빈 항목`;
				}
			} else {
				statusMsg += `\n  (빈 항목 없음)`;
			}
			
			statusMsg += `\n\n(OCR 및 SCAN DB 모두 초기화됨)`;
			setStatus(statusMsg);
			
		} catch (e) {
			// Improve error visibility for Supabase/PostgREST errors
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const err: any = e;
			const message =
				(err && (err.message || err.error_description || err.hint || err.details))
				|| (typeof err === "object" ? JSON.stringify(err) : String(err));
			console.error("Upload failed", err);
			setStatus(`Upload failed: ${message}`);
		} finally {
			setUploading(false);
		}
	}, [lines, prefixText]);

	const clearDatabase = useCallback(async () => {
		if (!confirm("모든 OCR 데이터와 스캔 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
		setClearing(true);
		try {
			// Delete both OCR results and scan items
			const [ocrRes, scanRes] = await Promise.all([
				supabase.from("mo_ocr_results").delete().gt("id", 0),
				supabase.from("mo_scan_items").delete().gt("id", 0)
			]);
			if (ocrRes.error) throw ocrRes.error;
			if (scanRes.error) throw scanRes.error;
			setStatus("Database cleared");
		} catch (e) {
			const err = e as unknown as { message?: string };
			setStatus(`Clear failed: ${err?.message ?? String(e)}`);
		} finally {
			setClearing(false);
		}
	}, []);

	const handleFiles = useCallback(async (file: File) => {
		setLines([]);
		setProgress(0);
        setStatus("");

        const allowedPrefixes = prefixText
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean);

        const shouldInclude = (text: string) => {
			if (!text || typeof text !== 'string') return false;
			return allowedPrefixes.length === 0
				? true
				: allowedPrefixes.some((p) => text.startsWith(p));
		};

        if (file.type.startsWith("image/")) {
			const url = URL.createObjectURL(file);
			setImageUrl(url);

            setStatus("Running OCR...");
            const { data } = await Tesseract.recognize(file, "kor+eng", {
				logger: (m) => {
                    if (m.status === "recognizing text" && m.progress) {
						setProgress(Math.round(m.progress * 100));
					}
					setStatus(m.status);
				},
            });

            // Prefer structured lines with confidence, fallback to words grouping, then text split
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const structuredLines = (data as any)?.lines as Array<{ text: string; confidence: number }>|undefined;
            let allLines: OcrLine[] = [];
            let extracted: OcrLine[];
            
            if (structuredLines && structuredLines.length > 0) {
                allLines = structuredLines
                    .map(l => ({ text: postProcessOcrText((l.text || "").trim()), confidence: l.confidence ?? 0 }));
                extracted = allLines
                    .filter(l => l.text.length > 0)
                    .filter(l => shouldInclude(l.text));
            } else {
                // Try grouping words into lines to compute confidence
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const words = ((data as any)?.words as Array<any>)?.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) ?? [];
                const fromWords = buildLineResultsFromWords(words, shouldInclude);
                if (fromWords.length > 0) {
                    // Get all lines before filtering for stats
                    const allWordsLines = buildLineResultsFromWords(words, () => true);
                    allLines = allWordsLines;
                    extracted = fromWords;
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const textLines: string[] = (data as any)?.text
                        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          String((data as any).text)
                            .split("\n")
                            .map(t => t.trim())
                            .filter(Boolean)
                        : [];
                    allLines = textLines.map(t => ({ text: postProcessOcrText(t), confidence: 0 }));
                    extracted = allLines
                        .filter(l => shouldInclude(l.text))
                        .map(t => ({ text: t.text, confidence: 0 }));
                }
            }
            
            setLines(extracted);
            const resultMsg = showOcrResults(allLines, extracted, allowedPrefixes, shouldInclude, "이미지");
            setStatus(`OCR 완료${resultMsg}`);
        } else if (file.type === "application/pdf") {
            setStatus("Loading PDF...");
            // @ts-expect-error - legacy browser bundle has no types in this path
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf");
            // Use local worker file (.mjs) served from /public to avoid CDN/network issues
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdf.numPages;
            
            if (numPages === 0) {
                setStatus("PDF has no pages.");
                return;
            }

            setStatus(`Processing ${numPages} page(s)...`);
            
            // Process all pages and combine results
            const allExtracted: OcrLine[] = [];
            const allLinesFromAllPages: OcrLine[] = [];
            const pageStats: Array<{ page: number; total: number; extracted: number }> = [];

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                setStatus(`Processing page ${pageNum} of ${numPages}...`);
                const page = await pdf.getPage(pageNum);
                // Increase scale for better OCR accuracy (2 -> 3)
                const viewport = page.getViewport({ scale: 3 });
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    setStatus(`Failed to get canvas context for page ${pageNum}.`);
                    continue;
                }
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                setStatus(`Rendering PDF page ${pageNum} of ${numPages}...`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await page.render({ canvasContext: ctx as any, viewport: viewport as any, canvas } as any).promise;

                // Preprocess image to improve OCR accuracy
                setStatus(`Enhancing image for OCR (page ${pageNum}/${numPages})...`);
                const processedCanvas = preprocessImageForOCR(canvas);

                // Store the last page for preview (original, not processed)
                if (pageNum === numPages) {
                    const dataUrl = canvas.toDataURL("image/png");
                    setImageUrl(dataUrl);
                }

                setStatus(`Running OCR on page ${pageNum} of ${numPages}...`);
                const { data } = await Tesseract.recognize(processedCanvas, "kor+eng", {
                    logger: (m) => {
                        if (m.status === "recognizing text" && m.progress) {
                            // Calculate overall progress across all pages
                            const pageProgress = m.progress;
                            const overallProgress = ((pageNum - 1) + pageProgress) / numPages;
                            setProgress(Math.round(overallProgress * 100));
                        }
                        setStatus(`${m.status} (page ${pageNum}/${numPages})`);
                    },
                });

                // Prefer structured lines with confidence, fallback to words grouping, then text split
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const structuredLinesPdf = (data as any)?.lines as Array<{ text: string; confidence: number }>|undefined;
                let pageAllLines: OcrLine[] = [];
                let pageExtracted: OcrLine[];
                
                if (structuredLinesPdf && structuredLinesPdf.length > 0) {
                    pageAllLines = structuredLinesPdf
                        .map(l => ({ text: postProcessOcrText((l.text || "").trim()), confidence: l.confidence ?? 0 }));
                    pageExtracted = pageAllLines
                        .filter(l => l.text.length > 0)
                        .filter(l => shouldInclude(l.text));
                } else {
                    // Try grouping words into lines to compute confidence
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const words = ((data as any)?.words as Array<any>)?.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) ?? [];
                    const fromWords = buildLineResultsFromWords(words, shouldInclude);
                    if (fromWords.length > 0) {
                        // Get all lines before filtering for stats
                        const allWordsLines = buildLineResultsFromWords(words, () => true);
                        pageAllLines = allWordsLines;
                        pageExtracted = fromWords;
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const textLines: string[] = (data as any)?.text
                            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              String((data as any).text)
                                .split("\n")
                                .map(t => t.trim())
                                .filter(Boolean)
                            : [];
                        pageAllLines = textLines.map(t => ({ text: postProcessOcrText(t), confidence: 0 }));
                        pageExtracted = pageAllLines
                            .filter(l => shouldInclude(l.text))
                            .map(t => ({ text: t.text, confidence: 0 }));
                    }
                }
                
                allLinesFromAllPages.push(...pageAllLines);
                allExtracted.push(...pageExtracted);
                pageStats.push({ page: pageNum, total: pageAllLines.length, extracted: pageExtracted.length });
            }
            
            setLines(allExtracted);
            const resultMsg = showOcrResults(allLinesFromAllPages, allExtracted, allowedPrefixes, shouldInclude, "PDF", `${numPages}페이지`);
            let finalMsg = `PDF OCR 완료${resultMsg}`;
            if (numPages > 1) {
                finalMsg += `\n\n[페이지별 인식 결과]:`;
                pageStats.forEach(stat => {
                    finalMsg += `\n페이지 ${stat.page}: 전체 ${stat.total}개 → 인식 ${stat.extracted}개`;
                });
            }
            setStatus(finalMsg);
		} else {
			setImageUrl(null);
            setStatus("Unsupported file type.");
		}
	}, [prefixText]);

	const onDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		const f = e.dataTransfer.files?.[0];
		if (f) handleFiles(f);
	}, [handleFiles]);

	const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (f) handleFiles(f);
	}, [handleFiles]);

	return (
        <div className="max-w-5xl mx-auto space-y-6">
			<h1 className="text-2xl sm:text-3xl font-semibold">OCR Uploader</h1>
			<div className="flex items-center gap-3 text-sm">
				<label htmlFor="prefixes" className="text-gray-600">Allowed prefixes (comma separated)</label>
				<input
					id="prefixes"
					value={prefixText}
					onChange={(e) => setPrefixText(e.target.value)}
					placeholder="e.g. 2M,ABC,XYZ"
					className="rounded border px-2 py-1"
				/>

				<button
					onClick={uploadToSupabase}
					disabled={lines.length === 0 || uploading}
					className={`rounded px-3 py-2 text-sm ${lines.length === 0 || uploading ? "bg-gray-300 text-gray-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
				>
					{uploading ? "Uploading..." : "Upload to Supabase"}
				</button>
				<button
					onClick={clearDatabase}
					disabled={clearing}
					className={`rounded px-3 py-2 text-sm ${clearing ? "bg-gray-300 text-gray-500" : "bg-red-600 text-white hover:bg-red-700"}`}
				>
					{clearing ? "Clearing..." : "Clear DB"}
				</button>
			</div>

			<div
				onDrop={onDrop}
				onDragOver={(e) => e.preventDefault()}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white p-8 text-center hover:border-gray-400"
			>
                <p className="mb-4 text-gray-700">Drop an image or choose a file.</p>
                <div className="flex items-center gap-3">
					<button
                        className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800"
						onClick={() => fileInputRef.current?.click()}
					>
                        Choose File
					</button>
					<input
                        type="file"
                        accept="image/*,application/pdf"
						ref={fileInputRef}
						onChange={onChange}
                        className="hidden"
					/>
				</div>
			</div>

			{status && (
                <div className="rounded border bg-white p-4">
                    <div className="text-sm text-gray-600">{status} {progress ? `(${progress}%)` : null}</div>
				</div>
			)}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded border bg-white p-4">
                    <h2 className="mb-3 font-medium">Preview</h2>
					{imageUrl ? (
                        <img src={imageUrl} alt="preview" className="max-h-[480px] w-full object-contain rounded" />
					) : (
                        <p className="text-sm text-gray-500">Select an image to see preview.</p>
					)}
				</div>
                <div className="rounded border bg-white p-4">
                    <h2 className="mb-3 font-medium">OCR Result (per line)</h2>
					{lines.length === 0 ? (
                        <p className="text-sm text-gray-500">No OCR results yet.</p>
					) : (
                        <ul className="space-y-2">
							{lines.map((l, idx) => (
                                <li key={idx} className="rounded border px-3 py-2 text-sm">
                                    <span className="font-mono">{l.text}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
