"use client";
import { useEffect, useRef, useState } from "react";
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.css";

type BarcodeHandsontableProps = {
	onSave: (barcodes: string[]) => Promise<void>;
	initialData?: string[];
};

export function BarcodeHandsontable({ onSave, initialData = [] }: BarcodeHandsontableProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hotRef = useRef<Handsontable | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [status, setStatus] = useState<string>("");

	useEffect(() => {
		if (!containerRef.current) return;

		// Initialize data with initial values or empty rows
		const data = initialData.length > 0 
			? initialData.map(b => [b])
			: [];

		const hot = new Handsontable(containerRef.current, {
			data,
			colHeaders: ["Barcode"],
			rowHeaders: true,
			width: "100%",
			height: 400,
			minSpareRows: 5,
			minRows: 10,
			licenseKey: "non-commercial-and-evaluation",
			contextMenu: true,
			manualColumnResize: true,
			columns: [
				{
					data: 0,
					type: "text",
				},
			],
		});

		hotRef.current = hot;

		return () => {
			hot.destroy();
			hotRef.current = null;
		};
	}, [initialData]);

	const handleSave = async () => {
		if (!hotRef.current) return;

		setIsSaving(true);
		setStatus("Saving...");

		try {
			const data = hotRef.current.getData() as string[][];
			const allBarcodes = data
				.map(row => row[0])
				.filter(barcode => barcode && barcode.trim().length > 0)
				.map(barcode => barcode.trim());

			if (allBarcodes.length === 0) {
				setStatus("No barcodes to save");
				setIsSaving(false);
				return;
			}

			// Remove duplicates
			const uniqueBarcodes = Array.from(new Set(allBarcodes));
			const duplicateCount = allBarcodes.length - uniqueBarcodes.length;

			await onSave(uniqueBarcodes);
			
			let statusMsg = `Successfully saved ${uniqueBarcodes.length} barcodes`;
			if (duplicateCount > 0) {
				statusMsg += ` (${duplicateCount} duplicates removed)`;
			}
			setStatus(statusMsg);
			
			// Clear the table after successful save
			hotRef.current.loadData([]);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			setStatus(`Save failed: ${msg}`);
			console.error("Save error:", error);
		} finally {
			setIsSaving(false);
		}
	};

	const handleClear = () => {
		if (!hotRef.current) return;
		if (!confirm("Clear all barcodes?")) return;
		
		hotRef.current.loadData([]);
		setStatus("Cleared all data");
	};

	return (
		<div className="rounded border border-purple-300 bg-purple-50 p-3">
			<div className="flex items-center justify-between gap-3 mb-3">
				<label className="block text-sm text-gray-800 font-semibold">
					Expected Barcodes List
				</label>
				<div className="flex gap-2">
					<button
						onClick={handleClear}
						disabled={isSaving}
						className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
							isSaving
								? "bg-gray-300 text-gray-500 cursor-not-allowed"
								: "bg-gray-600 text-white hover:bg-gray-700 active:bg-gray-800"
						}`}
					>
						Clear
					</button>
					<button
						onClick={handleSave}
						disabled={isSaving}
						className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
							isSaving
								? "bg-gray-300 text-gray-500 cursor-not-allowed"
								: "bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800"
						}`}
					>
						{isSaving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
			<div ref={containerRef} className="bg-white rounded" />
			{status && (
				<div className="text-xs text-gray-700 mt-2 bg-white rounded px-2 py-1">
					{status}
				</div>
			)}
			<div className="text-xs text-gray-600 mt-2">
				Enter barcodes or paste from Excel (Ctrl+V). Supports unlimited rows.
			</div>
		</div>
	);
}
