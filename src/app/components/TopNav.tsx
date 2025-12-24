"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
	{ href: "/", label: "OCR" },
	{ href: "/scan", label: "SCAN" },
	{ href: "/search", label: "SEARCH" },
	{ href: "/match", label: "MATCH" },
	{ href: "/camera-ocr", label: "CAMERA" },
];

const inventoryNav = [
	{ href: "/inventory", label: "LQ2" },
];

export default function TopNav() {
	const pathname = usePathname();
	const isInventoryPath = pathname?.startsWith("/inventory");
	
	return (
		<nav className="sticky top-0 z-50 w-full bg-white border-b-2 border-gray-300 shadow-md">
			<div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4">
				<div className="flex items-center gap-3 sm:gap-4">
					<div className="text-lg sm:text-xl font-bold text-gray-900">LEEHWA-MGA</div>
					{/* 구분선 */}
					<div className="h-8 w-px bg-gray-300"></div>
					{/* 재고관리 메뉴 */}
					{inventoryNav.map(({ href, label }) => {
						const active = isInventoryPath;
						return (
							<Link
								key={href}
								href={href}
								className={`px-4 py-2 sm:px-5 sm:py-2.5 text-sm sm:text-base font-semibold rounded-md transition-colors min-w-[80px] text-center ${
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
				<div className="flex items-center gap-2 sm:gap-3">
					{/* 기존 메뉴 */}
					{nav.map(({ href, label }) => {
						const active = pathname === href;
						return (
							<Link
								key={href}
								href={href}
								className={`px-4 py-2 sm:px-5 sm:py-2.5 text-sm sm:text-base font-semibold rounded-md transition-colors min-w-[60px] text-center ${
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
		</nav>
	);
}

