"use client";
import { useCallback, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { supabase } from "../../lib/supabaseClient";
import { normalizeBarcode } from "../../lib/barcode";

type OcrItem = { 
    text: string; 
    confidence: number;
    edited: boolean; // Whether the text has been manually edited
};

export default function CameraOcrPage() {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [items, setItems] = useState<OcrItem[]>([]);
    const [progress, setProgress] = useState<number>(0);
    const [status, setStatus] = useState<string>("");
    const [uploading, setUploading] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Preprocess image to improve OCR accuracy
    function preprocessImageForOCR(canvas: HTMLCanvasElement): HTMLCanvasElement {
        const ctx = canvas.getContext("2d");
        if (!ctx) return canvas;
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Convert to grayscale and enhance contrast
        for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            const contrast = 2.0;
            const enhanced = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
            
            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    // Post-process OCR text to fix common misrecognitions
    function postProcessOcrText(text: string): string {
        if (!text) return text;
        let processed = text;
        
        // Common OCR misrecognitions
        processed = processed.replace(/(\d)B(\d)/g, '$18$2');
        processed = processed.replace(/B(\d{2,})/g, '8$1');
        processed = processed.replace(/(\d{2,})B/g, '$18');
        processed = processed.replace(/(\d)S(\d)/g, '$15$2');
        processed = processed.replace(/S(\d{2,})/g, '5$1');
        processed = processed.replace(/(\d{2,})S/g, '$15');
        processed = processed.replace(/(\d)O(\d)/g, '$10$2');
        processed = processed.replace(/O(\d{2,})/g, '0$1');
        processed = processed.replace(/(\d{2,})O/g, '$10');
        
        if (/^[A-Z0-9]{6,}$/.test(processed)) {
            processed = processed.replace(/B(?=\d)/g, '8');
            processed = processed.replace(/(?<=\d)B/g, '8');
        }
        
        return processed;
    }

    const handleFile = useCallback(async (file: File) => {
        setItems([]);
        setStatus("Processing image...");
        setProgress(0);

        if (file.type.startsWith("image/")) {
            const url = URL.createObjectURL(file);
            setImageUrl(url);

            setStatus("Preprocessing image for better OCR...");
            
            // Create canvas for image preprocessing
            const img = new Image();
            img.src = URL.createObjectURL(file);
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
            
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                setStatus("Canvas context failed");
                return;
            }
            
            // Increase resolution for better OCR accuracy (scale 3 for camera images)
            const scale = 3;
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Preprocess image to improve OCR
            const processedCanvas = preprocessImageForOCR(canvas);
            
            setStatus("Running OCR...");
            const { data } = await Tesseract.recognize(processedCanvas, "eng", {
                logger: (m) => {
                    if (m.status === "recognizing text" && m.progress) {
                        setProgress(Math.round(m.progress * 100));
                    }
                    setStatus(m.status);
                },
            });

            // Extract 2M codes (14 digits: 2M + 12 digits)
            // Pattern: 2M followed by exactly 12 digits (total 14 characters)
            // Use word boundary or space to ensure we only get exactly 14 characters
            const pattern2M14 = /2M\d{12}(?=\s|$|[^0-9A-Za-z])/gi;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allText = (data as any)?.text || "";
            const processedText = postProcessOcrText(allText);
            
            // Find all 2M codes in the entire OCR text - extract only first 14 characters
            const allMatches = processedText.match(/2M\d{12}/gi) || [];
            const matches: string[] = allMatches.map(m => m.substring(0, 14).toUpperCase());
            
            // Also check structured lines and words for better accuracy
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const structuredLines = (data as any)?.lines as Array<{ text: string; confidence: number }>|undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const words = ((data as any)?.words as Array<any>)?.map((w: any) => ({ text: w.text, confidence: w.confidence })) ?? [];
            
            // Extract from structured lines
            if (structuredLines && structuredLines.length > 0) {
                for (const line of structuredLines) {
                    const lineText = postProcessOcrText((line.text || "").trim());
                    const lineMatches = lineText.match(/2M\d{12}/gi);
                    if (lineMatches) {
                        // Extract only first 14 characters from each match
                        const extracted14 = lineMatches.map(m => m.substring(0, 14).toUpperCase());
                        matches.push(...extracted14);
                    }
                }
            }
            
            // Extract from words (group consecutive words that might form 2M codes)
            if (words.length > 0) {
                let wordSequence = "";
                for (const word of words) {
                    const wordText = postProcessOcrText(String(word.text || ""));
                    wordSequence += wordText;
                    // Check if sequence contains 2M code
                    const seqMatches = wordSequence.match(/2M\d{12}/gi);
                    if (seqMatches) {
                        // Extract only first 14 characters from each match
                        const extracted14 = seqMatches.map(m => m.substring(0, 14).toUpperCase());
                        matches.push(...extracted14);
                        wordSequence = ""; // Reset after finding a match
                    }
                    // Limit sequence length to avoid too long strings
                    if (wordSequence.length > 20) {
                        wordSequence = wordSequence.slice(-15); // Keep last 15 chars
                    }
                }
            }
            
            // Remove duplicates and ensure exactly 14 characters
            const uniqueMatches = Array.from(new Set(matches))
                .filter(m => m.length === 14 && m.startsWith("2M"));
            
            const extracted: OcrItem[] = uniqueMatches.map(match => ({
                text: match,
                confidence: 80, // Default confidence for pattern-matched items
                edited: false
            }));

            setItems(extracted);
            setStatus(`OCR 완료: ${extracted.length}개 항목 인식 (2M으로 시작하는 14자리만 추출)`);
        } else {
            setImageUrl(null);
            setStatus("이미지 파일만 지원됩니다.");
        }
    }, []);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void handleFile(file);
        }
    }, [handleFile]);

    const handleItemEdit = useCallback((index: number, newText: string) => {
        setItems(prev => prev.map((item, i) => 
            i === index 
                ? { ...item, text: newText.toUpperCase(), edited: true }
                : item
        ));
    }, []);

    const handleItemDelete = useCallback((index: number) => {
        setItems(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleConfirm = useCallback(async () => {
        if (items.length === 0) {
            setStatus("저장할 항목이 없습니다.");
            return;
        }

        setUploading(true);
        setStatus("저장 중...");
        
        try {
            // Normalize and prepare items for mo_scan_items
            // Filter out empty or invalid items
            const payload = items
                .map(item => {
                    const normalized = normalizeBarcode(item.text);
                    return {
                        text: normalized,
                        prefixes: "2M",
                        matched: false // These are unmatched items from printed paper
                    };
                })
                .filter(item => item.text && item.text.length > 0 && item.text.startsWith("2M")); // Remove empty or invalid items

            if (payload.length === 0) {
                setStatus("저장할 유효한 항목이 없습니다. (빈 항목 또는 2M으로 시작하지 않는 항목 제외)");
                setUploading(false);
                return;
            }

            const { error } = await supabase
                .from("mo_scan_items")
                .upsert(payload, { onConflict: "text" });

            if (error) throw error;

            setStatus(`확정 완료: ${payload.length}개 항목이 mo_scan_items에 저장되었습니다.`);
            
            // Clear items after successful save
            setTimeout(() => {
                setItems([]);
                setImageUrl(null);
                setStatus("");
            }, 2000);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`저장 실패: ${msg}`);
        } finally {
            setUploading(false);
        }
    }, [items]);

    return (
        <div className="w-full max-w-6xl mx-auto space-y-4 px-4 py-6">
            <h1 className="text-2xl sm:text-3xl font-semibold">카메라 OCR (2M 인식)</h1>
            
            {status && (
                <div className="rounded border bg-white p-3 text-sm sm:text-base" style={{ color: '#000000' }}>
                    {status}
                    {progress > 0 && progress < 100 && (
                        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                            <div 
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* File Upload Section */}
            <div className="rounded border bg-white p-4">
                <label className="block cursor-pointer">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileInput}
                        className="hidden"
                    />
                    <div className="w-full rounded border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                        <div className="text-gray-600 font-medium text-lg">📷 이미지 업로드 / 카메라 촬영</div>
                        <div className="text-sm text-gray-500 mt-2">파일 선택 또는 카메라로 촬영</div>
                    </div>
                </label>
            </div>

            {/* Image Preview */}
            {imageUrl && (
                <div className="rounded border bg-white p-4">
                    <h2 className="text-lg font-medium mb-3">이미지 미리보기</h2>
                    <img 
                        src={imageUrl} 
                        alt="OCR Preview" 
                        className="max-w-full h-auto rounded border"
                    />
                </div>
            )}

            {/* OCR Results List */}
            {items.length > 0 && (
                <div className="rounded border bg-white p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-medium">
                            인식된 항목 ({items.length}개) - 2M으로 시작하는 14자리만 표시
                        </h2>
                        <button
                            onClick={handleConfirm}
                            disabled={uploading}
                            className={`px-4 py-2 rounded font-medium ${
                                uploading
                                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"
                            }`}
                        >
                            {uploading ? "저장 중..." : "확정"}
                        </button>
                    </div>
                    
                    <div className="space-y-2 max-h-[60vh] overflow-auto">
                        {items.map((item, index) => (
                            <div 
                                key={index}
                                className="flex items-center gap-2 p-3 border rounded bg-gray-50"
                            >
                                <input
                                    type="text"
                                    value={item.text}
                                    onChange={(e) => handleItemEdit(index, e.target.value)}
                                    className={`flex-1 px-3 py-2 rounded border font-mono text-base font-bold ${
                                        item.edited 
                                            ? "bg-yellow-50 border-yellow-400" 
                                            : "bg-white border-gray-300"
                                    }`}
                                    placeholder="2M으로 시작하는 번호"
                                    style={{ 
                                        color: '#000000',
                                        fontWeight: 'bold',
                                        WebkitTextFillColor: '#000000',
                                        caretColor: '#000000'
                                    }}
                                />
                                <button
                                    onClick={() => handleItemDelete(index)}
                                    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 active:bg-red-700"
                                >
                                    삭제
                                </button>
                                {item.edited && (
                                    <span className="text-xs text-yellow-600">수정됨</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

