ALTER TABLE "questions"
ADD COLUMN "answerKey" TEXT;

CREATE UNIQUE INDEX "user_answers_quizAttemptId_questionId_key"
ON "user_answers"("quizAttemptId", "questionId");
