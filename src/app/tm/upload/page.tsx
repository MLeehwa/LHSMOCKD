"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import { ThreeColumnHandsontable } from "../../../components/ThreeColumnHandsontable";

type TMBarcode = {
	id: number;
	barcode: string;
	product_date: string;
	pallet_no: string;
	created_at: string;
};

export default function TMUploadPage() {
	const [tmBarcodes, setTmBarcodes] = useState<TMBarcode[]>([]);
	const [totalCount, setTotalCount] = useState<number>(0);
	const [status, setStatus] = useState<string>("");
	const [isLoading, setIsLoading] = useState<boolean>(false);

	// Load TM barcodes from database
	const loadTMBarcodes = useCallback(async () => {
		setIsLoading(true);
		try {
			// Get total count first
			const { count, error: countError } = await supabase
				.from("mo_tm_barcodes")
				.select("*", { count: "exact", head: true });

			if (countError) throw countError;

			setTotalCount(count || 0);

			// Load only recent 100 items for display
			const { data, error } = await supabase
				.from("mo_tm_barcodes")
				.select("id, barcode, product_date, pallet_no, created_at")
				.order("created_at", { ascending: false })
				.limit(100);

			if (error) throw error;

			const barcodes: TMBarcode[] = (data || []).map(item => ({
				id: item.id,
				barcode: item.barcode,
				product_date: item.product_date,
				pallet_no: item.pallet_no || "",
				created_at: item.created_at,
			}));

			setTmBarcodes(barcodes);
			// Don't show "Loaded" message - only show errors or important messages
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`❌ Failed to load: ${msg}`);
			console.error("Failed to load TM barcodes", e);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Save TM barcodes to database (accumulate)
	const handleSaveTMBarcodes = useCallback(async (data: Array<{ date: string; barcode: string; palletNo: string }>) => {
		setIsLoading(true);
		try {
		// Filter and normalize data first
		const normalizedData = data
			.map(item => ({
				date: item.date,
				barcode: normalizeBarcode(item.barcode),
				palletNo: item.palletNo,
			}))
			.filter(item => item.barcode.length === 8 || item.barcode.length === 12)
			.map(item => ({
				barcode: item.barcode,
				product_date: item.date,
				pallet_no: item.palletNo,
			}));

		const filteredCount = data.length - data.filter(d => {
			const len = normalizeBarcode(d.barcode).length;
			return len === 8 || len === 12;
		}).length;

		// Insert in reasonable batches (200) for efficiency
		if (normalizedData.length > 0) {
			const BATCH_SIZE = 200;
			const totalBatches = Math.ceil(normalizedData.length / BATCH_SIZE);
			let totalInserted = 0;
			let totalDuplicates = 0;
			let totalErrors = 0;
			
			console.log(`Starting upload: ${normalizedData.length} items in ${totalBatches} batches`);
			
			for (let i = 0; i < totalBatches; i++) {
				const start = i * BATCH_SIZE;
				const end = Math.min((i + 1) * BATCH_SIZE, normalizedData.length);
				const batch = normalizedData.slice(start, end);
				
				setStatus(`⏳ Saving batch ${i + 1}/${totalBatches} (${start + 1}-${end} of ${normalizedData.length})...`);
				console.log(`Batch ${i + 1}/${totalBatches}: Processing ${batch.length} items`);
				
				try {
					// Try batch upsert first for speed
					const { data: insertedData, error: batchError } = await supabase
						.from("mo_tm_barcodes")
						.upsert(batch, { 
							onConflict: 'barcode,product_date',
							ignoreDuplicates: false
						})
						.select();

					if (!batchError) {
						const insertedCount = insertedData ? insertedData.length : 0;
						totalInserted += insertedCount;
						totalDuplicates += (batch.length - insertedCount);
						console.log(`Batch ${i + 1} success: ${insertedCount} inserted, ${batch.length - insertedCount} duplicates`);
					} else if (batchError.code === '23505') {
						// Duplicate error - process individually to count properly
						console.log(`Batch ${i + 1} has duplicates, processing individually...`);
						for (const item of batch) {
							const { data: singleData, error } = await supabase
								.from("mo_tm_barcodes")
								.upsert([item], { 
									onConflict: 'barcode,product_date',
									ignoreDuplicates: false
								})
								.select();

							if (!error && singleData && singleData.length > 0) {
								totalInserted++;
							} else if (!error || error.code === '23505') {
								totalDuplicates++;
							} else {
								console.error(`Error on item:`, error, item);
								totalErrors++;
							}
						}
					} else {
						console.error(`Batch ${i + 1} error:`, batchError);
						totalErrors += batch.length;
					}
				} catch (batchError) {
					console.error(`Exception on batch ${i + 1}:`, batchError);
					totalErrors += batch.length;
				}
				
				// Update progress
				console.log(`Batch ${i + 1} complete: ${totalInserted} inserted, ${totalDuplicates} duplicates, ${totalErrors} errors`);
				
				// Delay between batches
				if (i < totalBatches - 1) {
					await new Promise(resolve => setTimeout(resolve, 300));
				}
			}

			console.log(`Upload complete: ${totalInserted} inserted, ${totalDuplicates} duplicates, ${totalErrors} errors`);

			// Reload TM barcodes
			setStatus("Loading updated list...");
			await loadTMBarcodes();
			
			let statusMsg = `✅ Successfully added ${totalInserted} new TM barcodes`;
			if (totalDuplicates > 0) {
				statusMsg += ` (${totalDuplicates} duplicates skipped)`;
			}
			if (totalErrors > 0) {
				statusMsg += ` (${totalErrors} errors)`;
			}
			if (filteredCount > 0) {
				statusMsg += ` (${filteredCount} filtered - not 8 or 12 digits)`;
			}
			setStatus(statusMsg);
		} else {
				setStatus("No valid data to save");
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`❌ Failed to save: ${msg}`);
			throw new Error(`Failed to save TM barcodes: ${msg}`);
		} finally {
			setIsLoading(false);
		}
	}, [loadTMBarcodes]);

	// Clear all TM barcodes
	const handleClearAll = useCallback(async () => {
		if (!confirm("Clear all TM barcodes? This cannot be undone.")) return;
		
		setIsLoading(true);
		try {
			const { error } = await supabase
				.from("mo_tm_barcodes")
				.delete()
				.neq("id", 0);

			if (error) throw error;

			setTmBarcodes([]);
			setStatus("✅ All TM barcodes cleared");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`❌ Failed to clear: ${msg}`);
			console.error("Failed to clear", e);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadTMBarcodes();
	}, [loadTMBarcodes]);

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
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	return (
		<div className="w-full max-w-7xl mx-auto space-y-4 px-2 sm:px-4">
			<div className="flex items-center justify-between mb-4 gap-2">
				<h1 className="text-xl sm:text-3xl font-semibold flex-1">TM Upload</h1>
			</div>

			{/* Stats Card */}
			<div className="rounded-lg border-2 border-purple-400 bg-purple-50 p-3 sm:p-4 shadow-md">
				<div className="text-xs sm:text-sm text-purple-700 font-medium mb-1">Total TM Barcodes</div>
				<div className="text-2xl sm:text-3xl font-bold text-purple-800">{totalCount}</div>
			</div>

			{/* Status message */}
			{status && (
				<div className="rounded border bg-white p-3 text-sm text-gray-700 shadow">
					{status}
				</div>
			)}

			{/* Handsontable for managing TM barcodes */}
			<div className="space-y-3">
				<ThreeColumnHandsontable
					onSave={handleSaveTMBarcodes}
					initialData={[]}
				/>
				
				{totalCount > 0 && (
					<button
						onClick={handleClearAll}
						disabled={isLoading}
						className={`w-full px-4 py-3 text-sm font-semibold rounded-lg transition-colors ${
							isLoading
								? "bg-gray-300 text-gray-500 cursor-not-allowed"
								: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
						}`}
					>
						{isLoading ? "Processing..." : "Clear All TM Barcodes"}
					</button>
				)}
			</div>

			{/* TM Barcodes List */}
			{totalCount > 0 && (
				<div className="rounded border bg-white p-3 sm:p-4 shadow">
					<h2 className="font-medium text-base sm:text-lg mb-3">
						TM Barcodes List ({totalCount})
					</h2>

					<ul className="space-y-2 max-h-[60vh] overflow-auto">
						{tmBarcodes.slice(0, 100).map((item) => (
							<li
								key={item.id}
								className="rounded border border-purple-200 bg-purple-50 px-3 py-2.5 flex items-center justify-between gap-2"
							>
								<div className="flex-1">
									<span className="font-mono text-sm sm:text-base text-gray-900">
										{item.barcode}
									</span>
									<div className="text-xs text-gray-600 mt-1">
										📅 Product Date: {formatDate(item.product_date)}
										{item.pallet_no && (
											<>
												<br />
												📦 Pallet: {item.pallet_no}
											</>
										)}
									</div>
								</div>
								<span className="text-xs text-gray-500">
									{formatDateTime(item.created_at)}
								</span>
							</li>
						))}
						{totalCount > 100 && (
							<li className="text-xs text-gray-500 italic py-2">
								... and {totalCount - 100} more
							</li>
						)}
					</ul>
				</div>
			)}

			{totalCount === 0 && !isLoading && (
				<div className="rounded border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
					<div className="text-gray-500 text-base sm:text-lg mb-2">
						No TM barcodes yet
					</div>
				<div className="text-gray-400 text-sm">
					Use the table above to enter date (YYYY-MM-DD), barcode (8 or 12 digits), and pallet number, then click "Save"
				</div>
				</div>
			)}
		</div>
	);
}
