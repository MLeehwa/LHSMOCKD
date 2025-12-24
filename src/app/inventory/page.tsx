"use client";
import Link from "next/link";

export default function InventoryPage() {
	return (
		<div className="max-w-4xl mx-auto space-y-6">
			<h1 className="text-2xl sm:text-3xl font-semibold">LQ2</h1>
			
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
				<Link
					href="/inventory/receive"
					className="group relative overflow-hidden rounded-lg border-2 border-blue-400 bg-gradient-to-br from-blue-50 to-blue-100 p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105"
				>
					<div className="relative z-10">
						<div className="mb-4 flex items-center justify-center w-16 h-16 rounded-full bg-blue-500 text-white text-2xl font-bold mx-auto group-hover:bg-blue-600 transition-colors">
							R
						</div>
						<h2 className="text-xl font-bold text-gray-900 text-center">Receive</h2>
					</div>
					<div className="absolute inset-0 bg-blue-200 opacity-0 group-hover:opacity-10 transition-opacity"></div>
				</Link>

				<Link
					href="/inventory/dispose"
					className="group relative overflow-hidden rounded-lg border-2 border-red-400 bg-gradient-to-br from-red-50 to-red-100 p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105"
				>
					<div className="relative z-10">
						<div className="mb-4 flex items-center justify-center w-16 h-16 rounded-full bg-red-500 text-white text-2xl font-bold mx-auto group-hover:bg-red-600 transition-colors">
							D
						</div>
						<h2 className="text-xl font-bold text-gray-900 text-center">Dispose</h2>
					</div>
					<div className="absolute inset-0 bg-red-200 opacity-0 group-hover:opacity-10 transition-opacity"></div>
				</Link>

				<Link
					href="/inventory/report"
					className="group relative overflow-hidden rounded-lg border-2 border-emerald-400 bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105"
				>
					<div className="relative z-10">
						<div className="mb-4 flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500 text-white text-2xl font-bold mx-auto group-hover:bg-emerald-600 transition-colors">
							📊
						</div>
						<h2 className="text-xl font-bold text-gray-900 text-center">Inventory Report</h2>
					</div>
					<div className="absolute inset-0 bg-emerald-200 opacity-0 group-hover:opacity-10 transition-opacity"></div>
				</Link>
			</div>
		</div>
	);
}

