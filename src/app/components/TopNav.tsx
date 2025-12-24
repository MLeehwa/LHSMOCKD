"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ckdNav = [
	{ href: "/ckd/ocr", label: "OCR" },
	{ href: "/ckd/scan", label: "SCAN" },
	{ href: "/ckd/search", label: "SEARCH" },
	{ href: "/ckd/match", label: "MATCH" },
	{ href: "/ckd/camera", label: "CAMERA" },
];

const inventoryNav = [
	{ href: "/inventory/receive", label: "LQ2" },
	{ href: "/ckd/scan", label: "CKD" },
];

const lq2Nav = [
	{ href: "/inventory/receive", label: "RECEIVE" },
	{ href: "/inventory/dispose", label: "DISPOSE" },
	{ href: "/inventory/report", label: "INVENTORY REPORT" },
];

export default function TopNav() {
	const pathname = usePathname();
	const isInventoryPath = pathname?.startsWith("/inventory");
	const isCkdPath = pathname?.startsWith("/ckd");
	
	return (
		<nav className="sticky top-0 z-50 w-full bg-white border-b-2 border-gray-300 shadow-md">
			{/* 첫 번째 행: LEEHWA-MGA, LQ2, CKD */}
			<div className="flex items-center px-2 sm:px-6 py-2 sm:py-3 gap-2 overflow-x-auto border-b border-gray-200">
				<div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
					<div className="text-base sm:text-xl font-bold text-gray-900 whitespace-nowrap">LEEHWA-MGA</div>
					{/* 구분선 */}
					<div className="h-8 w-px bg-gray-300 flex-shrink-0"></div>
					{/* 재고관리 메뉴 */}
					{inventoryNav.map(({ href, label }) => {
						const active = label === "LQ2" ? isInventoryPath : isCkdPath;
						return (
							<Link
								key={href}
								href={href}
								className={`px-3 py-2.5 sm:px-6 sm:py-3.5 text-sm sm:text-lg font-semibold rounded-lg transition-colors min-w-[60px] sm:min-w-[90px] min-h-[44px] sm:min-h-[48px] text-center flex items-center justify-center touch-manipulation flex-shrink-0 ${
									active
										? "bg-blue-600 text-white shadow-md"
										: "bg-blue-50 text-blue-700 border-2 border-blue-300 hover:bg-blue-100 active:bg-blue-200"
								}`}
							>
								{label}
							</Link>
						);
					})}
				</div>
			</div>
			
			{/* 두 번째 행: RECEIVE, DISPOSE, INVENTORY REPORT (LQ2 경로일 때만 표시) */}
			{isInventoryPath && (
				<div className="flex items-center px-2 sm:px-6 py-2 sm:py-3 gap-2 overflow-x-auto">
					<div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
						{lq2Nav.map(({ href, label }) => {
							const active = pathname === href || (pathname === "/inventory" && href === "/inventory/receive");
							return (
								<Link
									key={href}
									href={href}
									className={`px-3 py-2.5 sm:px-5 sm:py-3.5 text-sm sm:text-base font-semibold rounded-lg transition-colors min-w-[60px] sm:min-w-[80px] min-h-[44px] sm:min-h-[48px] text-center flex items-center justify-center touch-manipulation flex-shrink-0 ${
										active
											? "bg-gray-900 text-white shadow-md"
											: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
									}`}
								>
									{label}
								</Link>
							);
						})}
					</div>
				</div>
			)}
			
			{/* 세 번째 행: OCR, SCAN, SEARCH, MATCH, CAMERA (CKD 경로일 때만 표시) */}
			{isCkdPath && (
				<div className="flex items-center px-2 sm:px-6 py-2 sm:py-3 gap-2 overflow-x-auto">
					<div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
						{ckdNav.map(({ href, label }) => {
							const active = pathname === href || (pathname === "/ckd" && href === "/ckd/scan");
							return (
								<Link
									key={href}
									href={href}
									className={`px-3 py-2.5 sm:px-5 sm:py-3.5 text-sm sm:text-base font-semibold rounded-lg transition-colors min-w-[60px] sm:min-w-[80px] min-h-[44px] sm:min-h-[48px] text-center flex items-center justify-center touch-manipulation flex-shrink-0 ${
										active
											? "bg-gray-900 text-white shadow-md"
											: "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
									}`}
								>
									{label}
								</Link>
							);
						})}
					</div>
				</div>
			)}
		</nav>
	);
}

