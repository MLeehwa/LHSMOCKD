"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";

type ReceivedItem = {
	barcode: string;
	received_at: string;
};

export default function ReceivePage() {
	const [prefixText] = useState<string>("1M,2M");
	const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);
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
			setStatus(`Already scanned: ${normalized}`);
			return;
		}
		seenRef.current.add(normalized);

		try {
			// Check if already received (barcode is unique - cannot be received twice)
			const { data: existing } = await supabase
				.from("mo_lq2_inventory")
				.select("id, disposed_at")
				.eq("barcode", normalized)
				.single();

			if (existing) {
				if (existing.disposed_at) {
					setStatus(`Already received and disposed: ${normalized}`);
				} else {
					setStatus(`Already received: ${normalized}`);
				}
				return;
			}

			// Insert new inventory record
			const { data, error } = await supabase
				.from("mo_lq2_inventory")
				.insert({
					barcode: normalized,
					received_at: new Date().toISOString(),
					prefixes: prefixText,
				})
				.select()
				.single();

			if (error) {
				throw error;
			}

			// Update UI
			setReceivedItems(prev => [{
				barcode: normalized,
				received_at: data.received_at,
			}, ...prev]);
			setStatus(`Received: ${normalized}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Receive failed: ${msg}`);
			console.error("Receive failed", e);
		}
	}, [prefixText, shouldInclude]);

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

	// Load received items from database
	const loadReceivedItems = useCallback(async () => {
		try {
			const { data, error } = await supabase
				.from("mo_lq2_inventory")
				.select("barcode, received_at")
				.is("disposed_at", null)
				.order("received_at", { ascending: false })
				.limit(100);

			if (error) throw error;

			// Filter by prefix (same as OCR/SCAN)
			const items: ReceivedItem[] = (data || [])
				.map(item => ({
					barcode: item.barcode,
					received_at: item.received_at,
				}))
				.filter(item => shouldInclude(item.barcode));

			setReceivedItems(items);
			items.forEach(item => seenRef.current.add(item.barcode));
			setStatus(`Loaded: ${items.length} received items`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Load failed: ${msg}`);
			console.error("Load failed", e);
		}
	}, [shouldInclude]);

	useEffect(() => {
		void loadReceivedItems();
	}, [loadReceivedItems]);

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

	return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			<div className="flex items-center justify-between mb-4">
				<h1 className="text-xl sm:text-2xl font-semibold">Receive</h1>
				<Link
					href="/inventory"
					className="px-4 py-2 text-sm font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
				>
					← Back
				</Link>
			</div>

			{/* Stats Card */}
			<div className="rounded-lg border-2 border-blue-400 bg-blue-50 p-3 sm:p-4 shadow-md">
				<div className="text-xs sm:text-sm text-blue-700 font-medium mb-1">Received Items</div>
				<div className="text-2xl sm:text-3xl font-bold text-blue-800">{receivedItems.length}</div>
			</div>

			{/* Barcode input */}
			<div className="rounded border border-blue-300 bg-blue-50 p-3">
				<label className="block text-sm text-gray-800 mb-2 font-semibold">Barcode Scan</label>
				<input
					ref={inputRef}
					type="text"
					value={currentCode}
					onChange={(e) => setCurrentCode(e.target.value)}
					onKeyDown={handleKey}
					className="w-full rounded border border-blue-400 px-3 py-3 text-lg font-mono text-gray-900 placeholder-gray-500 bg-white focus:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
					placeholder="Scan barcode..."
					autoComplete="off"
					autoFocus
				/>
			</div>

			{/* Status message */}
			{status && (
				<div className="rounded border bg-white p-2 text-sm text-gray-700">{status}</div>
			)}

			{/* Received items list */}
			<div className="rounded border bg-white p-3 sm:p-4">
				<h2 className="font-medium text-base sm:text-sm mb-3">
					Received List ({receivedItems.length})
				</h2>
				<ul className="space-y-2 max-h-[50vh] sm:max-h-96 overflow-auto">
					{receivedItems.map((item, idx) => (
						<li
							key={`${item.barcode}-${idx}`}
							className="rounded border border-blue-200 bg-blue-50 px-3 py-2.5 sm:px-3 sm:py-2 flex items-center justify-between gap-2"
						>
							<div className="flex-1">
								<span className="font-mono text-base sm:text-sm text-gray-900">{item.barcode}</span>
								<div className="text-xs text-gray-600 mt-1">
									Received: {formatDate(item.received_at)}
								</div>
							</div>
						</li>
					))}
					{receivedItems.length === 0 && (
						<li className="text-base sm:text-sm text-gray-500 italic py-4">No received items</li>
					)}
				</ul>
			</div>
		</div>
	);
}

