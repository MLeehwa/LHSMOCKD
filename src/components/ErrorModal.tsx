"use client";
import { useEffect } from "react";

type ErrorModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	message: string;
};

export function ErrorModal({ isOpen, onClose, title, message }: ErrorModalProps) {
	useEffect(() => {
		if (isOpen) {
			// Auto close after 3 seconds
			const timer = setTimeout(() => {
				onClose();
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [isOpen, onClose]);

	useEffect(() => {
		// Close on ESC key
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				onClose();
			}
		};
		window.addEventListener("keydown", handleEsc);
		return () => window.removeEventListener("keydown", handleEsc);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 bg-black bg-opacity-50 z-50 transition-opacity"
				onClick={onClose}
			/>

			{/* Modal */}
			<div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
				<div
					className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 pointer-events-auto animate-bounce-in"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Icon */}
					<div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full">
						<svg
							className="w-10 h-10 text-red-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</div>

					{/* Title */}
					<h3 className="text-xl font-bold text-center text-gray-900 mb-2">
						{title}
					</h3>

					{/* Message */}
					<p className="text-center text-gray-600 mb-6 font-mono text-sm break-all">
						{message}
					</p>

					{/* Button */}
					<button
						onClick={onClose}
						className="w-full px-4 py-3 text-base font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors"
					>
						OK
					</button>

					{/* Auto close indicator */}
					<p className="text-xs text-center text-gray-400 mt-3">
						Auto closes in 3 seconds
					</p>
				</div>
			</div>

			<style jsx>{`
				@keyframes bounce-in {
					0% {
						opacity: 0;
						transform: scale(0.3);
					}
					50% {
						transform: scale(1.05);
					}
					70% {
						transform: scale(0.9);
					}
					100% {
						opacity: 1;
						transform: scale(1);
					}
				}
				.animate-bounce-in {
					animation: bounce-in 0.5s ease-out;
				}
			`}</style>
		</>
	);
}
