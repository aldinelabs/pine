<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import type { PinePendingQuestionnaire } from "@/stores/session";

const props = defineProps<{
  questionnaire: PinePendingQuestionnaire;
}>();

const emit = defineEmits<{
  respond: [submission: AskUserQuestionSubmission];
}>();

const { t } = useI18n();
const customAnswers = ref<Record<number, string>>({});
const selectedPreviews = ref<Record<number, string | undefined>>({});
const responded = ref(false);

const items = props.questionnaire.questionnaire.questions.map(
  (question, questionIndex) => ({
    name: `question-${questionIndex}`,
    required: true,
    choices: question.options.map((_, optionIndex) => ({
      value: `option:${optionIndex}`,
    })),
  }),
);
const activeItem = ref(items[0]?.name ?? "");
const activeQuestionIndex = computed(() =>
  Math.max(
    0,
    items.findIndex((item) => item.name === activeItem.value),
  ),
);
const activeQuestion = computed(
  () =>
    props.questionnaire.questionnaire.questions[activeQuestionIndex.value] ??
    props.questionnaire.questionnaire.questions[0],
);

function respond(submission: AskUserQuestionSubmission): void {
  if (responded.value) return;
  responded.value = true;
  emit("respond", submission);
}

function handleChoiceChange(
  questionIndex: number,
  optionIndex: number,
  event: Event,
): void {
  const question = props.questionnaire.questionnaire.questions[questionIndex];
  if (question?.multiSelect || !(event.target instanceof HTMLInputElement)) {
    return;
  }
  if (event.target.checked) {
    customAnswers.value[questionIndex] = "";
    selectedPreviews.value[questionIndex] =
      question.options[optionIndex]?.preview;
  }
}

function handleCustomAnswer(questionIndex: number, value: string): void {
  customAnswers.value[questionIndex] = value;
  if (value.trim()) selectedPreviews.value[questionIndex] = undefined;
}

function handleSubmit(event: Event): void {
  event.preventDefault();
  const formData = new FormData(event.target as HTMLFormElement);
  respond({
    cancelled: false,
    answers: props.questionnaire.questionnaire.questions.map(
      (_, questionIndex) => {
        const values = formData.getAll(`question-${questionIndex}`).map(String);
        return {
          questionIndex,
          selectedOptionIndexes: values.flatMap((value) => {
            const match = /^option:(\d+)$/.exec(value);
            return match ? [Number(match[1])] : [];
          }),
          ...(customAnswers.value[questionIndex]?.trim()
            ? { customAnswer: customAnswers.value[questionIndex].trim() }
            : {}),
        };
      },
    ),
  });
}

function cancel(): void {
  respond({ answers: [], cancelled: true });
}
</script>

<template>
  <Card data-slot="questionnaire-card" class="max-h-[min(32rem,60dvh)] min-h-0">
    <Questionnaire
      :key="questionnaire.requestId"
      class="min-h-0 flex-1"
      v-model:item="activeItem"
      :items="items"
      shortcuts="letters"
      @submit="handleSubmit"
    >
      <CardHeader class="shrink-0">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1.5">
            <CardTitle>{{ activeQuestion?.question }}</CardTitle>
            <CardDescription>{{ activeQuestion?.header }}</CardDescription>
          </div>
          <QuestionnaireProgress
            v-slot="{ current, total }"
            class="min-w-0 shrink-0 text-end"
          >
            {{ t("project.questionnaireRequest.progress", { current, total }) }}
          </QuestionnaireProgress>
        </div>
      </CardHeader>

      <!-- The padding keeps answers' focus rings inside the scroll area; the
        negative margin keeps the card's spacing. -->
      <CardContent
        class="scroll-fade-y -my-1 min-h-0 overflow-y-auto overscroll-contain py-1"
      >
        <QuestionnaireItem
          v-for="(question, questionIndex) in questionnaire.questionnaire
            .questions"
          :key="questionIndex"
          :name="`question-${questionIndex}`"
          :multiple="question.multiSelect"
          required
        >
          <QuestionnaireTitle class="sr-only">
            {{ question.question }}
          </QuestionnaireTitle>
          <QuestionnaireDescription class="sr-only">
            {{ question.header }}
          </QuestionnaireDescription>
          <QuestionnaireChoices>
            <QuestionnaireChoice
              v-for="(option, optionIndex) in question.options"
              :key="optionIndex"
              :value="`option:${optionIndex}`"
              @change="handleChoiceChange(questionIndex, optionIndex, $event)"
            >
              <span class="font-medium">{{ option.label }}</span>
              <QuestionnaireChoiceDescription>
                {{ option.description }}
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
            <QuestionnaireInput
              :model-value="customAnswers[questionIndex] ?? ''"
              :aria-label="t('project.questionnaireRequest.customAnswer')"
              :placeholder="t('project.questionnaireRequest.customAnswer')"
              @update:model-value="handleCustomAnswer(questionIndex, $event)"
            />
          </QuestionnaireChoices>
          <div
            v-if="selectedPreviews[questionIndex]"
            class="scroll-fade-y mt-3 max-h-52 overflow-auto overscroll-contain rounded-lg bg-muted/60 p-3"
          >
            <MarkdownContent
              :source="selectedPreviews[questionIndex] ?? ''"
              final
            />
          </div>
          <QuestionnaireError>
            {{ t("project.questionnaireRequest.required") }}
          </QuestionnaireError>
        </QuestionnaireItem>
      </CardContent>

      <CardFooter class="shrink-0">
        <QuestionnaireActions class="flex justify-end">
          <QuestionnairePrevious class="me-auto">
            {{ t("project.questionnaireRequest.previous") }}
          </QuestionnairePrevious>
          <div
            data-slot="questionnaire-primary-actions"
            class="flex items-center gap-2"
          >
            <Button type="button" variant="ghost" @click="cancel">
              {{ t("project.questionnaireRequest.cancel") }}
            </Button>
            <QuestionnaireNext>
              {{ t("project.questionnaireRequest.next") }}
            </QuestionnaireNext>
            <QuestionnaireSubmit>
              {{ t("project.questionnaireRequest.submit") }}
            </QuestionnaireSubmit>
          </div>
        </QuestionnaireActions>
      </CardFooter>
    </Questionnaire>
  </Card>
</template>
