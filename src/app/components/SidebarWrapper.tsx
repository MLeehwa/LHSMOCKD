"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

export default function SidebarWrapper() {
	const pathname = usePathname();
	
	// Hide sidebar for scan and search pages (PDA - only show TopNav)
	if (pathname === "/scan" || pathname === "/search") {
		return null;
	}
	
	return <Sidebar />;
}

