import type { Metadata } from "next";
import "./globals.css";
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
				<main className="min-h-screen p-3 sm:p-6">{children}</main>
			</body>
		</html>
	);
}
