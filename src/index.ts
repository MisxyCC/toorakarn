import kbDataJson from './knowledge_base.json';
import { verifyLineSignature, generateAnswerWithGemini, replyToLine } from './helper';
import { KnowledgeBaseItem, LineWebhookBody, LineEvent } from './model';

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
      if (event.type === 'message' && event.message && event.message.type === 'text') {
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

  if (!userMessage) return;

  try {
    const finalAnswer = await generateAnswerWithGemini(userMessage, FULL_CONTEXT, env.GOOGLE_API_KEY);

    // ตอบกลับ LINE ทันที
    await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN);

  } catch (error) {
    console.error('Error processing message:', error);
    await replyToLine(replyToken, 'ขออภัยครับ ระบบตรวจสอบสวัสดิการขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังครับ', env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}
