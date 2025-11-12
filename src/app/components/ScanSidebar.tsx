"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const scanNav = [
	{ href: "/scan", label: "1층 스캔" },
	{ href: "/search", label: "2층 검색" },
	{ href: "/", label: "OCR" },
	{ href: "/match", label: "매칭" },
];

export default function ScanSidebar() {
	const pathname = usePathname();
	
	return (
		<aside className="w-48 sm:w-64 shrink-0 border-r bg-white/60 backdrop-blur">
			<div className="p-3 sm:p-4 text-base sm:text-lg font-semibold">스캔 메뉴</div>
			<nav className="px-2 pb-4 space-y-1">
				{scanNav.map(({ href, label }) => {
					const active = pathname === href;
					return (
						<Link
							key={href}
							href={href}
							className={`${active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"} block rounded px-3 py-2 text-sm transition-colors touch-manipulation min-h-[44px] flex items-center`}
						>
							{label}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}

