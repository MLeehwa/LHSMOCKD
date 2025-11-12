"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ScanSidebar from "./ScanSidebar";

export default function SidebarWrapper() {
	const pathname = usePathname();
	
	// Show ScanSidebar for scan and search pages
	if (pathname === "/scan" || pathname === "/search") {
		return <ScanSidebar />;
	}
	
	return <Sidebar />;
}

