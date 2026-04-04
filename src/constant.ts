export const TOP_K = 5;
export const LLM_MAIN_MODEL: string[] = [
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-flash-live-preview',
    'gemma-4-31b-it'
];
// --- การตั้งค่า Sliding Window Memory ---
export const MAX_HISTORY_LENGTH = 4; // จำนวนข้อความที่จำ (4 = User 2 ครั้ง + Bot 2 ครั้ง)
export const MEMORY_TTL_MS = 15 * 60 * 1000; // ลืมบริบทเก่าหากคุยทิ้งไว้เกิน 15 นาที