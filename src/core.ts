import { isReachedUserLimit, isReachedGlobalLimit, responseRPMLimit, generateAnswerWithGemini, replyToLine, responseRPDLimit } from "./helper";
import { LineEvent, CommonErrorResponse, KnowledgeBaseItem } from "./model";
import kbDataJson from './knowledge_base.json';

export interface Env {
	GLOBAL_GEMINI_LIMITER: any;
  	USER_SPAM_LIMITER: any;
	GOOGLE_API_KEY: string;
	LINE_CHANNEL_ACCESS_TOKEN: string;
	LINE_CHANNEL_SECRET: string;
}
// แคสต์ข้อมูล JSON
const kbData = kbDataJson as KnowledgeBaseItem[];
const FULL_CONTEXT = kbData.map((item) => `[หมวด: ${item.hierarchy}]\n${item.original_content}`).join('\n\n---\n\n');
// --- Core Logic สำหรับจัดการข้อความ ---
export async function handleMessageEvent(event: LineEvent, env: Env): Promise<void> {
	const userMessage = event.message.text;
	const replyToken = event.replyToken;
	const quoteToken = event.message.quoteToken;
	const userId = event.source?.userId;
	if (!userMessage || !userId) return;
	else if (await isReachedUserLimit(env.USER_SPAM_LIMITER, userId)) {
		return;
	} else if (await isReachedGlobalLimit(env.GLOBAL_GEMINI_LIMITER)) {
		await responseRPMLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		return;
	}
	try {
		const sanitizedMessage = userMessage.slice(0, 500).replace(/[<>{}\\]/g, '');
		const finalAnswer = await generateAnswerWithGemini(sanitizedMessage, FULL_CONTEXT, env.GOOGLE_API_KEY);

		// ตอบกลับ LINE ทันที
		await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
	} catch (error: any) {
		console.error('Error processing message:', error);
		if (error.message === CommonErrorResponse.REQUEST_PER_MINUTE_EXCEEDED) {
			await responseRPMLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		} else if (error.message === CommonErrorResponse.REQUESTS_PER_DAY_EXCEEDED) {
			await responseRPDLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		} else {
			const fallbackMessage = 'ขออภัยค่ะ ระบบเกิดขัดข้องชั่วคราว รบกวนรอสักครู่แล้วลองใหม่อีกครั้งนะคะ 😊';
			await replyToLine(replyToken, fallbackMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		}
	}
}
