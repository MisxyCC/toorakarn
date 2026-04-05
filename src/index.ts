import { handleMessageEvent } from './core';
import { verifyLineSignature } from './helper';
import { Env, LineWebhookBody } from './model';

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
			console.log(`[DEBUG] 🚀 Passing event to handleMessageEvent...`);
			ctx.waitUntil(handleMessageEvent(event, env));
		}
		return new Response('OK', { status: 200 });
	},
} satisfies ExportedHandler<Env>;
