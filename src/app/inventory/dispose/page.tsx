"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";

type DisposedItem = {
	barcode: string;
	disposed_at: string;
	received_at: string;
};

export default function DisposePage() {
	const [prefixText] = useState<string>("1M,2M");
	const [disposedItems, setDisposedItems] = useState<DisposedItem[]>([]);
	const [todayCount, setTodayCount] = useState<number>(0);
	const [status, setStatus] = useState<string>("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [currentCode, setCurrentCode] = useState<string>("");
	const [autoSubmit] = useState<boolean>(true);
	const [submitDelayMs] = useState<number>(200);
	const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const seenRef = useRef<Set<string>>(new Set());

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
			setStatus(`Skipped: ${normalized} (prefix mismatch)`);
			return;
		}
		if (seenRef.current.has(normalized)) {
			setStatus(`Already disposed: ${normalized}`);
			return;
		}

		try {
			// Check if item exists and is not already disposed
			const { data: existing, error: checkError } = await supabase
				.from("mo_lq2_inventory")
				.select("id, disposed_at, received_at")
				.eq("barcode", normalized)
				.is("disposed_at", null)
				.single();

			if (checkError || !existing) {
				setStatus(`Not received or already disposed: ${normalized}`);
				return;
			}

			// Update inventory record with disposed_at
			const { data, error } = await supabase
				.from("mo_lq2_inventory")
				.update({
					disposed_at: new Date().toISOString(),
				})
				.eq("id", existing.id)
				.select()
				.single();

			if (error) {
				throw error;
			}

			// Update UI
			const newItem = {
				barcode: normalized,
				disposed_at: data.disposed_at,
				received_at: existing.received_at,
			};
			setDisposedItems(prev => [newItem, ...prev]);
			
			// Update today count if disposed today
			const disposedDate = new Date(data.disposed_at);
			const today = new Date();
			if (disposedDate.toDateString() === today.toDateString()) {
				setTodayCount(prev => prev + 1);
			}
			
			seenRef.current.add(normalized);
			setStatus(`Disposed: ${normalized}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Dispose failed: ${msg}`);
			console.error("Dispose failed", e);
		}
	}, [shouldInclude]);

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

	const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			const code = currentCode;
			setCurrentCode("");
			if (code.length > 0) addItem(code);
			e.preventDefault();
		}
	}, [addItem, currentCode]);

	// Auto submit when typing stops
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

	// Load disposed items from database
	const loadDisposedItems = useCallback(async () => {
		try {
			const { data, error } = await supabase
				.from("mo_lq2_inventory")
				.select("barcode, disposed_at, received_at")
				.not("disposed_at", "is", null)
				.order("disposed_at", { ascending: false })
				.limit(100);

			if (error) throw error;

			// Filter by prefix (same as OCR/SCAN)
			const items: DisposedItem[] = (data || [])
				.map(item => ({
					barcode: item.barcode,
					disposed_at: item.disposed_at,
					received_at: item.received_at,
				}))
				.filter(item => shouldInclude(item.barcode));

			setDisposedItems(items);
			items.forEach(item => seenRef.current.add(item.barcode));
			
			// Count today's disposed items
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayCount = items.filter(item => {
				const disposedDate = new Date(item.disposed_at);
				disposedDate.setHours(0, 0, 0, 0);
				return disposedDate.getTime() === today.getTime();
			}).length;
			setTodayCount(todayCount);
			
			setStatus(`Loaded: ${items.length} disposed items`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Load failed: ${msg}`);
			console.error("Load failed", e);
		}
	}, [shouldInclude]);

	useEffect(() => {
		void loadDisposedItems();
	}, [loadDisposedItems]);

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleString("ko-KR", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const calculateDays = (receivedAt: string, disposedAt: string) => {
		const received = new Date(receivedAt);
		const disposed = new Date(disposedAt);
		const diffTime = disposed.getTime() - received.getTime();
		const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
		return diffDays;
	};

	return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			<div className="flex items-center justify-between mb-4 gap-2">
				<h1 className="text-xl sm:text-3xl font-semibold flex-1">Dispose</h1>
				<Link
					href="/inventory"
					className="px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 min-h-[44px] sm:min-h-[48px] min-w-[80px] sm:min-w-[100px] flex items-center justify-center touch-manipulation flex-shrink-0"
				>
					← Back
				</Link>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 gap-3">
				<div className="rounded-lg border-2 border-red-400 bg-red-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-red-700 font-medium mb-1">Total Disposed</div>
					<div className="text-2xl sm:text-3xl font-bold text-red-800">{disposedItems.length}</div>
				</div>
				<div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-emerald-700 font-medium mb-1">Today</div>
					<div className="text-2xl sm:text-3xl font-bold text-emerald-800">{todayCount}</div>
				</div>
			</div>

			{/* Barcode input */}
			<div className="rounded border border-red-300 bg-red-50 p-3">
				<label className="block text-sm text-gray-800 mb-2 font-semibold">Barcode Scan</label>
				<input
					ref={inputRef}
					type="text"
					value={currentCode}
					onChange={(e) => setCurrentCode(e.target.value)}
					onKeyDown={handleKey}
					className="w-full rounded border border-red-400 px-3 py-3 text-lg font-mono text-gray-900 placeholder-gray-500 bg-white focus:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400"
					placeholder="Scan barcode..."
					autoComplete="off"
					autoFocus
				/>
			</div>

			{/* Status message */}
			{status && (
				<div className="rounded border bg-white p-2 text-sm text-gray-700">{status}</div>
			)}

			{/* Disposed items list */}
			<div className="rounded border bg-white p-3 sm:p-4">
				<h2 className="font-medium text-base sm:text-sm mb-3">
					Disposed List ({disposedItems.length})
				</h2>
				<ul className="space-y-2 max-h-[50vh] sm:max-h-96 overflow-auto">
					{disposedItems.map((item, idx) => {
						const days = calculateDays(item.received_at, item.disposed_at);
						return (
							<li
								key={`${item.barcode}-${idx}`}
								className="rounded border border-red-200 bg-red-50 px-3 py-2.5 sm:px-3 sm:py-2 flex items-center justify-between gap-2"
							>
								<div className="flex-1">
									<span className="font-mono text-base sm:text-sm text-gray-900">{item.barcode}</span>
									<div className="text-xs text-gray-600 mt-1">
										Received: {formatDate(item.received_at)} | Disposed: {formatDate(item.disposed_at)} | Days: {days}
									</div>
								</div>
							</li>
						);
					})}
					{disposedItems.length === 0 && (
						<li className="text-base sm:text-sm text-gray-500 italic py-4">No disposed items</li>
					)}
				</ul>
			</div>
		</div>
	);
}

