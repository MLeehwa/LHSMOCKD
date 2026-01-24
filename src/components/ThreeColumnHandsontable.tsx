"use client";
import { useEffect, useRef, useState } from "react";
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.css";

type ThreeColumnHandsontableProps = {
	onSave: (data: Array<{ date: string; barcode: string; palletNo: string }>) => Promise<void>;
	initialData?: Array<{ date: string; barcode: string; palletNo: string }>;
};

export function ThreeColumnHandsontable({ onSave, initialData = [] }: ThreeColumnHandsontableProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hotRef = useRef<Handsontable | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [status, setStatus] = useState<string>("");

	useEffect(() => {
		if (!containerRef.current) return;

		// Initialize data with initial values or empty rows
		const data = initialData.length > 0 
			? initialData.map(item => [item.date, item.barcode, item.palletNo])
			: [];

		const hot = new Handsontable(containerRef.current, {
			data,
			colHeaders: ["Date (YYYY-MM-DD)", "Barcode", "Pallet No"],
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
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
				{
					data: 1,
					type: "text",
				},
				{
					data: 2,
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
			const rawData = hotRef.current.getData() as string[][];
			const allRows = rawData
				.filter(row => row[0] && row[1]) // 날짜와 바코드는 필수 (팔렛번호는 선택)
				.filter(row => row[0].trim().length > 0 && row[1].trim().length > 0)
				.map(row => ({
					date: row[0].trim(),
					barcode: row[1].trim(),
					palletNo: row[2] ? row[2].trim() : "",
				}));

			if (allRows.length === 0) {
				setStatus("No data to save");
				setIsSaving(false);
				return;
			}

			// Remove duplicates (same date + barcode)
			const seen = new Set<string>();
			const uniqueRows: Array<{ date: string; barcode: string; palletNo: string }> = [];
			
			for (const row of allRows) {
				const key = `${row.date}|${row.barcode}`;
				if (!seen.has(key)) {
					seen.add(key);
					uniqueRows.push(row);
				}
			}

			const duplicateCount = allRows.length - uniqueRows.length;

			await onSave(uniqueRows);
			
			let statusMsg = `Successfully saved ${uniqueRows.length} items`;
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
		if (!confirm("Clear all data?")) return;
		
		hotRef.current.loadData([]);
		setStatus("Cleared all data");
	};

	return (
		<div className="rounded border border-purple-300 bg-purple-50 p-3">
			<div className="flex items-center justify-between gap-3 mb-3">
				<label className="block text-sm text-gray-800 font-semibold">
					TM Data (Date + Barcode + Pallet No)
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
				Enter date (YYYY-MM-DD), barcode, and pallet number, or paste from Excel (Ctrl+V). Supports unlimited rows.
			</div>
		</div>
	);
}
