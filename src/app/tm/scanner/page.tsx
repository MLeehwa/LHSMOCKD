"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";

type ScanRecord = {
	barcode: string;
	scan_date: string;
	is_return: boolean;
	scanned_at: string;
	pallet_no?: string; // 팔렛 번호
	date_count?: number; // 해당 날짜의 총 개수
	pallet_count?: number; // 해당 팔렛의 총 개수
};

type DateStats = {
	date: string;
	count: number;
};

type PalletStats = {
	palletNo: string;
	count: number;
};

export default function TMScannerPage() {
	const [currentCode, setCurrentCode] = useState<string>("");
	const [isReturn, setIsReturn] = useState<boolean | null>(null);
	const [lastScanned, setLastScanned] = useState<ScanRecord | null>(null);
	const [dateStats, setDateStats] = useState<DateStats | null>(null);
	const [palletStats, setPalletStats] = useState<PalletStats | null>(null);
	const [status, setStatus] = useState<string>("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [autoSubmit] = useState<boolean>(true);
	const [submitDelayMs] = useState<number>(200);
	const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Auto focus barcode input
	useEffect(() => {
		const focusBarcode = () => {
			inputRef.current?.focus();
		};
		setTimeout(focusBarcode, 100);
		const onFocus = () => {
			if (document.activeElement !== inputRef.current) {
				focusBarcode();
			}
		};
		window.addEventListener("click", onFocus);
		window.addEventListener("focus", focusBarcode);
		return () => {
			window.removeEventListener("click", onFocus);
			window.removeEventListener("focus", focusBarcode);
		};
	}, []);

	// Load recent scans - 제거 (DB에서 로드하지 않음)
	// Recent scans는 현재 세션에서만 유지

	useEffect(() => {
		// Auto focus on mount
		inputRef.current?.focus();
	}, []);

	const scanBarcode = useCallback(async (text: string) => {
		if (!text || text.trim().length === 0) return;
		const normalized = normalizeBarcode(text);
		if (!normalized || normalized.length === 0) return;

		setStatus("Checking...");

		try {
			// Check if barcode exists in TM barcodes
			const { data: tmData, error: tmError } = await supabase
				.from("mo_tm_barcodes")
				.select("barcode, product_date, pallet_no")
				.eq("barcode", normalized)
				.single();

			const isReturnItem = !!tmData;
			setIsReturn(isReturnItem);

			// Get date and pallet info from TM barcode
			let scanDate = new Date().toISOString().split('T')[0];
			let dateCount = 0;
			let palletNo = "";
			let palletCount = 0;

			if (tmData) {
				// Use product_date directly
				scanDate = tmData.product_date;
				palletNo = tmData.pallet_no || "";
				
				// Count total items with same product_date
				const { data: countData, error: countError } = await supabase
					.from("mo_tm_barcodes")
					.select("id")
					.eq("product_date", scanDate);

				if (!countError && countData) {
					dateCount = countData.length;
				}

				// Count total items with same pallet_no (if exists)
				if (palletNo) {
					const { data: palletData, error: palletError } = await supabase
						.from("mo_tm_barcodes")
						.select("id")
						.eq("pallet_no", palletNo);

					if (!palletError && palletData) {
						palletCount = palletData.length;
					}
				}
			}

			// Update UI (로컬 상태만 업데이트, DB에 저장하지 않음)
			const newScan: ScanRecord = {
				barcode: normalized,
				scan_date: scanDate,
				is_return: isReturnItem,
				scanned_at: new Date().toISOString(),
				pallet_no: isReturnItem ? palletNo : undefined,
				date_count: isReturnItem ? dateCount : undefined, // RETURN인 경우에만 개수 저장
				pallet_count: isReturnItem && palletNo ? palletCount : undefined,
			};

			setLastScanned(newScan);

			if (isReturnItem) {
				setDateStats({
					date: scanDate,
					count: dateCount,
				});
				if (palletNo) {
					setPalletStats({
						palletNo: palletNo,
						count: palletCount,
					});
				} else {
					setPalletStats(null);
				}
				setStatus(`✅ RETURN - Found in ${scanDate} (${dateCount} items)`);
			} else {
				setDateStats(null);
				setPalletStats(null);
				setStatus(`❌ NO - Not found in TM list`);
			}

			// Play sound
			const audioFreq = isReturnItem ? 1000 : 400;
			const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			const oscillator = audioContext.createOscillator();
			const gainNode = audioContext.createGain();
			oscillator.connect(gainNode);
			gainNode.connect(audioContext.destination);
			oscillator.frequency.value = audioFreq;
			oscillator.type = 'sine';
			gainNode.gain.value = 0.3;
			oscillator.start();
			setTimeout(() => oscillator.stop(), isReturnItem ? 200 : 300);

		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Error: ${msg}`);
			console.error("Scan failed", e);
		}
	}, []);

	const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			const code = currentCode;
			setCurrentCode("");
			if (code.length > 0) scanBarcode(code);
			e.preventDefault();
		}
	}, [scanBarcode, currentCode]);

	// Auto submit when typing stops
	useEffect(() => {
		if (!autoSubmit) return;
		if (!currentCode) return;
		if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
		submitTimerRef.current = setTimeout(() => {
			const code = currentCode;
			setCurrentCode("");
			if (code.length > 0) scanBarcode(code);
		}, Math.max(100, submitDelayMs));
		return () => {
			if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
		};
	}, [autoSubmit, submitDelayMs, currentCode, scanBarcode]);

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleString("ko-KR", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		});
	};

	const formatDateTime = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleString("ko-KR", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	// Background color based on scan result
	const bgColor = isReturn === null 
		? "bg-gray-50" 
		: isReturn 
		? "bg-green-100" 
		: "bg-red-100";

	return (
		<div className={`min-h-screen ${bgColor} transition-colors duration-300`}>
			<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4 py-4">
				<div className="flex items-center justify-between mb-4 gap-2">
					<h1 className="text-xl sm:text-3xl font-semibold flex-1">TM Scanner</h1>
				</div>

				{/* Barcode input */}
				<div className={`rounded border-4 p-4 ${isReturn === null ? "border-blue-400 bg-blue-50" : isReturn ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"}`}>
					<label className="block text-lg text-gray-800 mb-3 font-bold">Scan Barcode</label>
					<input
						ref={inputRef}
						type="text"
						value={currentCode}
						onChange={(e) => setCurrentCode(e.target.value)}
						onKeyDown={handleKey}
						className="w-full rounded border-2 border-gray-400 px-4 py-4 text-2xl font-mono text-gray-900 placeholder-gray-500 bg-white focus:outline-none focus:ring-4 focus:ring-blue-400"
						placeholder="Scan barcode..."
						autoComplete="off"
						autoFocus
					/>
				</div>

				{/* Result Display */}
				{lastScanned && (
					<div className={`rounded-lg border-4 p-6 text-center ${lastScanned.is_return ? "border-green-600 bg-green-50" : "border-red-600 bg-red-50"}`}>
						<div className={`text-6xl font-bold mb-4 ${lastScanned.is_return ? "text-green-700" : "text-red-700"}`}>
							{lastScanned.is_return ? "✅ RETURN" : "❌ NO"}
						</div>
						<div className="text-xl font-mono text-gray-900 mb-2">
							{lastScanned.barcode}
						</div>
						{lastScanned.is_return && dateStats && (
							<div className="text-xl text-green-800 font-bold space-y-1">
								<div>RETURN DATE : {formatDate(lastScanned.scan_date)}</div>
								<div>TOTAL : {dateStats.count}</div>
							</div>
						)}
						{lastScanned.is_return && palletStats && (
							<div className="mt-4 pt-4 border-t-2 border-green-300">
								<div className="text-3xl text-purple-700 font-bold space-y-2">
									<div>PALLET NO : {palletStats.palletNo}</div>
									<div className="text-4xl">PALLET TOTAL : {palletStats.count}</div>
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
