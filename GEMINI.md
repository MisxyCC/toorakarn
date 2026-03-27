# Project Overview: Toorakarn (ธุรการ) 💜⚡

**Toorakarn** is a Cloudflare Workers-based AI assistant designed for employees of the **Provincial Electricity Authority (PEA / กฟภ.)**. It functions as a chatbot ("Nong Toorakarn") that answers questions regarding employee welfare, benefits, and administrative procedures using Retrieval-Augmented Generation (RAG).

## Key Technologies
- **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com/) (Node.js compatibility mode enabled).
- **Language:** TypeScript.
- **AI Engine:** [Google Gemini API](https://ai.google.dev/) (using `gemini-3.1-flash-lite-preview` for generation and `gemini-embedding-2-preview` for vector search).
- **Messaging:** [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) for the user interface.
- **Storage:** 
  - [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/) for efficient semantic search.
  - [Cloudflare KV](https://developers.cloudflare.com/kv/api/) for storing full knowledge base documents.
- **Rate Limiting:** Cloudflare Workers `ratelimits` to manage API usage (Global and User-level).

## Architecture
- `src/index.ts`: Entry point for LINE webhooks. Handles signature verification and dispatches events.
- `src/core.ts`: Main logic for RAG (Two-hop retrieval: Vectorize -> KV) and Gemini interactions.
- `src/helper.ts`: Utility functions, LINE API helpers, and the `systemInstruction` (Persona definition).
- `src/model.ts`: TypeScript interfaces and error enums.
- `src/knowledge_base.json`: Source data used to populate the vector index and KV storage.

---

## Building and Running

### Development Commands
- `npm run dev`: Start a local development server using `wrangler dev`.
- `npm run test`: Run the test suite using Vitest.
- `npm run deploy`: Deploy the worker to Cloudflare.
- `npm run cf-typegen`: Generate TypeScript types for Cloudflare bindings (run after modifying `wrangler.jsonc`).

### Environment Variables
The following secrets are required in the Cloudflare environment:
- `GOOGLE_API_KEY`: API key for Google Gemini.
- `LINE_CHANNEL_ACCESS_TOKEN`: Access token for the LINE Messaging API.
- `LINE_CHANNEL_SECRET`: Secret key for verifying LINE webhook signatures.

---

## Development Conventions

### Persona: น้องธุรการ (Nong Toorakarn) 💜⚡
- **Tone:** Friendly, helpful, and empathetic. Use polite Thai particles (ค่ะ/คะ).
- **Formatting (CRITICAL):**
    - **NO MARKDOWN:** Do not use `**bold**` or `*italic*` as LINE does not support them natively in standard text messages.
    - **EMOJIS:** Use emojis as visual cues (e.g., 📌 for headers, 💰 for money, 📄 for documents, ⏳ for scheduling).
    - **CHUNKING:** Keep paragraphs short and use frequent line breaks for readability on mobile devices.

### AI Constraints & RAG Strategy
- **Strict Grounding:** The bot must only answer based on the provided "Context". If information is missing, it should politely state it doesn't know.
- **Two-Hop Retrieval:** 
  1. Search `Vectorize` to find the most relevant document IDs.
  2. Fetch the full content from `KV` using those IDs.
- **Audio Support:** Supports `.m4a` audio messages by transcribing them via Gemini before processing the query.
- **Disclaimer:** Always add a reminder to verify details with official authorities when mentioning specific amounts or rights.

### Reliability & Performance
- **Timeout Management:** Uses `AbortSignal.timeout(25000)` (25 seconds) for all external requests to ensure the bot can respond with a friendly error message before Cloudflare's 30-second execution limit.
- **Rate Limiting:** Implements limits at both global (15 RPM) and user-specific levels to prevent abuse and manage API costs.

---

## Maintenance
- **Updating Knowledge:** After updating data in Vectorize/KV, ensure `src/knowledge_base.json` is kept in sync for reference.
- **Binding Changes:** Always run `npm run cf-typegen` after editing `wrangler.jsonc` to update the `Env` interface.
