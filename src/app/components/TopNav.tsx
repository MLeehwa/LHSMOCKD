"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
	{ href: "/", label: "OCR" },
	{ href: "/scan", label: "SCAN" },
	{ href: "/match", label: "MATCH" },
];

export default function TopNav() {
	const pathname = usePathname();
	
	return (
		<nav className="sticky top-0 z-50 w-full bg-white border-b-2 border-gray-300 shadow-md">
			<div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4">
				<div className="text-lg sm:text-xl font-bold text-gray-900">OCR Demo</div>
				<div className="flex gap-2 sm:gap-3">
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

