export enum CommonErrorResponse {
	REQUEST_PER_MINUTE_EXCEEDED = 'REQUEST_PER_MINUTE_EXCEEDED',
	REQUESTS_PER_DAY_EXCEEDED = 'REQUESTS_PER_DAY_EXCEEDED',
	GEMINI_TIMEOUT = 'GEMINI_TIMEOUT',
}

// Types สำหรับ LINE Webhook
export interface LineMessage {
	type: string;
	id: string;
	text?: string;
	quotedMessageId?: string;
	quoteToken?: string;
}

export interface LineEvent {
	type: string;
	replyToken: string;
	message: LineMessage;
	source: {
		type: string;
		userId?: string;
	};
}

export interface LineWebhookBody {
	destination: string;
	events: LineEvent[];
}

// Types สำหรับ Gemini API Responses
export interface GeminiEmbeddingResponse {
	embedding: {
		values: number[];
	};
}

export interface GeminiGenerateResponse {
	candidates: Array<{
		content: {
			parts: Array<{
				text: string;
			}>;
		};
	}>;
}

// Model สำหรับ จัดการข้อมูลเสียงที่ได้รับจาก LINE
export interface AudioContent {
	base64: string;
	mimeType: string;
}

// Type สำหรับข้อมูลที่ดึงจาก Cloudflare KV
export interface KBDocument {
	title: string;
	content: string;
	source: string;
}
