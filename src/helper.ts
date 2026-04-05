import { GoogleGenAI } from '@google/genai';
import { Buffer } from 'node:buffer';
import { LLM_MAIN_MODEL, SYSTEM_PROMPT, VECTOR_DIMENSIONALITY } from './constant';
import { AudioContent, CommonErrorResponse } from './model';

// --- Helper: ตรวจสอบความถูกต้องของ Request จาก LINE ---
export async function verifyLineSignature(signature: string, body: string, channelSecret: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
	const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
	return signature === signatureBase64;
}

// --- Helper: สร้าง Vector Embedding ---
// 🟢 ใช้ fetch ยิง REST API ตรงๆ เพื่อหลีกเลี่ยงบั๊กของ SDK
export async function getGeminiEmbedding(text: string, apiKey: string): Promise<number[]> {
	try {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${apiKey}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'models/gemini-embedding-2-preview',
				content: { parts: [{ text: text }] },
				taskType: 'RETRIEVAL_QUERY', // ระบุว่าเป็นเวกเตอร์สำหรับใช้ค้นหาคำตอบ
				outputDimensionality: VECTOR_DIMENSIONALITY, // บังคับมิติให้ตรงกับ Vectorize
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Google API returned ${response.status}: ${errorText}`);
		}

		const data = (await response.json()) as any;

		if (!data.embedding || !data.embedding.values) {
			throw new Error('รูปแบบเวกเตอร์ที่ตอบกลับมาไม่ถูกต้อง');
		}

		return data.embedding.values;
	} catch (error: any) {
		console.error('[DEBUG] Embedding Error:', error);
		throw new Error(`Embedding failed: ${error.message}`);
	}
}

// --- Helper: ตอบกลับ LINE ---
export async function replyToLine(
	replyToken: string,
	text: string,
	accessToken: string,
	quoteToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const url = 'https://api.line.me/v2/bot/message/reply';
	// สร้าง Message Object เบื้องต้น
	const messageObj: any = {
		type: 'text',
		text: text,
		quoteToken: quoteToken,
	};
	await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
		body: JSON.stringify({
			replyToken: replyToken,
			messages: [messageObj],
		}),
		signal,
	});
}

// --- Helper: แสดง Loading Animation ---
export async function startLoadingAnimation(
	userId: string,
	accessToken: string,
	loadingSeconds: number = 25, // LINE รองรับ 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
	signal?: AbortSignal,
): Promise<void> {
	const url = 'https://api.line.me/v2/bot/chat/loading/start';
	try {
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				chatId: userId,
				loadingSeconds: loadingSeconds,
			}),
			signal,
		});
	} catch (error) {
		// เราไม่ต้อง throw error กลับไปให้ระบบพัง หากแค่โชว์ Animation ไม่สำเร็จ
		console.error('[DEBUG] Failed to start loading animation:', error);
	}
}

export async function isReachedUserLimit(rateLimiter: any, userId: string): Promise<boolean> {
	const userCheck = await rateLimiter.limit({ key: userId });
	if (!userCheck.success) {
		console.warn(`User ${userId} is spamming. Ignored.`);
		return true;
	}
	return false;
}

export async function isReachedGlobalLimit(rateLimiter: any): Promise<boolean> {
	const userCheck = await rateLimiter.limit({ key: 'global_system_key' });
	if (!userCheck.success) {
		console.warn(`🚨 System hit the Gemini 15 RPM limit!`);
		return true;
	}
	return false;
}

export async function responseRPMLimit(
	replyToken: string,
	lineChannelAccessToken: string,
	quoteToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const busyMessage =
		'ตอนนี้มีพี่ๆไฟฟ้าทักเข้ามาสอบถามสวัสดิการเยอะมากเลยค่ะ 😅 คิวตอบล้นแล้ววว รบกวนพี่รอสัก 1 นาที แล้วพิมพ์คำถามส่งมาใหม่อีกครั้งนะค้า 💜⚡';
	await replyToLine(replyToken, busyMessage, lineChannelAccessToken, quoteToken, signal);
}

export async function responseRPDLimit(
	replyToken: string,
	lineChannelAccessToken: string,
	quoteToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const busyMessage =
		'ขออภัยด้วยนะค๊า 🙏 ตอนนี้โควต้า AI ประจำวันของบอทถูกใช้งานจนหมดแล้ว น้องขออนุญาตไปพักเบรกก่อนน้า เดี๋ยวพรุ่งนี้กลับมาให้บริการตามปกติค่า ขอบคุณที่แวะมาใช้งานนะค๊า 💖';
	await replyToLine(replyToken, busyMessage, lineChannelAccessToken, quoteToken, signal);
}

export async function responseServiceUnavailable(
	replyToken: string,
	lineChannelAccessToken: string,
	quoteToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const busyMessage =
		'แงงง ขออภัยด้วยนะค้า 😭 ตอนนี้น้องทำงานหนักมากจนระบบแอบรวนไปนิดนึง รบกวนพี่รอสัก 2-3 นาที แล้วลองพิมพ์คำถามส่งมาใหม่อีกครั้งนะคะ 💜⚡';
	await replyToLine(replyToken, busyMessage, lineChannelAccessToken, quoteToken, signal);
}

export async function responseGeminiTimeout(
	replyToken: string,
	lineChannelAccessToken: string,
	quoteToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const busyMessage =
		'แงงง ขออภัยด้วยนะค้า 😭 ตอนนี้น้องประมวลผลไม่ทัน 25 วินาที รบกวนพี่ลองพิมพ์คำถามแบบกระชับ ๆ ส่งมาใหม่อีกครั้งนะคะ 💜⚡';
	await replyToLine(replyToken, busyMessage, lineChannelAccessToken, quoteToken, signal);
}

export async function getLineAudioContent(messageId: string, accessToken: string, signal?: AbortSignal): Promise<ArrayBuffer> {
	const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
	const response = await fetch(url, {
		method: 'GET',
		headers: { Authorization: `Bearer ${accessToken}` },
		signal,
	});

	if (!response.ok) {
		throw new Error('ไม่สามารถดาวน์โหลดไฟล์เสียงจาก LINE ได้');
	}
	return await response.arrayBuffer();
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	// 🌟 2. โยนเข้า Buffer ทีเดียวจบ ใช้เวลาทำงานแทบจะ 0ms
	return Buffer.from(buffer).toString('base64');
}

// 🟢 ฟังก์ชันใหม่: ให้ AI ถอดเสียงเป็นข้อความก่อนนำไปค้นหา (Transcription)
export async function transcribeAudio(googleGenAI: GoogleGenAI, audioData: AudioContent, signal?: AbortSignal): Promise<string> {
	const result = await googleGenAI.models.generateContent({
		model: LLM_MAIN_MODEL[0],
		contents: [
			{
				role: 'user',
				parts: [
					{ text: 'ถอดความไฟล์เสียงนี้ให้เป็นข้อความที่ถูกต้องแม่นยำ ไม่ต้องอธิบายหรือเพิ่มคำอื่น' },
					{ inlineData: { mimeType: audioData.mimeType, data: audioData.base64 } },
				],
			},
		],
		config: {
			abortSignal: signal,
		},
	});
	return result.text?.trim() || '';
}

// --- 🟢 ฟังก์ชันใหม่: LLM Query Router สกัด Intent และตัวย่อแผนก ---
export async function analyzeQueryIntent(googleGenAI: GoogleGenAI, userQuery: string, signal?: AbortSignal) {
	const routerPrompt = `
คุณคือผู้เชี่ยวชาญการวิเคราะห์ความต้องการประจำ กฟภ.
หน้าที่ของคุณคืออ่านข้อความจากผู้ใช้ แล้วตอบกลับเป็น JSON ตาม Schema ที่กำหนดเท่านั้น 
หากพบตัวย่อหน่วยงาน ให้แปลงเป็นตัวย่อภาษาไทยที่ถูกต้องแบบไม่มีจุดเสมอ 
และในส่วนของคำค้นหา ให้ดึงมาเฉพาะชื่อคนหรือสถานที่เฉพาะเจาะจง โดยห้ามใส่คำกริยาหรือคำนามทั่วไปเด็ดขาด

[ตัวอย่างการวิเคราะห์ที่ถูกต้อง]
ข้อความ: "ขอเบอร์ กดส หน่อยครับ"
{"intent": "directory", "search_keywords": "", "acronym_filter": "กดส"}

ข้อความ: "ติดต่อแผนกสนับสนุน ขอนแก่น"
{"intent": "directory", "search_keywords": "สนับสนุน ขอนแก่น", "acronym_filter": ""}

ข้อความ: "เบอร์พี่สมชาย แผนกบุคคล"
{"intent": "directory", "search_keywords": "สมชาย บุคคล", "acronym_filter": ""}
`;

	try {
		const result = await googleGenAI.models.generateContent({
			model: LLM_MAIN_MODEL[0],
			contents: [{ role: 'user', parts: [{ text: `ข้อความ: "${userQuery}"` }] }],
			config: {
				systemInstruction: routerPrompt,
				responseMimeType: 'application/json',
				temperature: 0.1,
				abortSignal: signal,
			},
		});

		const responseText = result.text?.trim() || '{}';
		return JSON.parse(responseText);
	} catch (error) {
		console.error("[Router Error]", error);
		// Fallback เพื่อให้ระบบทำงานต่อได้แม้ AI วิเคราะห์พลาด
		return { intent: "general", search_keywords: userQuery, acronym_filter: "" };
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

		// 2. นำคำถามและ Context ปัจจุบัน ใส่เข้าไปเป็นลำดับสุดท้าย
		const currentParts: any[] = [];

		currentParts.push({ text: `[ข้อมูลประกอบการตอบคำถามรอบนี้]\n${context}\n\n` });

		if (userMessage) {
			currentParts.push({ text: `คำถาม: ${userMessage}` });
		} else if (audioData) {
			currentParts.push({
				text: 'กรุณาฟังไฟล์เสียงนี้ ซึ่งเป็นคำถามจากพนักงาน และตอบคำถามโดยอ้างอิงจากข้อมูลที่มีละเอียด',
			});
			currentParts.push({
				inlineData: {
					mimeType: audioData.mimeType,
					data: audioData.base64,
				},
			});
		}

		contents.push({ role: 'user', parts: currentParts });

		const result = await googleGenAI.models.generateContent({
			model: LLM_MAIN_MODEL[0],
			contents: contents,
			config: {
				temperature: 0.1,
				systemInstruction: SYSTEM_PROMPT,
				abortSignal: signal,
			},
		});

		const responseText = result.text?.trim();
		return responseText || 'ขออภัยค่ะ น้องธุรการไม่สามารถตอบกลับได้ในขณะนี้';
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