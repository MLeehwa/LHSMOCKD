"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
	{ href: "/", label: "OCR" },
	{ href: "/scan", label: "Scan" },
	{ href: "/match", label: "Match" },
];

export default function Sidebar() {
	const pathname = usePathname();
	
	// Hide sidebar on scan page (scan page has its own sidebar)
	if (pathname === "/scan") {
		return null;
	}
	
	return (
		<aside className="hidden sm:block w-64 shrink-0 border-r bg-white/60 backdrop-blur">
			<div className="p-4 text-lg font-semibold">OCR Demo</div>
			<nav className="px-2 pb-4 space-y-1">
				{nav.map(({ href, label }) => {
					const active = pathname === href;
					return (
						<Link
							key={href}
							href={href}
							className={`${active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"} block rounded px-3 py-2 text-sm transition-colors`}
						>
							{label}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
