import { GeminiEmbeddingResponse, GeminiGenerateResponse } from "./model";

// --- Helper: ตรวจสอบความถูกต้องของ Request จาก LINE ---
export async function verifyLineSignature(signature: string, body: string, channelSecret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return signature === signatureBase64;
}

// --- Helper: สร้าง Vector Embedding ---
export async function getGeminiEmbedding(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-2-preview',
      content: { parts: [{ text: text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 1536
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${await response.text()}`);
  }

  const data = (await response.json()) as GeminiEmbeddingResponse;
  return data.embedding.values;
}

// --- Helper: สังเคราะห์คำตอบด้วย LLM ---
export async function generateAnswerWithGemini(userMessage: string, context: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;

  const systemInstruction = `คุณคือผู้ช่วย AI ฝ่ายบุคคลของ กฟภ. ตอบคำถามเรื่องสิทธิสวัสดิการ
จงตอบคำถามโดยอ้างอิงจากข้อมูล "Context" ที่ให้มาเท่านั้น
หากข้อมูลใน Context ไม่เพียงพอต่อการตอบคำถาม ให้บอกผู้ใช้ตรงๆ ว่าไม่พบข้อมูลในระบบ
กรุณาตอบเป็นภาษาไทยด้วยน้ำเสียงสุภาพและเป็นมืออาชีพ`;

  const prompt = `Context ข้อมูลสวัสดิการ:\n${context}\n\nคำถามของผู้ใช้: ${userMessage}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3
      }
    })
  });

  if (!response.ok) {
    throw new Error(`LLM Generation failed: ${await response.text()}`);
  }

  const data = (await response.json()) as GeminiGenerateResponse;
  return data.candidates[0].content.parts[0].text;
}

// --- Helper: ตอบกลับ LINE ---
export async function replyToLine(replyToken: string, text: string, accessToken: string): Promise<void> {
  const url = 'https://api.line.me/v2/bot/message/reply';
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    })
  });
}
