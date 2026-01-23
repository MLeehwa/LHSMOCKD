"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";
import { BarcodeHandsontable } from "../../../components/BarcodeHandsontable";

type ExpectedBarcode = {
	id: number;
	barcode: string;
	received: boolean;
	uploaded_at: string;
};

export default function ARNPage() {
	const [expectedBarcodes, setExpectedBarcodes] = useState<ExpectedBarcode[]>([]);
	const [status, setStatus] = useState<string>("");
	const [isLoading, setIsLoading] = useState<boolean>(false);

	// Load expected barcodes from database
	const loadExpectedBarcodes = useCallback(async () => {
		setIsLoading(true);
		try {
			const { data, error } = await supabase
				.from("mo_lq2_expected_barcodes")
				.select("id, barcode, received, uploaded_at")
				.order("uploaded_at", { ascending: false });

			if (error) throw error;

			const barcodes: ExpectedBarcode[] = (data || []).map(item => ({
				id: item.id,
				barcode: item.barcode,
				received: item.received || false,
				uploaded_at: item.uploaded_at,
			}));

			setExpectedBarcodes(barcodes);
			setStatus(`Loaded ${barcodes.length} expected barcodes`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Failed to load: ${msg}`);
			console.error("Failed to load expected barcodes", e);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Save expected barcodes to database
	const handleSaveExpectedBarcodes = useCallback(async (barcodes: string[]) => {
		setIsLoading(true);
		try {
			// Clear existing expected barcodes
			const { error: deleteError } = await supabase
				.from("mo_lq2_expected_barcodes")
				.delete()
				.neq("id", 0);

			if (deleteError) throw deleteError;

			// Insert new expected barcodes
			const normalizedBarcodes = barcodes.map(barcode => ({
				barcode: normalizeBarcode(barcode),
				received: false,
				uploaded_at: new Date().toISOString(),
			}));

			const { error: insertError } = await supabase
				.from("mo_lq2_expected_barcodes")
				.insert(normalizedBarcodes);

			if (insertError) throw insertError;

			// Reload expected barcodes
			await loadExpectedBarcodes();
			setStatus(`✅ Successfully saved ${barcodes.length} expected barcodes`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`❌ Failed to save: ${msg}`);
			throw new Error(`Failed to save expected barcodes: ${msg}`);
		} finally {
			setIsLoading(false);
		}
	}, [loadExpectedBarcodes]);

	useEffect(() => {
		void loadExpectedBarcodes();
	}, [loadExpectedBarcodes]);

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

	const totalCount = expectedBarcodes.length;
	const receivedCount = expectedBarcodes.filter(eb => eb.received).length;
	const pendingCount = totalCount - receivedCount;
	const receivedPercentage = totalCount > 0 ? Math.round((receivedCount / totalCount) * 100) : 0;

	return (
		<div className="w-full max-w-7xl mx-auto space-y-4 px-2 sm:px-4">
			<div className="flex items-center justify-between mb-4 gap-2">
				<h1 className="text-xl sm:text-3xl font-semibold flex-1">ARN - Advanced Receiving Notice</h1>
				<Link
					href="/inventory"
					className="px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 min-h-[44px] sm:min-h-[48px] min-w-[80px] sm:min-w-[100px] flex items-center justify-center touch-manipulation flex-shrink-0"
				>
					← Back
				</Link>
			</div>


			{/* Status message */}
			{status && (
				<div className="rounded border bg-white p-3 text-sm text-gray-700 shadow">
					{status}
				</div>
			)}

			{/* Handsontable for managing expected barcodes */}
			<div className="space-y-3">
				<BarcodeHandsontable
					onSave={handleSaveExpectedBarcodes}
					initialData={[]}
				/>
			</div>

			{/* Expected Barcodes List */}
			{totalCount > 0 && (
				<div className="rounded border bg-white p-3 sm:p-4 shadow">
					<div className="flex items-center justify-between mb-3">
						<h2 className="font-medium text-base sm:text-lg">
							Expected Barcodes List ({receivedCount}/{totalCount})
						</h2>
						<div className="flex gap-2 text-xs sm:text-sm">
							<span className="px-2 py-1 rounded bg-green-100 text-green-800">
								✅ Received: {receivedCount}
							</span>
							<span className="px-2 py-1 rounded bg-orange-100 text-orange-800">
								⏳ Pending: {pendingCount}
							</span>
						</div>
					</div>
					
					{/* Progress bar */}
					<div className="mb-4">
						<div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
							<div
								className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-500"
								style={{ width: `${receivedPercentage}%` }}
							/>
						</div>
						<div className="text-xs text-gray-600 mt-1 text-center">
							{receivedCount} of {totalCount} received ({receivedPercentage}%)
						</div>
					</div>

					<ul className="space-y-2 max-h-[60vh] overflow-auto">
						{expectedBarcodes.map((item) => (
							<li
								key={item.id}
								className={`rounded border px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${
									item.received
										? "border-green-300 bg-green-50"
										: "border-orange-200 bg-orange-50"
								}`}
							>
								<div className="flex-1">
									<span className="font-mono text-sm sm:text-base text-gray-900">
										{item.barcode}
									</span>
									<div className="text-xs text-gray-600 mt-1">
										Uploaded: {formatDate(item.uploaded_at)}
									</div>
								</div>
								<span className={`text-xs sm:text-sm font-semibold px-2 py-1 rounded ${
									item.received
										? "bg-green-200 text-green-800"
										: "bg-orange-200 text-orange-800"
								}`}>
									{item.received ? "✅ Received" : "⏳ Pending"}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{totalCount === 0 && !isLoading && (
				<div className="rounded border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
					<div className="text-gray-500 text-base sm:text-lg mb-2">
						No expected barcodes yet
					</div>
					<div className="text-gray-400 text-sm">
						Use the table above to enter or paste expected barcodes, then click "Save & Enable Validation"
					</div>
				</div>
			)}
		</div>
	);
}
