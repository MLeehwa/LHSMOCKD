"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";
import { ErrorModal } from "../../../components/ErrorModal";

type ReceivedItem = {
	barcode: string;
	received_at: string;
};

type ExpectedBarcode = {
	id: number;
	barcode: string;
	received: boolean;
};

export default function ReceivePage() {
	const [prefixText] = useState<string>("1M,2M");
	const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);
	const [todayCount, setTodayCount] = useState<number>(0);
	const [status, setStatus] = useState<string>("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [currentCode, setCurrentCode] = useState<string>("");
	const [autoSubmit] = useState<boolean>(true);
	const [submitDelayMs] = useState<number>(200);
	const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const seenRef = useRef<Set<string>>(new Set());
	const [expectedBarcodes, setExpectedBarcodes] = useState<ExpectedBarcode[]>([]);
	const [validationEnabled, setValidationEnabled] = useState<boolean>(true); // Always enabled by default
	const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
	const [errorMessage, setErrorMessage] = useState<string>("");

	const allowedPrefixes = useCallback(() =>
		prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);

	const shouldInclude = useCallback((text: string) => {
		const p = allowedPrefixes();
		if (p.length === 0) return true;
		return p.some(pref => text.startsWith(pref));
	}, [allowedPrefixes]);

	// Load expected barcodes from database
	const loadExpectedBarcodes = useCallback(async () => {
		try {
			const { data, error } = await supabase
				.from("mo_lq2_expected_barcodes")
				.select("id, barcode, received")
				.order("created_at", { ascending: false });

			if (error) throw error;

			const barcodes: ExpectedBarcode[] = (data || []).map(item => ({
				id: item.id,
				barcode: item.barcode,
				received: item.received || false,
			}));

			setExpectedBarcodes(barcodes);
			// Keep validation enabled - don't change it based on barcode count
			
			console.log("🔍 [ARN] Loaded expected barcodes:", barcodes.length);
			console.log("🔍 [ARN] First 5 barcodes:", barcodes.slice(0, 5).map(b => b.barcode));
		} catch (e) {
			console.error("Failed to load expected barcodes", e);
		}
	}, []);

	const addItem = useCallback(async (text: string) => {
		if (!text || text.trim().length === 0) return;
		const normalized = normalizeBarcode(text);
		if (!normalized || normalized.length === 0) return;
		if (!shouldInclude(normalized)) {
			setStatus(`❌ Skipped: ${normalized} (prefix mismatch)`);
			return;
		}
		if (seenRef.current.has(normalized)) {
			setStatus(`⚠️ Already scanned: ${normalized}`);
			return;
		}

		// NEW: Check if validation is enabled and barcode is in expected list
		console.log("🔍 [SCAN] Validation enabled:", validationEnabled);
		console.log("🔍 [SCAN] Expected barcodes count:", expectedBarcodes.length);
		console.log("🔍 [SCAN] Scanned barcode (normalized):", normalized);
		
		if (validationEnabled) {
			console.log("🔍 [SCAN] Checking against expected list...");
			
			// If ARN is empty, reject all barcodes
			if (expectedBarcodes.length === 0) {
				console.log("❌ [SCAN] No expected barcodes in ARN - rejecting!");
				setStatus(`❌ ERROR: No expected barcodes configured. Add barcodes in ARN first.`);
				setErrorMessage(normalized);
				setShowErrorModal(true);
				const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZSA0PVK3n8LRiHAU2jtry0n0qBSl+zPLaizsIGGS36+qeTA0NTKXh8bllHgU0itDx1H8tBSeBzfDaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkuOvqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAhxvzPLbizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAhxvzPLbizsIGWi78OScTgwNU=");
				audio.play().catch(() => {});
				return;
			}
			
			const expectedBarcode = expectedBarcodes.find(eb => eb.barcode === normalized);
			console.log("🔍 [SCAN] Found in expected list:", !!expectedBarcode);
			
			if (!expectedBarcode) {
				console.log("❌ [SCAN] Barcode NOT in expected list!");
				setStatus(`❌ ERROR: Barcode not in expected list: ${normalized}`);
				setErrorMessage(normalized);
				setShowErrorModal(true);
				const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZSA0PVK3n8LRiHAU2jtry0n0qBSl+zPLaizsIGGS36+qeTA0NTKXh8bllHgU0itDx1H8tBSeBzfDaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkuOvqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAiR1zPLaizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAhxvzPLbizsIGWi78OScTgwNUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF607OunVRQKRp/g8r5sIQYxh9Hz04IzBh5uwO/jmUgND1Ot5/C0YhwFNo7a8tJ9KgUpfszy2os7CBhkt+vqnkwNDUyl4fG5ZR4FNIrQ8dR/LQUngc3w2os7CBlou+/knE4MDVCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAAhxvzPLbizsIGWi78OScTgwNU=");
				audio.play().catch(() => {});
				return;
			}
			if (expectedBarcode.received) {
				console.log("⚠️ [SCAN] Barcode already received!");
				setStatus(`⚠️ Already received from expected list: ${normalized}`);
				return;
			}
			console.log("✅ [SCAN] Barcode validated successfully!");
		} else {
			console.log("ℹ️ [SCAN] Validation disabled - allowing all barcodes");
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
					setStatus(`⚠️ Already received and disposed: ${normalized}`);
				} else {
					setStatus(`⚠️ Already received: ${normalized}`);
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

			// Update expected barcode as received
			if (validationEnabled && expectedBarcodes.length > 0) {
				const expectedBarcode = expectedBarcodes.find(eb => eb.barcode === normalized);
				if (expectedBarcode) {
					await supabase
						.from("mo_lq2_expected_barcodes")
						.update({ received: true })
						.eq("id", expectedBarcode.id);
					
					// Update local state
					setExpectedBarcodes(prev => 
						prev.map(eb => eb.id === expectedBarcode.id ? { ...eb, received: true } : eb)
					);
				}
			}

			// Update UI
			const newItem = {
				barcode: normalized,
				received_at: data.received_at,
			};
			setReceivedItems(prev => [newItem, ...prev]);
			
			// Update today count if received today
			const receivedDate = new Date(data.received_at);
			const today = new Date();
			if (receivedDate.toDateString() === today.toDateString()) {
				setTodayCount(prev => prev + 1);
			}
			
			setStatus(`✅ Received: ${normalized}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`❌ Receive failed: ${msg}`);
			console.error("Receive failed", e);
		}
	}, [prefixText, shouldInclude, validationEnabled, expectedBarcodes]);

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
			
			// Count today's received items
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayCount = items.filter(item => {
				const receivedDate = new Date(item.received_at);
				receivedDate.setHours(0, 0, 0, 0);
				return receivedDate.getTime() === today.getTime();
			}).length;
			setTodayCount(todayCount);
			
			setStatus(`Loaded: ${items.length} received items`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Load failed: ${msg}`);
			console.error("Load failed", e);
		}
	}, [shouldInclude]);

	useEffect(() => {
		void loadReceivedItems();
		void loadExpectedBarcodes();
	}, [loadReceivedItems, loadExpectedBarcodes]);

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

	const expectedCount = expectedBarcodes.length;
	const receivedFromExpected = expectedBarcodes.filter(eb => eb.received).length;
	const remainingExpected = expectedCount - receivedFromExpected;

	return (
		<div className="w-full max-w-full mx-auto space-y-3 px-2 sm:px-4">
			{/* Error Modal */}
			<ErrorModal
				isOpen={showErrorModal}
				onClose={() => setShowErrorModal(false)}
				title="❌ Barcode Not Found"
				message={errorMessage}
			/>

			<div className="flex items-center justify-between mb-4 gap-2">
				<h1 className="text-xl sm:text-3xl font-semibold flex-1">Receive</h1>
				<Link
					href="/inventory"
					className="px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 min-h-[44px] sm:min-h-[48px] min-w-[80px] sm:min-w-[100px] flex items-center justify-center touch-manipulation shrink-0"
				>
					← Back
				</Link>
			</div>

			{/* Validation Status */}
			<div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 shadow-md flex items-center justify-between gap-3">
				<div className="flex-1">
					<div className="text-sm font-semibold text-amber-900 mb-1">
						{validationEnabled ? "🔒 Validation Mode Active" : "🔓 Validation Mode Disabled"}
					</div>
					<div className="text-xs text-amber-700">
						{validationEnabled ? (
							expectedCount > 0 ? (
								<>
									Only expected barcodes can be received. {remainingExpected} of {expectedCount} remaining.
									<Link 
										href="/inventory/arn"
										className="ml-2 underline hover:text-amber-900 font-semibold"
									>
										Manage in ARN →
									</Link>
								</>
							) : (
								<>
									No expected barcodes configured. All scans will be rejected.
									<Link 
										href="/inventory/arn"
										className="ml-2 underline hover:text-amber-900 font-semibold"
									>
										Add in ARN →
									</Link>
								</>
							)
						) : (
							"All barcodes can be received without validation."
						)}
					</div>
				</div>
				<button
					onClick={() => setValidationEnabled(!validationEnabled)}
					className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors shrink-0 ${
						validationEnabled
							? "bg-red-600 text-white hover:bg-red-700"
							: "bg-green-600 text-white hover:bg-green-700"
					}`}
				>
					{validationEnabled ? "Disable" : "Enable"}
				</button>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div className="rounded-lg border-2 border-blue-400 bg-blue-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-blue-700 font-medium mb-1">Total Received</div>
					<div className="text-2xl sm:text-3xl font-bold text-blue-800">{receivedItems.length}</div>
				</div>
				<div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-emerald-700 font-medium mb-1">Today</div>
					<div className="text-2xl sm:text-3xl font-bold text-emerald-800">{todayCount}</div>
				</div>
				<div className="rounded-lg border-2 border-purple-400 bg-purple-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-purple-700 font-medium mb-1">Expected</div>
					<div className="text-2xl sm:text-3xl font-bold text-purple-800">{expectedCount}</div>
				</div>
				<div className="rounded-lg border-2 border-orange-400 bg-orange-50 p-3 sm:p-4 shadow-md">
					<div className="text-xs sm:text-sm text-orange-700 font-medium mb-1">Remaining</div>
					<div className="text-2xl sm:text-3xl font-bold text-orange-800">{remainingExpected}</div>
				</div>
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
