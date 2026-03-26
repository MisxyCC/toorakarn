import { handleMessageEvent } from './core';
import { verifyLineSignature } from './helper';
import { LineWebhookBody } from './model';

export interface Env {
	GLOBAL_GEMINI_LIMITER: any;
  	USER_SPAM_LIMITER: any;
	GOOGLE_API_KEY: string;
	LINE_CHANNEL_ACCESS_TOKEN: string;
	LINE_CHANNEL_SECRET: string;
}

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
		console.log(`[DEBUG] Received Webhook with ${events.length} events`);
		for (const event of events) {
			console.log(`[DEBUG] 🔍 Event Type: ${event.type}, Message Type: ${event.message?.type}`);
			if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'audio')) {
				console.log(`[DEBUG] ⏭️ Skipping unhandled event type.`);
				continue;
    		}
			console.log(`[DEBUG] 🚀 Passing event to handleMessageEvent...`);
			ctx.waitUntil(handleMessageEvent(event, env));
		}
		return new Response('OK', { status: 200 });
	},
} satisfies ExportedHandler<Env>;
