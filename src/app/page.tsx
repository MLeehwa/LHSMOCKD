"use client";
import { useCallback, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { supabase } from "../lib/supabaseClient";

type OcrLine = { text: string; confidence: number };

export default function UploadPage() {
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [lines, setLines] = useState<OcrLine[]>([]);
	const [progress, setProgress] = useState<number>(0);
    const [status, setStatus] = useState<string>("");
	const [prefixText, setPrefixText] = useState<string>("2M");
	const [uploading, setUploading] = useState<boolean>(false);
	const [clearing, setClearing] = useState<boolean>(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

// confidence formatting removed from UI; keep function out to avoid unused warnings

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
			const text = g.map(w => w.text.trim()).join(" ").trim();
			const confidences = g.map(w => (typeof w.confidence === "number" ? w.confidence! : 0));
			const conf = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
			return { text, confidence: conf };
		}).filter(l => l.text.length > 0 && include(l.text));
		return results;
	}

	const uploadToSupabase = useCallback(async () => {
		if (lines.length === 0) return;
		setUploading(true);
		try {
			// Always delete all existing rows before upload (daily reset)
			const { error: delErr } = await supabase
				.from("mo_ocr_results")
				.delete()
				.gt("id", 0); // delete all rows
			if (delErr) throw delErr;

			// Deduplicate by text within the current batch to avoid Postgres upsert multi-hit error
			const seen = new Set<string>();
			const payload = lines.filter(l => {
				if (seen.has(l.text)) return false;
				seen.add(l.text);
				return true;
			}).map((l) => ({
				text: l.text,
				confidence: l.confidence ?? 0,
				prefixes: prefixText,
			}));
			// Use upsert to gracefully ignore duplicates already in DB (batch-internal dups removed above)
			const { error } = await supabase
				.from("mo_ocr_results")
				.upsert(payload, { onConflict: "text" });
			if (error) throw error;
			setStatus("Uploaded to Supabase");
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

        const shouldInclude = (text: string) =>
			allowedPrefixes.length === 0
				? true
				: allowedPrefixes.some((p) => text.startsWith(p));

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
            let extracted: OcrLine[];
            if (structuredLines && structuredLines.length > 0) {
                extracted = structuredLines
                    .map(l => ({ text: (l.text || "").trim(), confidence: l.confidence ?? 0 }))
                    .filter(l => l.text.length > 0)
                    .filter(l => shouldInclude(l.text));
            } else {
                // Try grouping words into lines to compute confidence
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const words = ((data as any)?.words as Array<any>)?.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) ?? [];
                const fromWords = buildLineResultsFromWords(words, shouldInclude);
                if (fromWords.length > 0) {
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
                    extracted = textLines
                        .filter(shouldInclude)
                        .map(t => ({ text: t, confidence: 0 }));
                }
            }
            setLines(extracted);
            setStatus("Done");
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

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                setStatus(`Processing page ${pageNum} of ${numPages}...`);
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 2 });
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

                // Store the last page for preview
                if (pageNum === numPages) {
                    const dataUrl = canvas.toDataURL("image/png");
                    setImageUrl(dataUrl);
                }

                setStatus(`Running OCR on page ${pageNum} of ${numPages}...`);
                const { data } = await Tesseract.recognize(canvas, "kor+eng", {
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
                let pageExtracted: OcrLine[];
                if (structuredLinesPdf && structuredLinesPdf.length > 0) {
                    pageExtracted = structuredLinesPdf
                        .map(l => ({ text: (l.text || "").trim(), confidence: l.confidence ?? 0 }))
                        .filter(l => l.text.length > 0)
                        .filter(l => shouldInclude(l.text));
                } else {
                    // Try grouping words into lines to compute confidence
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const words = ((data as any)?.words as Array<any>)?.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) ?? [];
                    const fromWords = buildLineResultsFromWords(words, shouldInclude);
                    if (fromWords.length > 0) {
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
                        pageExtracted = textLines
                            .filter(shouldInclude)
                            .map(t => ({ text: t, confidence: 0 }));
                    }
                }
                allExtracted.push(...pageExtracted);
            }
            
            setLines(allExtracted);
            setStatus(`Done - Processed ${numPages} page(s)`);
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
