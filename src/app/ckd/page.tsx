"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CkdPage() {
	const router = useRouter();
	
	useEffect(() => {
		// CKD 클릭 시 기본적으로 SCAN으로 리다이렉트
		router.replace("/ckd/scan");
	}, [router]);
	
	return null;
}

