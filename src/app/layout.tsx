import type { Metadata } from "next";
import "./globals.css";
import SidebarWrapper from "./components/SidebarWrapper";
import TopNav from "./components/TopNav";

export const metadata: Metadata = {
	title: "OCR Demo",
	description: "PDF/Image OCR with line-by-line preview",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ko" className="h-full">
			<body className="h-full bg-gray-50 text-gray-900">
				<TopNav />
				<div className="flex min-h-screen">
					<SidebarWrapper />
					<main className="flex-1 p-3 sm:p-6">{children}</main>
				</div>
			</body>
		</html>
	);
}
