import Fuse from 'fuse.js';
import kbDataJson from './knowledge_base.json';
import { verifyLineSignature, getGeminiEmbedding, generateAnswerWithGemini, replyToLine } from './helper';
import { KnowledgeBaseItem, LineWebhookBody, LineEvent } from './model';

export interface Env {
  VECTORIZE_INDEX: VectorizeIndex;
  GOOGLE_API_KEY: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
}

// แคสต์ข้อมูล JSON ให้เป็น Type ที่ถูกต้อง
const kbData = kbDataJson as KnowledgeBaseItem[];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // --- 2. Request Validation ---
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('x-line-signature');
    if (!signature) {
      return new Response('Missing Signature', { status: 400 });
    }

    const rawBody = await request.text();

    // --- 3. Verify LINE Signature ---
    const isValid = await verifyLineSignature(signature, rawBody, env.LINE_CHANNEL_SECRET);
    if (!isValid) {
      console.error('Invalid LINE Signature');
      return new Response('Unauthorized', { status: 401 });
    }

    // --- 4. Process Events ---
    // ใช้ Type Assertion เพื่อให้ TypeScript รู้จักโครงสร้างของ LINE Webhook
    const body = JSON.parse(rawBody) as LineWebhookBody;
    const events = body.events || [];

    for (const event of events) {
      if (event.type === 'message' && event.message && event.message.type === 'text') {
        // ใช้ ctx.waitUntil เพื่อให้ Worker ตอบ 200 OK กลับไปที่ LINE ทันที
        ctx.waitUntil(handleMessageEvent(event, env));
      }
    }

    return new Response('OK', { status: 200 });
  }
} satisfies ExportedHandler<Env>;;

// --- Core Logic สำหรับจัดการข้อความ ---
async function handleMessageEvent(event: LineEvent, env: Env): Promise<void> {
  const userMessage = event.message.text;
  const replyToken = event.replyToken;

  if (!userMessage) return; // ป้องกันกรณี text เป็น undefined

  try {
    // 1. ดึง Vector (1536 Dimensions)
    const queryVector = await getGeminiEmbedding(userMessage, env.GOOGLE_API_KEY);

    // 2. Vector Search
    const vectorResults = await env.VECTORIZE_INDEX.query(queryVector, {
      topK: 10,
      returnMetadata: true
    });

    // 3. Keyword Search
    const fuse = new Fuse(kbData, {
      keys: ['enriched_content', 'hierarchy'],
      includeScore: true,
      threshold: 0.5
    });
    const keywordResults = fuse.search(userMessage).slice(0, 10);

    // 4. Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, { score: number, content: string }>();
    const RRF_K = 60;

    vectorResults.matches.forEach((match, index) => {
      const doc = kbData.find((item) => item.id === match.id);
      if (doc) {
        rrfScores.set(match.id, { score: 1 / (RRF_K + index + 1), content: doc.enriched_content });
      }
    });

    keywordResults.forEach((match, index) => {
      const docId = match.item.id;
      const score = 1 / (RRF_K + index + 1);
      const existing = rrfScores.get(docId);

      if (existing) {
        existing.score += score;
      } else {
        rrfScores.set(docId, { score: score, content: match.item.enriched_content });
      }
    });

    // คัดเลือก Top 4 Chunks
    const topChunks = Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => item.content);

    const retrievedContext = topChunks.join('\n\n---\n\n');

    // 5. ส่ง Context ไปให้ Gemini สังเคราะห์คำตอบ
    const finalAnswer = await generateAnswerWithGemini(userMessage, retrievedContext, env.GOOGLE_API_KEY);

    // 6. ตอบกลับ LINE
    await replyToLine(replyToken, finalAnswer, env.LINE_CHANNEL_ACCESS_TOKEN);

  } catch (error) {
    console.error('Error processing message:', error);
    await replyToLine(replyToken, 'ขออภัยครับ ระบบตรวจสอบสวัสดิการขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังครับ', env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}
