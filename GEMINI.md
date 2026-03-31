# GEMINI.md - Project Context: Toorakarn (น้องธุรการ) 💜⚡

This file serves as the foundational instructional context for Gemini CLI when working within the Toorakarn project.

## 🚀 Project Overview
**Toorakarn (น้องธุรการ)** is an AI Chatbot developed as a personal assistant for **Provincial Electricity Authority (PEA / กฟภ.)** employees. It assists with inquiries regarding employee benefits, regulations, and administrative procedures via the LINE Messaging API.

### 🛠 Core Technology Stack
- **Platform:** Cloudflare Workers (TypeScript)
- **AI Model:** Google Gemini 3.1 Flash Lite (via `@google/genai` SDK)
- **Database/Storage:** 
  - **Cloudflare Vectorize:** For semantic search and RAG indexing.
  - **Cloudflare KV:** For storing full knowledge base document content.
- **Interface:** LINE Messaging API (Webhook based).
- **Runtime:** Node.js compatibility mode on Cloudflare.

### 🏗 Architecture & Flow
1. **Webhook Entry:** `src/index.ts` receives POST requests from LINE, verifies signatures, and hands off events to the core logic.
2. **Core Processing:** `src/core.ts` manages the lifecycle of a message:
   - **Text Messages:** Extracted directly.
   - **Audio Messages:** Downloaded from LINE and transcribed using Gemini.
3. **Retrieval-Augmented Generation (RAG):**
   - Query text is converted to an embedding.
   - **Two-Hop Retrieval:** 
     1. Search `VECTORIZE` for the top-K matching document IDs.
     2. Retrieve the full text content from `KV` using those IDs.
4. **Grounded Generation:** The query and retrieved context are sent to Gemini with a strict system instruction to answer *only* based on the provided context (Strict Grounding).
5. **Response:** The formatted answer is sent back to the user via the LINE Messaging API.

---

## 💻 Development Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Starts local development server using `wrangler dev`. |
| `npm run deploy` | Deploys the worker to Cloudflare. |
| `npm run test` | Executes tests using Vitest (Vitest Pool for Workers). |
| `npm run cf-typegen` | Generates TypeScript types for Cloudflare bindings (KV, Vectorize, etc.). |

---

## 📂 Key File Structure
- `src/index.ts`: Worker entry point; handles request routing and signature verification.
- `src/core.ts`: The "brain" of the application; coordinates RAG and Gemini interactions.
- `src/helper.ts`: Utility functions for LINE API, Gemini API, rate limiting, and formatting.
- `src/model.ts`: TypeScript interfaces and enums (LINE events, Gemini responses, KB documents).
- `wrangler.jsonc`: Configuration for Cloudflare resources (KV namespaces, Vectorize indexes, Rate limits).
- `test/`: Vitest test suites.

---

## 📏 Development Conventions
- **Strict Grounding:** AI responses must be grounded in the retrieved knowledge base. Do not allow the model to hallucinate or use external knowledge for welfare rules.
- **Error Handling:** Use the defined `CommonErrorResponse` patterns. Ensure users receive friendly, persona-consistent error messages (e.g., "แงงง 😭", "ขออภัยค่า 😅").
- **Performance:** Maintain a response path under 25 seconds to avoid Cloudflare's 30-second execution limit and allow for a timeout response to be sent to LINE.
- **Bindings:** When adding or changing Cloudflare resources (KV, R2, etc.), update `wrangler.jsonc` and run `npm run cf-typegen`.

---

## 🤖 Persona & Tone
The assistant's persona is **"น้องธุรการ" (Nong Toorakarn)**:
- **Tone:** Friendly, helpful, polite, and uses casual Thai office particles (e.g., "นะคะ", "ค่า").
- **Visuals:** Uses emojis (💜, ⚡) to match the brand identity.
- **Formatting:** Uses Markdown-lite suitable for mobile phone screens (short paragraphs, bullet points).
