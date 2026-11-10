# StudyMate Backend

StudyMate is a Fastify API for course materials, AI-assisted study, quizzes,
and course-grounded chat. PostgreSQL is accessed through Prisma 7; Ollama
provides local text generation and embeddings.

## Requirements

- Node.js 22.18 or newer
- PostgreSQL
- npm
- Ollama with the configured chat and embedding models available locally

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the credentials and
   database configured on your machine. Keep `.env` private.
3. Generate the Prisma Client with `npm run db:generate`.
4. Check migration status with `npm run db:status`. Apply pending additive
   migrations to an existing database with `npx prisma migrate deploy`; do not
   reset an existing database.
5. Start the development server with `npm run dev`.

The default AI models are `qwen2.5:1.5b` for chat and
`embeddinggemma:300m` for embeddings and `lfm3-audio:2b` for voice
transcription. Configure `AI_BASE_URL`, `AI_CHAT_MODEL`,
`AI_EMBEDDING_MODEL`, `AI_VOICE_MODEL`, and `AI_TIMEOUT_MS` in `.env` to use
different local Ollama models. The configured models are checked through the
Ollama `/api/tags` endpoint.

The server binds to `localhost:3000` by default. Override `HOST` and `PORT` in
`.env` to change this.

## Health endpoints

- `GET /health/live` reports whether the process is responding.
- `GET /health/ready` checks PostgreSQL and returns `503` if it is unavailable.
- `GET /health/ai` checks Ollama availability and returns a sanitized `503` if
  the model server is unavailable.

## Authentication

Authentication routes are under `/api/v1/auth`:

- `POST /register` creates an account and starts a session.
- `POST /login` starts a session.
- `POST /logout` revokes the current session.
- `GET /me` returns the authenticated user.

Sessions use random opaque tokens in an HttpOnly, SameSite=Strict cookie. The
frontend and API must be on the same site for browser cookie rules to allow the
session. Only the SHA-256 token hash is stored in PostgreSQL. Passwords are
hashed with Argon2id. Browser requests that change state must include an
`Origin` matching `APP_ORIGIN`; credentialed CORS is restricted to that same
origin. The secure cookie flag is enabled in production, where `APP_ORIGIN`
must use HTTPS.

Registration requires a valid email address, names up to 100 characters, and a
password of 12–128 characters. Login and registration are limited to five
requests per minute per client IP.

Session storage, course archival, document ingestion, and quiz answer keys are
introduced by additive migrations. They are not automatically applied at
server startup. Apply pending migrations with `npx prisma migrate deploy`
before using the affected features against an existing database.

## Courses and chapters

Course and chapter routes are under `/api/v1/courses` and require an
authenticated session:

- `GET /courses?page=1&pageSize=20` lists the current user's courses.
- `POST /courses` creates a course (`title`, optional `description`).
- `GET`, `PATCH`, and `DELETE /courses/:courseId` retrieve, update, and archive
  an owned course.
- `GET` and `POST /courses/:courseId/chapters` list or create chapters.
- `GET`, `PATCH`, and `DELETE /courses/:courseId/chapters/:chapterId` manage a
  chapter.

Lists use page-based pagination and return `page`, `pageSize`, `total`,
`totalPages`, and `hasNextPage` in `meta`. All resource lookups are scoped to
the authenticated user. Chapter/document associations are checked against the
same course.

Deleting a course archives it instead of cascading deletion, preserving its
documents, summaries, quiz sets, and history. Archived courses no longer appear
in normal course or chapter/document routes.

## Documents

Documents are nested under courses:

- `GET /api/v1/courses/:courseId/documents` lists metadata.
- `POST /api/v1/courses/:courseId/documents` accepts one multipart field named
  `file` (maximum 10 MiB).
- `GET` and `DELETE /api/v1/courses/:courseId/documents/:documentId` download
  or delete an owned document.

PDF, PNG, and JPEG file signatures are checked; image files are also parsed
with input-pixel limits. Files are stored under the private `FILE_STORAGE_DIR`
directory using generated names. Client filenames are metadata only; absolute
storage paths are never returned.

Uploads are queued and processed asynchronously. Text-based PDFs are extracted
with limits of 500 pages and 5 MiB of text. Scanned PDFs (up to 30 pages) and
images use the packaged local English Tesseract model. Extracted text is split
into overlapping chunks, embedded through Ollama, and persisted in PostgreSQL.
Document statuses progress through `PENDING`, `PROCESSING`, and `COMPLETED`, or
`FAILED` after three processing attempts. Stale processing jobs are recovered
on server startup. The document response includes a sanitized `processingError`
for failed jobs.

PostgreSQL installations without pgvector use JSONB-stored embeddings and
bounded application-side cosine similarity over up to 2,000 course chunks.
This keeps the project usable without a database extension; for larger
collections, configure pgvector or another vector database before scaling.

## Study, quizzes, and chat

The authenticated study API is under `/api/v1`:

- `GET` and `POST /courses/:courseId/summaries` list or generate a
  source-grounded study summary.
- `GET` and `POST /courses/:courseId/question-sets` list or generate
  multiple-choice, true/false, or open-answer questions.
- `GET /courses/:courseId/question-sets/:questionSetId` retrieves a question
  set without exposing correct answers.
- `POST /question-sets/:questionSetId/attempts` starts a quiz attempt.
- `PATCH /quiz-attempts/:attemptId/answers` submits or updates an answer.
- `POST /quiz-attempts/:attemptId/submit` grades and completes an attempt after
  all questions have answers.
- `GET` and `POST /courses/:courseId/conversations` list or create a course
  conversation.
- `GET` and `POST /courses/:courseId/conversations/:conversationId/messages`
  read history or ask a question grounded in processed course materials.
- `POST /courses/:courseId/conversations/:conversationId/voice-messages`
  accepts a PCM WAV recording and stores its LFM3-Audio-2B transcription as a
  user message.

AI-generated study content and chat answers are grounded in retrieved course
chunks and include source citations. Ownership checks apply to courses,
question sets, attempts, and conversations.

Voice requests use a single multipart `audio` file with `.wav` extension
(8–48 kHz, mono or stereo, PCM, maximum 3 minutes/10 MiB). Optional
`?language=` accepts `en`, `ar`, `da`, `de`, `el`, `fi`, `fr`, `he`, `it`,
`ja`, `ko`, `nl`, `pl`, `pt`, `es`, `sv`, `tr`, or `zh`; English is the
default. Original audio is processed in memory and is not saved. The
transcription is stored as the message `content` and `transcription`, marked
with `inputType: AUDIO`. The regular text message endpoint can then be used
to ask the course tutor a question using that transcription.

Ollama 0.40.x does not expose a native `audio` request field. The voice
adapter therefore sends WAV bytes through the installed LFM3 model's
multimodal input and the model's `Perform ASR in <language>.` prompt. This
path was verified with an actual generated speech sample. The configured
voice model must be present in Ollama; `/health/ai` checks all three models.

## Not included

Speech synthesis and audio replies are not implemented. Voice input is
transcribed and stored as text; use the existing text-chat API for a tutor
response.

## Commands

- `npm run dev` — run the server with TypeScript watch mode.
- `npm run build` — generate Prisma Client and compile TypeScript to `dist/`.
- `npm start` — run the compiled server.
- `npm test` — build and run health, configuration, authentication, resource,
  OCR, voice transcription, ingestion, AI-provider, retrieval, storage, and
  PDF extraction tests.
- `npm run db:status` — inspect Prisma migration status.
