import kbDataJson from './knowledge_base.json';
import { verifyLineSignature, generateAnswerWithGemini, replyToLine } from './helper';
import { KnowledgeBaseItem, LineWebhookBody, LineEvent, CommonErrorResponse } from './model';

export interface Env {
  GOOGLE_API_KEY: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
}

// แคสต์ข้อมูล JSON
const kbData = kbDataJson as KnowledgeBaseItem[];

const FULL_CONTEXT = kbData.map(item => `[หมวด: ${item.hierarchy}]\n${item.original_content}`).join('\n\n---\n\n');

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const signature = request.headers.get('x-line-signature');
    if (!signature) return new Response('Missing Signature', { status: 400 });

    const rawBody = await request.text();
    const isValid = await verifyLineSignature(signature, rawBody, env.LINE_CHANNEL_SECRET);

    if (!isValid) {
      console.error('Invalid LINE Signature');
      return new Response('Unauthorized', { status: 401 });
    }

    const body = JSON.parse(rawBody) as LineWebhookBody;
    const events = body.events || [];

    for (const event of events) {
      if (event.type === 'message' && event.message && event.message.type === 'text' && event.message.text && event.replyToken) {
				ctx.waitUntil(handleMessageEvent(event, env));
      }
    }

    return new Response('OK', { status: 200 });
  }
} satisfies ExportedHandler<Env>;

// --- Core Logic สำหรับจัดการข้อความ ---
async function handleMessageEvent(event: LineEvent, env: Env): Promise<void> {
  const userMessage = event.message.text;
  const replyToken = event.replyToken;
	const quoteToken = event.message.quoteToken;
  if (!userMessage) return;

  try {
		const sanitizedMessage = userMessage.slice(0, 500).replace(/[<>{}\\]/g, '');
    const finalAnswer = await generateAnswerWithGemini(sanitizedMessage, FULL_CONTEXT, env.GOOGLE_API_KEY);

    // ตอบกลับ LINE ทันที
    await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);

  } catch (error: any) {
    console.error('Error processing message:', error);
		if (error.message === CommonErrorResponse.REQUEST_PER_MINUTE_EXCEEDED) {
			const busyMessage = 'ตอนนี้มีพี่ๆไฟฟ้าทักเข้ามาสอบถามสวัสดิการเยอะมากเลยค่ะ 😅 คิวตอบล้นแล้ววว รบกวนพี่รอสัก 1 นาที แล้วพิมพ์คำถามส่งมาใหม่อีกครั้งนะค้า 💜⚡';
      await replyToLine(replyToken, busyMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		} else if (error.message === CommonErrorResponse.REQUESTS_PER_DAY_EXCEEDED) {
			const busyMessage = 'ขออภัยด้วยนะค๊า 🙏 ตอนนี้โควต้า AI ประจำวันของบอทถูกใช้งานจนหมดแล้ว น้องขออนุญาตไปพักเบรกก่อนน้า เดี๋ยวพรุ่งนี้กลับมาให้บริการตามปกติค่า ขอบคุณที่แวะมาใช้งานนะค๊า 💖';
      await replyToLine(replyToken, busyMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		} else {
			const fallbackMessage = 'ขออภัยค่ะ ระบบตรวจสอบสวัสดิการขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ 😊';
      await replyToLine(replyToken, fallbackMessage, env.LINE_CHANNEL_ACCESS_TOKEN, quoteToken);
		}
  }
}
