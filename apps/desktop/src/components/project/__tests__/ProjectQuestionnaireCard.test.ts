import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { createAppI18n } from "@/app/i18n";
import ProjectQuestionnaireCard from "../ProjectQuestionnaireCard.vue";

const question: AskUserQuestionParams["questions"][number] = {
  header: "Approach",
  question: "How should Pine proceed?",
  options: [
    {
      label: "Small patch",
      description: "Keep the implementation narrow.",
      preview: "**Small** preview",
    },
    {
      label: "Full adapter",
      description: "Build a reusable package boundary.",
    },
  ],
};

function mountCard(questions: AskUserQuestionParams["questions"] = [question]) {
  return mount(ProjectQuestionnaireCard, {
    props: {
      questionnaire: {
        requestId: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
        toolCallId: "tool-1",
        questionnaire: {
          questions,
        },
      },
    },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        MarkdownContent: {
          props: ["source"],
          template: '<div data-slot="markdown-stub">{{ source }}</div>',
        },
      },
    },
  });
}

describe("ProjectQuestionnaireCard", () => {
  it("uses the current question as the card heading", () => {
    const wrapper = mountCard();

    expect(wrapper.get('[data-slot="card-title"]').text()).toBe(
      "How should Pine proceed?",
    );
    expect(wrapper.get('[data-slot="card-description"]').text()).toBe(
      "Approach",
    );
    expect(wrapper.text()).not.toContain("Your input is needed");
  });

  it("updates the card heading when moving to the next question", async () => {
    const wrapper = mountCard([
      question,
      {
        header: "Timing",
        question: "When should Pine start?",
        options: [
          { label: "Now", description: "Start immediately." },
          { label: "Later", description: "Wait for another change." },
        ],
      },
    ]);

    await wrapper.findAll('input[type="radio"]')[0].setValue(true);
    await wrapper.get('[data-slot="questionnaire-next"]').trigger("click");

    expect(wrapper.get('[data-slot="card-title"]').text()).toBe(
      "When should Pine start?",
    );
    expect(wrapper.get('[data-slot="card-description"]').text()).toBe("Timing");
  });

  it("submits a selected authored option and shows its preview", async () => {
    const wrapper = mountCard();
    await wrapper.findAll('input[type="radio"]')[0].setValue(true);
    await flushPromises();

    expect(wrapper.get('[data-slot="markdown-stub"]').text()).toBe(
      "**Small** preview",
    );
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("respond")).toEqual([
      [
        {
          cancelled: false,
          answers: [
            {
              questionIndex: 0,
              selectedOptionIndexes: [0],
            },
          ],
        },
      ],
    ]);
  });

  it("lets the user cancel without answering", async () => {
    const wrapper = mountCard();
    await wrapper.get("button[data-variant='ghost']").trigger("click");

    expect(wrapper.emitted("respond")).toEqual([
      [{ answers: [], cancelled: true }],
    ]);
  });
});
