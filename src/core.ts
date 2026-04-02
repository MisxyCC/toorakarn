import {
	isReachedGlobalLimit,
	responseRPMLimit,
	replyToLine,
	responseRPDLimit,
	getLineAudioContent,
	arrayBufferToBase64,
	systemInstruction,
	transcribeAudio,
	getGeminiEmbedding,
	responseServiceUnavailable,
	startLoadingAnimation,
} from './helper';
import { LineEvent, CommonErrorResponse, AudioContent, KBDocument } from './model';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export interface Env {
	GLOBAL_GEMINI_LIMITER: any;
	USER_SPAM_LIMITER: any;
	GOOGLE_API_KEY: string;
	LINE_CHANNEL_ACCESS_TOKEN: string;
	LINE_CHANNEL_SECRET: string;
	VECTORIZE: VectorizeIndex;
	KV: KVNamespace;
}
// --- Core Logic สำหรับจัดการข้อความ ---
export async function handleMessageEvent(event: LineEvent, env: Env): Promise<void> {
	const baseTimeout = 25000; // 25 seconds for main processing, leaving 5 seconds for error response before Cloudflare's 30s limit
	// สร้าง AbortSignal สำหรับ Timeout 25 วินาที (เพื่อให้เหลือเวลา 5 วินาทีในการส่ง Error Response ก่อน Cloudflare ตัด 30s)
	const timeoutSignal = AbortSignal.timeout(baseTimeout);
	const googleGenAI = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

	console.log(`[DEBUG] --- Start handleMessageEvent ---`);

	const replyToken = event.replyToken;
	const quoteToken = event.message.quoteToken;
	const userId = event.source?.userId;
	const messageType = event.message?.type;
	const messageId = event.message?.id;

	console.log(`[DEBUG] UserID: ${userId}, MessageType: ${messageType}, MessageID: ${messageId}: `);
	if (!userId || !messageType) {
		console.log(`[DEBUG] 🛑 Missing userId or messageType. Exiting.`);
		return;
	}
	if (await isReachedGlobalLimit(env.GLOBAL_GEMINI_LIMITER)) {
		console.log(`[DEBUG] 🛑 Global Limit Reached. Exiting.`);
		await responseRPMLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		return;
	}
	try {
		// 🟢 0. แสดง Loading Animation ให้ผู้ใช้เห็นว่าบอทกำลังประมวลผล (แสดงสูงสุด 25 วินาที)
		await startLoadingAnimation(userId, env.LINE_CHANNEL_ACCESS_TOKEN, baseTimeout / 1000, timeoutSignal);

		let finalAnswer = '';
		let searchQueryText = '';
		console.log(`[DEBUG] 🛣️ Routing to Message Type: ${messageType}`);
		// ---------------------------------------------------------
		// 🟢 1. เตรียมข้อความสำหรับค้นหา (จาก Text หรือ Audio)
		// ---------------------------------------------------------
		if (messageType === 'text' && event.message.text) {
			console.log(`[DEBUG] 📝 Processing TEXT message: ${event.message.text}`);
			searchQueryText = event.message.text.slice(0, 500).replace(/[<>{}\\]/g, '');
		} else if (messageType === 'audio') {
			console.log(`[DEBUG] 🎙️ Processing AUDIO message...`);
			const audioBuffer = await getLineAudioContent(messageId, env.LINE_CHANNEL_ACCESS_TOKEN, timeoutSignal);
			const audioContentData: AudioContent = { base64: arrayBufferToBase64(audioBuffer), mimeType: 'audio/m4a' };
			// ถอดเสียงเป็นข้อความเพื่อเอาไปทำ Vector Search
			searchQueryText = await transcribeAudio(googleGenAI, audioContentData, timeoutSignal);
			console.log(`[DEBUG] 🗣️ Transcribed Audio: ${searchQueryText}`);
		} else {
			const fallbackMsg =
				'ขออภัยค่า 😅 ตอนนี้น้องธุรการยังดูรูปภาพหรือสติ๊กเกอร์ไม่ได้ รบกวนพี่พิมพ์เป็นข้อความ หรือส่งเป็นข้อความเสียงมาแทนนะคะ 💜⚡';
			await replyToLine(replyToken, fallbackMsg, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
			return;
		}
		// ---------------------------------------------------------
		// 🟢 2. TWO-HOP RETRIEVAL (Vectorize -> KV)
		// ---------------------------------------------------------

		console.log(`[DEBUG] 🔍 Embedding query & Searching Vectorize...`);
		//const userVector = await getGeminiEmbedding(searchQueryText, googleGenAI, timeoutSignal);
		const userVector = await getGeminiEmbedding(searchQueryText, env.GOOGLE_API_KEY);

		// ค้นหา ID จาก Vectorize
		const vectorResults = await env.VECTORIZE.query(userVector, { topK: 10 });

		const contextTexts: string[] = [];
		for (const match of vectorResults.matches) {
			// เอา ID ไปดึงข้อมูลเต็มจาก KV
			const kbData = await env.KV.get<KBDocument>(match.id, 'json');
			if (kbData) {
				contextTexts.push(`[อ้างอิง: ${kbData.source} | หมวด: ${kbData.title}]\n${kbData.content}`);
			}
		}

		// รวม Context เข้าด้วยกัน
		const dynamicContext = contextTexts.length > 0 ? contextTexts.join('\n\n---\n\n') : 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูล';

		console.log(`[DEBUG] 📚 Retrieved Context Length: ${dynamicContext.length} chars`);

		// ---------------------------------------------------------
		// 🟢 3. ให้ Gemini สรุปคำตอบ
		// ---------------------------------------------------------
		finalAnswer = await generateAnswerWithGemini(googleGenAI, searchQueryText, dynamicContext, undefined, timeoutSignal);

		console.log(`[DEBUG] 📤 Replying to LINE user...`);
		await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		console.log(`[DEBUG] --- 🏁 End handleMessageEvent ---`);
	} catch (error: any) {
		console.error('[DEBUG] 🚨 ERROR in handleMessageEvent:', error);
		console.error('Error processing message:', error);

		// กรณีพิเศษสำหรับ AbortError / Timeout
		if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('deadline exceeded')) {
			const timeoutMessage =
				'แงงง 😭 คำถามนี้รายละเอียดเยอะมาก น้องธุรการคิดจนปวดหัวเลยค่ะ (หมดเวลา 25 วินาที) รบกวนพี่ลองพิมพ์คำถามให้กระชับลงอีกนิดนึงนะคะ 💜⚡';
			// เราไม่ส่ง timeoutSignal เข้าไปที่นี่ เพราะมัน abort ไปแล้ว ให้สร้างใหม่สั้นๆ หรือไม่ใส่เลย
			await replyToLine(replyToken, timeoutMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
			return;
		}

		if (error.message === CommonErrorResponse.REQUEST_PER_MINUTE_EXCEEDED) {
			await responseRPMLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else if (error.message === CommonErrorResponse.REQUESTS_PER_DAY_EXCEEDED) {
			await responseRPDLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else if (error.message === CommonErrorResponse.GEMINI_SERVICE_UNAVAILABLE) {
			await responseServiceUnavailable(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else {
			const fallbackMessage = 'ขออภัยค่ะ ระบบเกิดขัดข้องชั่วคราว รบกวนรอสักครู่แล้วลองใหม่อีกครั้งนะคะ 😊';
			await replyToLine(replyToken, fallbackMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		}
	}
}

export async function generateAnswerWithGemini(
	googleGenAI: GoogleGenAI,
	userMessage: string | null,
	context: string,
	audioData?: AudioContent,
	signal?: AbortSignal,
): Promise<string> {
	try {
		const contents: any[] = [];
		const parts: any[] = [];

		parts.push({ text: `Context ข้อมูลสวัสดิการ:\n${context}\n\n` });

		if (userMessage) {
			parts.push({ text: `คำถามของผู้ใช้: ${userMessage}` });
		} else if (audioData) {
			parts.push({
				text: 'คำถามของผู้ใช้: กรุณาฟังไฟล์เสียงนี้ ซึ่งเป็นคำถามจากพนักงาน และตอบคำถามโดยอ้างอิงจากข้อมูลที่มีละเอียด',
			});
			parts.push({
				inlineData: {
					mimeType: audioData.mimeType,
					data: audioData.base64,
				},
			});
		}

		contents.push({ role: 'user', parts });

		const result = await googleGenAI.models.generateContent({
			model: 'gemini-3.1-flash-lite-preview',
			contents: contents,
			config: {
				temperature: 0.1,
				systemInstruction: systemInstruction,
				abortSignal: signal,

			},
		});

		const responseText = result.text?.trim();
		return responseText || 'ขออภัยค่ะ AI ไม่สามารถตอบกลับได้ในขณะนี้';
	} catch (error: any) {
		console.error('[DEBUG] Gemini SDK Error:', error);

		const errorMessage = error.message || '';
		if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
			if (errorMessage.includes('Requests per minute')) {
				throw new Error(CommonErrorResponse.REQUEST_PER_MINUTE_EXCEEDED);
			} else {
				throw new Error(CommonErrorResponse.REQUESTS_PER_DAY_EXCEEDED);
			}
		}

		if (error.name === 'AbortError' || errorMessage.includes('deadline exceeded') || errorMessage.includes('timeout')) {
			throw new Error(CommonErrorResponse.GEMINI_TIMEOUT);
		}
		throw error;
	}
}
