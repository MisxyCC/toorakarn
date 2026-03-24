// --- 1. กำหนด Type Definition อย่างเข้มงวด (Strict Types) ---
// Type สำหรับ Knowledge Base
export enum CommonErrorResponse {
	RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
}
export interface KnowledgeBaseItem {
  id: string;
  hierarchy: string;
  original_content: string;
  enriched_content: string;
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
