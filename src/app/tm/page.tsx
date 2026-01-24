"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TMPage() {
	const router = useRouter();
	
	useEffect(() => {
		// TM 클릭 시 기본적으로 UPLOAD로 리다이렉트
		router.replace("/tm/upload");
	}, [router]);
	
	return null;
}
