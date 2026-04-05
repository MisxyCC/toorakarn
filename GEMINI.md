# GEMINI.md - Toorakarn AI Assistant (น้องธุรการ) 💜⚡

This document provides foundational context, architectural overview, and development guidelines for the **Toorakarn** project, an AI Assistant developed for Provincial Electricity Authority (PEA) employees.

## 🌟 Project Overview
**Toorakarn (น้องธุรการ)** is a specialized AI Chatbot designed to help PEA employees access welfare information, regulations, and administrative procedures through the LINE Messaging API.

- **Primary Goal:** Provide accurate, polite, and professional assistance regarding PEA welfare and contact information.
- **Core Technology Stack:**
    - **Runtime:** Cloudflare Workers (TypeScript)
    - **AI Engine:** Google Gemini (3.1 Flash Lite for logic/voice, Embedding-2 for search)
    - **Databases:** 
        - **Cloudflare Vectorize:** Semantic search for welfare documents.
        - **Cloudflare KV:** Storage for document content (referenced by Vectorize).
        - **Cloudflare D1 (SQL):** Phone directory and sliding-window chat memory.
    - **Interface:** LINE Messaging API (Webhook-based).

## 🏗 System Architecture & Flow

### 1. Webhook Entry (`src/index.ts`)
- Handles incoming POST requests from LINE.
- Verifies `x-line-signature` to ensure requests originate from LINE.
- Dispatches events to `handleMessageEvent` using `ctx.waitUntil` for non-blocking execution.

### 2. Core Orchestration (`src/core.ts`)
- **Rate Limiting:** Implements global (15 RPM) and per-user spam protection.
- **Input Processing:** 
    - Text: Sanitized and truncated.
    - Audio: Transcribed via Gemini (`transcribeAudio`) before processing.
- **Intent Routing:** Uses an LLM-based router (`analyzeQueryIntent`) to classify queries into `directory` (phone search) or `general/welfare` (RAG search).
- **Hybrid Search Strategy:**
    - **Phone Directory:** Queries D1 SQL first if the intent is directory-related.
    - **Welfare RAG:** Falls back to Gemini Embedding + Cloudflare Vectorize + KV if not found in D1 or if the intent is general.
- **Contextual Answer Generation:** Gemini generates the final response based on retrieved context, chat history, and strict system instructions.

### 3. Knowledge Base & Storage
- **Vector Index:** `toorakarn-knowledge-index` (1536 dimensions).
- **D1 Tables:**
    - `PhoneDirectory`: Stores department names, acronyms, and numbers.
    - `ChatMemory`: Stores `history_json` for user sessions.

## 🛠 Building and Running

### Development Commands
- **Local Dev:** `npm run dev` (uses `wrangler dev`)
- **Deploy:** `npm run deploy` (uses `wrangler deploy`)
- **Test:** `npm run test` (uses `vitest`)
- **Type Generation:** `npm run cf-typegen` (synchronizes Cloudflare bindings with TypeScript)

### Environment Variables (Secrets)
The following secrets must be configured in Cloudflare:
- `GOOGLE_API_KEY`: For Gemini API access.
- `LINE_CHANNEL_ACCESS_TOKEN`: For replying to LINE users.
- `LINE_CHANNEL_SECRET`: For webhook signature verification.

## 📏 Development Conventions

### Persona & Style (`systemInstruction` in `src/helper.ts`)
- **Name:** "Nong Toorakarn" (น้องธุรการ) 💜⚡.
- **Tone:** Warm, professional, helpful, but strictly grounded in provided context.
- **Formatting:** Use Emojis for structure (💡, 🧮, 📌, 📞, etc.). Avoid Markdown symbols (*, #, -) as they may not render ideally in LINE.
- **Strict Grounding:** Never hallucinate. If information is not in `<context>`, state that the information is not found.

### Technical Patterns
- **Safety:** Always verify LINE signatures.
- **Efficiency:** Use `ctx.waitUntil` for all asynchronous tasks after responding to the webhook to avoid exceeding Cloudflare's response time limits.
- **Memory:** Chat memory is limited to a 4-message sliding window (`MAX_HISTORY_LENGTH`) with a 15-minute TTL (`MEMORY_TTL_MS`).
- **Timeouts:** Main processing is capped at 25 seconds (`baseTimeout`) to allow a graceful error response before Cloudflare's 30-second hard limit.

### Error Handling
- Use `CommonErrorResponse` enum for standardized error messages.
- Specific handling for rate limits (RPM/RPD) and Gemini timeouts.
- Provide user-friendly feedback in Thai for all failure modes.
