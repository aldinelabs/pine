import { type Static, Type } from "typebox";

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const RESERVED_LABELS = ["Other", "Type something.", "Next"] as const;

export const AskUserQuestionOptionSchema = Type.Object({
  label: Type.String({
    maxLength: MAX_LABEL_LENGTH,
    description:
      "A concise 1-5 word label for this choice. Append (Recommended) to the first label when recommending it.",
  }),
  description: Type.String({
    description: "What this choice means or the trade-off it carries.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional markdown preview for a concrete artifact. Use only for single-select questions.",
    }),
  ),
});

export const AskUserQuestionSchema = Type.Object({
  question: Type.String({
    description: "The complete, clear question to ask the user.",
  }),
  header: Type.String({
    maxLength: MAX_HEADER_LENGTH,
    description: "A short label for the question, up to 16 characters.",
  }),
  options: Type.Array(AskUserQuestionOptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: "Two to four distinct authored choices.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Allow selecting more than one authored choice.",
    }),
  ),
});

export const AskUserQuestionParamsSchema = Type.Object({
  questions: Type.Array(AskUserQuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: "One to four questions to ask in a single interruption.",
  }),
  timeout: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 3600,
      description:
        "Seconds to wait for a reply in Autonomous Work mode (1-3600). Required in Autonomous Work mode; other modes ignore it and wait until the user responds.",
    }),
  ),
});

export type AskUserQuestionOption = Static<typeof AskUserQuestionOptionSchema>;
export type AskUserQuestion = Static<typeof AskUserQuestionSchema>;
export type AskUserQuestionParams = Static<typeof AskUserQuestionParamsSchema>;

export type AskUserQuestionError =
  | "no_questions"
  | "too_many_questions"
  | "empty_options"
  | "duplicate_question"
  | "duplicate_option_label"
  | "reserved_label"
  | "invalid_timeout"
  | "missing_timeout";

export interface AskUserQuestionAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "multi";
  answer: string | null;
  selected?: string[];
  preview?: string;
}

export interface AskUserQuestionResult {
  answers: AskUserQuestionAnswer[];
  cancelled: boolean;
  timedOut?: boolean;
  timeoutSeconds?: number;
  error?: AskUserQuestionError;
}

export interface AskUserQuestionSubmission {
  answers: Array<{
    questionIndex: number;
    selectedOptionIndexes: number[];
    customAnswer?: string;
  }>;
  cancelled: boolean;
}

export type AskUserQuestionValidation =
  { ok: true } | { ok: false; error: AskUserQuestionError; message: string };

export const ASK_USER_QUESTION_PROMPT_SNIPPET =
  "Ask the user up to four structured questions (2-4 options each) when requirements are ambiguous";

export const ASK_USER_QUESTION_PROMPT_GUIDELINES = [
  "Use ask_user_question when the request is underspecified and a concrete user decision is required. Group all clarifying questions into one invocation.",
  'Each question must have 2-4 authored options with concise labels and descriptions. A custom-answer field is added automatically; do not author "Other" or "Type something." options.',
  'Set multiSelect to true when multiple answers are valid. Put a recommended option first and append "(Recommended)" to its label.',
  "Use preview only when concrete markdown artifacts materially help compare single-select options.",
  "In Autonomous Work mode, timeout (seconds, 1-3600) is required. If the user does not reply in time, decide how to continue from available information.",
] as const;

export const ASK_USER_QUESTION_DESCRIPTION = `Ask the user one or more structured questions during execution when a preference, requirement, or implementation decision is needed. Ask 1-4 questions per call, with 2-4 options per question. Every option needs a concise label and a description of its meaning or trade-off. The user can always provide a custom answer. Use multiSelect for non-exclusive choices, and use markdown previews only for concrete single-select comparisons. Do not author reserved Other, Type something., or Next options. In Autonomous Work mode, timeout is required: it sets how many seconds (1-3600) to wait before returning a user-response timeout.`;

function normalizeLineTerminators(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

export function normalizeAskUserQuestionParams(
  params: AskUserQuestionParams,
): AskUserQuestionParams {
  return {
    ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
    questions: params.questions.map((question) => ({
      ...question,
      question: normalizeLineTerminators(question.question),
      header: normalizeLineTerminators(question.header),
      options: question.options.map((option) => ({
        ...option,
        label: normalizeLineTerminators(option.label),
        description: normalizeLineTerminators(option.description),
        ...(option.preview !== undefined
          ? { preview: normalizeLineTerminators(option.preview) }
          : {}),
      })),
    })),
  };
}

export function validateAskUserQuestion(
  params: AskUserQuestionParams,
): AskUserQuestionValidation {
  if (
    params.timeout !== undefined &&
    (!Number.isFinite(params.timeout) ||
      params.timeout < 1 ||
      params.timeout > 3600)
  ) {
    return {
      ok: false,
      error: "invalid_timeout",
      message: "Error: timeout must be between 1 and 3600 seconds",
    };
  }
  if (params.questions.length === 0) {
    return {
      ok: false,
      error: "no_questions",
      message: "Error: At least one question is required",
    };
  }
  if (params.questions.length > MAX_QUESTIONS) {
    return {
      ok: false,
      error: "too_many_questions",
      message: `Error: At most ${MAX_QUESTIONS} questions are allowed per invocation`,
    };
  }

  const seenQuestions = new Set<string>();
  for (const question of params.questions) {
    if (seenQuestions.has(question.question)) {
      return {
        ok: false,
        error: "duplicate_question",
        message: "Error: Question text must be unique within an invocation",
      };
    }
    seenQuestions.add(question.question);
  }

  const reservedLabels = new Set<string>(RESERVED_LABELS);
  for (const question of params.questions) {
    if (question.options.length < MIN_OPTIONS) {
      return {
        ok: false,
        error: "empty_options",
        message: `Error: Each question requires at least ${MIN_OPTIONS} options`,
      };
    }
    const seenLabels = new Set<string>();
    for (const option of question.options) {
      if (reservedLabels.has(option.label)) {
        return {
          ok: false,
          error: "reserved_label",
          message: `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`,
        };
      }
      if (seenLabels.has(option.label)) {
        return {
          ok: false,
          error: "duplicate_option_label",
          message: "Error: Option labels must be unique within a question",
        };
      }
      seenLabels.add(option.label);
    }
  }
  return { ok: true };
}

export function resolveAskUserQuestionSubmission(
  params: AskUserQuestionParams,
  submission: AskUserQuestionSubmission,
): AskUserQuestionResult {
  if (submission.cancelled) return { answers: [], cancelled: true };

  const answers = submission.answers.flatMap<AskUserQuestionAnswer>(
    (submissionAnswer) => {
      const question = params.questions[submissionAnswer.questionIndex];
      if (!question) return [];
      const customAnswer = submissionAnswer.customAnswer?.trim();
      const selectedOptions = submissionAnswer.selectedOptionIndexes.flatMap(
        (optionIndex) => {
          const option = question.options[optionIndex];
          return option ? [option] : [];
        },
      );

      if (question.multiSelect) {
        const selected = selectedOptions.map((option) => option.label);
        if (customAnswer) selected.push(customAnswer);
        return selected.length > 0
          ? [
              {
                questionIndex: submissionAnswer.questionIndex,
                question: question.question,
                kind: "multi",
                answer: null,
                selected,
              },
            ]
          : [];
      }

      if (customAnswer) {
        return [
          {
            questionIndex: submissionAnswer.questionIndex,
            question: question.question,
            kind: "custom",
            answer: customAnswer,
          },
        ];
      }

      const option = selectedOptions[0];
      return option
        ? [
            {
              questionIndex: submissionAnswer.questionIndex,
              question: question.question,
              kind: "option",
              answer: option.label,
              ...(option.preview ? { preview: option.preview } : {}),
            },
          ]
        : [];
    },
  );

  return { answers, cancelled: answers.length === 0 };
}

function formatAnswer(answer: AskUserQuestionAnswer): string {
  if (answer.kind === "multi") {
    return answer.selected?.length ? answer.selected.join(", ") : "(no input)";
  }
  return answer.answer?.length ? answer.answer : "(no input)";
}

export function buildAskUserQuestionToolResult(
  result: AskUserQuestionResult,
  params: AskUserQuestionParams,
) {
  if (result.cancelled) {
    return {
      content: [
        {
          type: "text" as const,
          text: result.timedOut
            ? `User response timed out after ${result.timeoutSeconds} seconds. Continue using the information already available.`
            : "User declined to answer questions",
        },
      ],
      details: result,
    };
  }

  const segments = params.questions.flatMap((_, questionIndex) => {
    const answer = result.answers.find(
      (candidate) => candidate.questionIndex === questionIndex,
    );
    if (!answer) return [];
    const preview = answer.preview
      ? `. selected preview: ${answer.preview}`
      : "";
    return [`"${answer.question}"="${formatAnswer(answer)}"${preview}.`];
  });
  return {
    content: [
      {
        type: "text" as const,
        text: `User has answered your questions: ${segments.join(" ")} You can now continue with the user's answers in mind.`,
      },
    ],
    details: result,
  };
}
