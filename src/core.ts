import { GoogleGenAI } from '@google/genai';
import { TOP_K } from './constant';
import {
	analyzeQueryIntent,
	arrayBufferToBase64,
	generateAnswerWithGemini,
	getGeminiEmbedding,
	getLineAudioContent,
	isReachedGlobalLimit,
	replyToLine,
	responseGeminiTimeout,
	responseRPDLimit,
	responseRPMLimit,
	responseServiceUnavailable,
	startLoadingAnimation,
	transcribeAudio,
} from './helper';
import { AudioContent, CommonErrorResponse, Env, KBDocument, LineEvent } from './model';

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
		// 🟢 0. แสดง Loading Animation 
		await startLoadingAnimation(userId, env.LINE_CHANNEL_ACCESS_TOKEN, baseTimeout / 1000, timeoutSignal);

		let finalAnswer = '';
		let searchQueryText = '';

		// ---------------------------------------------------------
		// 🟢 1. เตรียมข้อความสำหรับค้นหา (จาก Text หรือ Audio)
		// ---------------------------------------------------------
		if (messageType === 'text' && event.message.text) {
			searchQueryText = event.message.text.slice(0, 500).replace(/[<>{}\\]/g, '');
		} else if (messageType === 'audio') {
			const audioBuffer = await getLineAudioContent(messageId, env.LINE_CHANNEL_ACCESS_TOKEN, timeoutSignal);
			const audioContentData: AudioContent = { base64: arrayBufferToBase64(audioBuffer), mimeType: 'audio/m4a' };
			searchQueryText = await transcribeAudio(googleGenAI, audioContentData, timeoutSignal);
		} else {
			const fallbackMsg = 'ขออภัยค่า 😅 ตอนนี้น้องธุรการยังดูรูปภาพหรือสติ๊กเกอร์ไม่ได้ รบกวนพี่พิมพ์เป็นข้อความ หรือส่งเป็นข้อความเสียงมาแทนนะคะ 💜⚡';
			await replyToLine(replyToken, fallbackMsg, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
			return;
		}

		// ---------------------------------------------------------
		// 🟢 2. วิเคราะห์ Intent ด้วย LLM Router
		// ---------------------------------------------------------
		console.log(`[DEBUG] 🧠 Routing Query...`);
		const queryAnalysis = await analyzeQueryIntent(googleGenAI, searchQueryText, timeoutSignal);
		console.log(`[DEBUG] 📊 Analysis Result:`, queryAnalysis);

		let dynamicContext = '';
		let foundInD1 = false;

		// ---------------------------------------------------------
		// 🟢 3. HYBRID SEARCH: เช็คหาเบอร์ใน D1 Database (SQL) ก่อน
		// ---------------------------------------------------------
		if (queryAnalysis.intent === 'directory') {
			// ดึงค่าและทำความสะอาดตัวย่อ (ลบจุดออกให้หมด เพื่อป้องกัน AI หลุดพิมพ์จุดมา)
			const rawKeyword = String(queryAnalysis.search_keywords || '').trim();
			const acronym = String(queryAnalysis.acronym_filter || '').replace(/\./g, '').trim();

			console.log(`[DEBUG] 🎯 Searching D1 SQL DB... Acronym: "${acronym}", Keyword: "${rawKeyword}"`);

			let sqlQuery = "SELECT * FROM PhoneDirectory WHERE 1=1";
			let bindParams: any[] = [];

			// 3.1 ค้นหาด้วยตัวย่อ: หาแผนกแม่ตรงๆ (acronym = ?) หรือ แผนกลูกๆ ที่สังกัดอยู่ (LIKE %ตัวย่อ%)
			if (acronym) {
				sqlQuery += " AND (acronym = ? OR search_keywords LIKE ?)";
				bindParams.push(acronym, `%${acronym}%`);
			}

			// 3.2 จัดการคำค้นหาและกำจัดคำขยะที่ทำให้ SQL ทะลุข้อจำกัด (Complex Pattern)
			if (rawKeyword) {
				// คำขยะเหล่านี้จะถูกตัดทิ้ง ไม่นำไปค้นหาในฐานข้อมูล
				const stopWords: string[] = ['ขอเบอร์', 'เบอร์', 'โทร', 'เบอร์โทร', 'เบอร์โทรศัพท์', 'แผนก', 'กอง', 'ฝ่าย', 'เขต', 'การไฟฟ้า', 'ทั้งหมด', 'ที่อยู่ใต้', 'หน่อย', 'คือเบอร์ใคร', 'ของใคร', 'ใคร'];
				// ลบเครื่องหมาย % และ _ ออกจากคำของผู้ใช้เพื่อป้องกัน SQL Error
				const safeKeywords = rawKeyword.replace(/[%_]/g, '').split(' ')
					.map(k => k.trim())
					.filter(k => k.length > 0 && !stopWords.includes(k));

				for (const word of safeKeywords) {
					sqlQuery += " AND (search_keywords LIKE ? OR internal_number LIKE ? OR direct_number LIKE ?)";
					bindParams.push(`%${word}%`, `%${word}%`, `%${word}%`);
				}
			}

			// ถ้ามีเงื่อนไขการค้นหา ถึงจะยิง SQL (ป้องกันการดึงข้อมูลมาทั้งหมดทั้งตาราง)
			if (bindParams.length > 0) {
				try {
					const { results } = await env.DB.prepare(sqlQuery).bind(...bindParams).all();

					if (results && results.length > 0) {
						foundInD1 = true;
						const d1Contexts = results.map((row: any) =>
							`[หมวด: เบอร์โทรศัพท์]\nหน่วยงาน: ${row.department_name} (${row.acronym || '-'}) \nตำแหน่ง/จุดติดต่อ: ${row.position}\nเบอร์ภายใน: ${row.internal_number || '-'}\nเบอร์ตรง: ${row.direct_number || '-'}`
						);
						dynamicContext = d1Contexts.join('\n\n---\n\n');
						console.log(`[DEBUG] ✅ Found ${results.length} matches in D1 SQL!`);
					} else {
						console.log(`[DEBUG] ❌ No match found in D1 SQL. Falling back...`);
					}
				} catch (dbError) {
					console.error(`[DEBUG] 🚨 D1 SQL Error:`, dbError);
					// 🌟 [สำคัญ] ถ้า D1 พัง (เช่น Pattern complex) ระบบจะไม่ล่ม แต่จะไหลไปหาใน Vectorize ต่ออย่างปลอดภัย
					foundInD1 = false;
				}
			}
		}

		// ---------------------------------------------------------
		// 🟢 4. FALLBACK: ค้นหาใน Vectorize (เฉพาะกรณีที่ไม่ใช่หาเบอร์โทร)
		// ---------------------------------------------------------
		if (!foundInD1) {
			if (queryAnalysis.intent === 'directory') {
				dynamicContext = 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูล กรุณาตรวจสอบตัวสะกดของชื่อแผนกหรือตัวย่ออีกครั้งค่ะ';
				console.log(`[DEBUG] ❌ Skipping Vectorize to prevent hallucination.`);
			} else {
				console.log(`[DEBUG] 🔍 Searching Vectorize Semantic Search...`);

				const textToEmbed = queryAnalysis.search_keywords || searchQueryText;
				const userVector = await getGeminiEmbedding(textToEmbed, env.GOOGLE_API_KEY);

				const vectorResults = await env.VECTORIZE.query(userVector, { topK: TOP_K });

				const contextTexts: string[] = [];
				for (const match of vectorResults.matches) {
					const kbData = await env.KV.get<KBDocument>(match.id, 'json');
					if (kbData) {
						contextTexts.push(`[อ้างอิง: ${kbData.source} | หมวด: ${kbData.title}]\n${kbData.content}`);
					}
				}
				dynamicContext = contextTexts.length > 0 ? contextTexts.join('\n\n---\n\n') : 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูล';
				console.log(`[DEBUG] 📚 Retrieved Vector Context Length: ${dynamicContext.length} chars`);
			}
		}
		// ---------------------------------------------------------
		// 🟢 5. ให้ Gemini สรุปคำตอบสุดท้าย
		// ---------------------------------------------------------
		finalAnswer = await generateAnswerWithGemini(googleGenAI, searchQueryText, dynamicContext, undefined, timeoutSignal);

		console.log(`[DEBUG] 📤 Replying to LINE user with the final answer: ${finalAnswer}`);
		await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);

		console.log(`[DEBUG] --- 🏁 End handleMessageEvent ---`);

	} catch (error: any) {
		console.error('[DEBUG] 🚨 ERROR in handleMessageEvent:', error);

		if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('deadline exceeded')) {
			const timeoutMessage = 'แงงง 😭 คำถามนี้รายละเอียดเยอะมาก น้องธุรการคิดจนปวดหัวเลยค่ะ (หมดเวลา 25 วินาที) รบกวนพี่ลองพิมพ์คำถามให้กระชับลงอีกนิดนึงนะคะ 💜⚡';
			await replyToLine(replyToken, timeoutMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
			return;
		}

		if (error.message === CommonErrorResponse.REQUEST_PER_MINUTE_EXCEEDED) {
			await responseRPMLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else if (error.message === CommonErrorResponse.REQUESTS_PER_DAY_EXCEEDED) {
			await responseRPDLimit(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else if (error.message === CommonErrorResponse.GEMINI_SERVICE_UNAVAILABLE || error.message.includes('503')) {
			await responseServiceUnavailable(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else if (error.message === CommonErrorResponse.GEMINI_TIMEOUT) {
			await responseGeminiTimeout(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		} else {
			const fallbackMessage = 'ขออภัยค่ะ ระบบเกิดขัดข้องชั่วคราว รบกวนรอสักครู่แล้วลองใหม่อีกครั้งนะคะ 😊';
			await replyToLine(replyToken, fallbackMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken, timeoutSignal);
		}
	}
}