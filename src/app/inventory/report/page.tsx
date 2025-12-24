"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { normalizeBarcode } from "../../../lib/barcode";
import Link from "next/link";

type InventoryItem = {
	barcode: string;
	received_at: string;
	disposed_at: string | null;
	days_in_stock: number;
	status: "Active" | "Disposed";
};

export default function ReportPage() {
	const [prefixText] = useState<string>("1M,2M");
	const [inventory, setInventory] = useState<InventoryItem[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [status, setStatus] = useState<string>("");
	const [filter, setFilter] = useState<"all" | "active" | "disposed">("all");

	const allowedPrefixes = useCallback(() =>
		prefixText.split(",").map(p => p.trim()).filter(Boolean), [prefixText]);

	const shouldInclude = useCallback((text: string) => {
		const p = allowedPrefixes();
		if (p.length === 0) return true;
		return p.some(pref => text.startsWith(pref));
	}, [allowedPrefixes]);

	// Load inventory data
	const loadInventory = useCallback(async () => {
		setLoading(true);
		try {
			const { data, error } = await supabase
				.from("mo_lq2_inventory")
				.select("barcode, received_at, disposed_at")
				.order("received_at", { ascending: false });

			if (error) throw error;

			const now = new Date();
			// Filter by prefix (same as OCR/SCAN)
			const items: InventoryItem[] = (data || [])
				.map(item => {
					const normalized = normalizeBarcode(item.barcode);
					const received = new Date(item.received_at);
					const disposed = item.disposed_at ? new Date(item.disposed_at) : null;
					const endDate = disposed || now;
					const diffTime = endDate.getTime() - received.getTime();
					const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));

					return {
						barcode: normalized,
						received_at: item.received_at,
						disposed_at: item.disposed_at,
						days_in_stock: days,
						status: (item.disposed_at ? "Disposed" : "Active") as "Active" | "Disposed",
					};
				})
				.filter(item => shouldInclude(item.barcode));

			setInventory(items);
			setStatus(`Loaded: ${items.length} items`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Load failed: ${msg}`);
			console.error("Load failed", e);
		} finally {
			setLoading(false);
		}
	}, [shouldInclude]);

	useEffect(() => {
		void loadInventory();
	}, [loadInventory]);

	const filteredInventory = inventory.filter(item => {
		if (filter === "active") return item.status === "Active";
		if (filter === "disposed") return item.status === "Disposed";
		return true;
	});

	const totalReceived = inventory.length; // 전체 입고 수 (active + disposed)
	const disposedCount = inventory.filter(item => item.status === "Disposed").length;
	const activeCount = inventory.filter(item => item.status === "Active").length; // 보유 수

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

	// Export to Excel (CSV format that Excel can open)
	const exportToExcel = useCallback(() => {
		const headers = ["Barcode", "Received Date", "Disposed Date", "Days in Stock", "Status"];
		const rows = filteredInventory.map(item => [
			item.barcode,
			formatDateTime(item.received_at),
			item.disposed_at ? formatDateTime(item.disposed_at) : "",
			item.days_in_stock.toString(),
			item.status,
		]);

		// Create CSV content
		const csvContent = [
			headers.join(","),
			...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
		].join("\n");

		// Add BOM for Excel UTF-8 support
		const BOM = "\uFEFF";
		const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
		const link = document.createElement("a");
		const url = URL.createObjectURL(blob);
		link.setAttribute("href", url);
		link.setAttribute("download", `Inventory_Report_${new Date().toISOString().split("T")[0]}.csv`);
		link.style.visibility = "hidden";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		setStatus("Excel file downloaded");
	}, [filteredInventory]);

	// Get aging groups
	const getAgingGroups = () => {
		const active = filteredInventory.filter(item => item.status === "Active");
		return {
			"0-30 days": active.filter(item => item.days_in_stock <= 30).length,
			"31-60 days": active.filter(item => item.days_in_stock > 30 && item.days_in_stock <= 60).length,
			"61-90 days": active.filter(item => item.days_in_stock > 60 && item.days_in_stock <= 90).length,
			"90+ days": active.filter(item => item.days_in_stock > 90).length,
		};
	};

	const agingGroups = getAgingGroups();

	return (
		<div className="w-full max-w-full mx-auto space-y-4 px-2 sm:px-4">
			<div className="flex items-center justify-between mb-4 gap-2">
				<h1 className="text-xl sm:text-3xl font-semibold flex-1">Inventory Report</h1>
				<Link
					href="/inventory"
					className="px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 min-h-[44px] sm:min-h-[48px] min-w-[80px] sm:min-w-[100px] flex items-center justify-center touch-manipulation flex-shrink-0"
				>
					← Back
				</Link>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				<div className="rounded-lg border-2 border-blue-400 bg-blue-50 p-3 shadow-md">
					<div className="text-xs text-blue-700 font-medium mb-1">Received</div>
					<div className="text-2xl font-bold text-blue-800">{totalReceived}</div>
				</div>
				<div className="rounded-lg border-2 border-red-400 bg-red-50 p-3 shadow-md">
					<div className="text-xs text-red-700 font-medium mb-1">Disposed</div>
					<div className="text-2xl font-bold text-red-800">{disposedCount}</div>
				</div>
				<div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 shadow-md">
					<div className="text-xs text-emerald-700 font-medium mb-1">In Stock</div>
					<div className="text-2xl font-bold text-emerald-800">{activeCount}</div>
				</div>
			</div>

			{/* Aging Groups */}
			{filter === "all" || filter === "active" ? (
				<div className="rounded border bg-white p-4">
					<h2 className="font-medium mb-3">Aging Report (Active Only)</h2>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						<div className="rounded border border-gray-200 bg-gray-50 p-3">
							<div className="text-xs text-gray-600 mb-1">0-30 days</div>
							<div className="text-xl font-bold text-gray-800">{agingGroups["0-30 days"]}</div>
						</div>
						<div className="rounded border border-gray-200 bg-gray-50 p-3">
							<div className="text-xs text-gray-600 mb-1">31-60 days</div>
							<div className="text-xl font-bold text-gray-800">{agingGroups["31-60 days"]}</div>
						</div>
						<div className="rounded border border-gray-200 bg-gray-50 p-3">
							<div className="text-xs text-gray-600 mb-1">61-90 days</div>
							<div className="text-xl font-bold text-gray-800">{agingGroups["61-90 days"]}</div>
						</div>
						<div className="rounded border border-gray-200 bg-gray-50 p-3">
							<div className="text-xs text-gray-600 mb-1">90+ days</div>
							<div className="text-xl font-bold text-gray-800">{agingGroups["90+ days"]}</div>
						</div>
					</div>
				</div>
			) : null}

			{/* Filter and Export */}
			<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full">
				<div className="flex gap-2 sm:gap-3 flex-1 w-full sm:w-auto">
					<button
						onClick={() => setFilter("all")}
						className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-semibold rounded-lg min-h-[48px] flex-1 touch-manipulation ${
							filter === "all"
								? "bg-gray-900 text-white"
								: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
						}`}
					>
						All
					</button>
					<button
						onClick={() => setFilter("active")}
						className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-semibold rounded-lg min-h-[48px] flex-1 touch-manipulation ${
							filter === "active"
								? "bg-emerald-600 text-white"
								: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
						}`}
					>
						Active
					</button>
					<button
						onClick={() => setFilter("disposed")}
						className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-semibold rounded-lg min-h-[48px] flex-1 touch-manipulation ${
							filter === "disposed"
								? "bg-red-600 text-white"
								: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
						}`}
					>
						Disposed
					</button>
				</div>
				<button
					onClick={exportToExcel}
					disabled={filteredInventory.length === 0}
					className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-semibold rounded-lg min-h-[48px] w-full sm:w-auto sm:min-w-[140px] touch-manipulation ${
						filteredInventory.length === 0
							? "bg-gray-300 text-gray-500 cursor-not-allowed"
							: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"
					}`}
				>
					📥 Export Excel
				</button>
			</div>

			{/* Status message */}
			{status && (
				<div className="rounded border bg-white p-2 text-sm text-gray-700">{status}</div>
			)}

			{/* Inventory Table */}
			<div className="rounded border bg-white p-3 sm:p-4 overflow-x-auto">
				<h2 className="font-medium text-base sm:text-sm mb-3">
					Inventory List ({filteredInventory.length})
				</h2>
				{loading ? (
					<div className="text-center py-8 text-gray-500">Loading...</div>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b bg-gray-50">
								<th className="text-left p-2 font-medium">Barcode</th>
								<th className="text-left p-2 font-medium">Received Date</th>
								<th className="text-left p-2 font-medium">Disposed Date</th>
								<th className="text-right p-2 font-medium">Days in Stock</th>
								<th className="text-center p-2 font-medium">Status</th>
							</tr>
						</thead>
						<tbody>
							{filteredInventory.map((item, idx) => (
								<tr
									key={`${item.barcode}-${idx}`}
									className={`border-b ${
										item.status === "Active"
											? item.days_in_stock > 90
												? "bg-red-50"
												: item.days_in_stock > 60
													? "bg-yellow-50"
													: "bg-white"
											: "bg-gray-50"
									}`}
								>
									<td className="p-2 font-mono">{item.barcode}</td>
									<td className="p-2">{formatDateTime(item.received_at)}</td>
									<td className="p-2">
										{item.disposed_at ? formatDateTime(item.disposed_at) : "-"}
									</td>
									<td className="p-2 text-right">{item.days_in_stock}</td>
									<td className="p-2 text-center">
										<span
											className={`px-2 py-1 rounded text-xs font-medium ${
												item.status === "Active"
													? "bg-emerald-100 text-emerald-800"
													: "bg-red-100 text-red-800"
											}`}
										>
											{item.status}
										</span>
									</td>
								</tr>
							))}
							{filteredInventory.length === 0 && (
								<tr>
									<td colSpan={5} className="p-4 text-center text-gray-500 italic">
										No items
									</td>
								</tr>
							)}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

