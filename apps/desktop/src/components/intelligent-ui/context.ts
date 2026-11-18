import {
  ACTION_STEPS,
  isReactiveAssign,
  resolveStateField,
  type ActionPlan,
} from "@openuidev/lang-core";
import {
  parseStructuredRules,
  useFormValidation,
  validate,
  useOpenUI,
  useRenderNode,
} from "@openuidev/vue-lang";
import {
  computed,
  defineComponent,
  inject,
  onScopeDispose,
  shallowRef,
  useId,
  watch,
  type ComputedRef,
  type InjectionKey,
  type WritableComputedRef,
} from "vue";
import { useI18n } from "vue-i18n";

/** Sends a message to the session as if the user typed it. */
export interface IntelligentUiHost {
  send: (message: string) => void;
}

export const intelligentUiHostKey: InjectionKey<IntelligentUiHost> = Symbol(
  "intelligent-ui-host",
);

/**
 * Asks before an http(s) URL from a block opens in the browser. The block
 * provides it, with the same confirmation as links in Markdown.
 */
export const iuiOpenUrlKey: InjectionKey<(url: string) => void> =
  Symbol("iui-open-url");

/** Only web URLs open; anything else (`javascript:`, `file:`) is ignored. */
export function isWebUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\/\S/iu.test(url.trim());
}

export function useOpenUrl(): (url: unknown) => void {
  const open = inject(iuiOpenUrlKey, undefined);
  return (url) => {
    if (open && isWebUrl(url)) open(url.trim());
  };
}

/** Renders a child slot value (a node or a list of them). */
export const IuiNodes = defineComponent({
  name: "IuiNodes",
  props: { value: { type: null, default: null } },
  setup(props) {
    const renderNode = useRenderNode();
    return () => renderNode(props.value);
  },
});

/**
 * Two-way value for an input. A `$variable` argument reads and writes the
 * block's store; a literal argument keeps a local value seeded from it.
 *
 * The Renderer provides its context once, so store reads are not reactive by
 * themselves; a store subscription drives re-reads instead.
 */
export function useBoundValue<T>(
  binding: () => unknown,
): WritableComputedRef<T> {
  const ctx = useOpenUI();
  const version = shallowRef(0);
  onScopeDispose(ctx.store.subscribe(() => version.value++));
  const local = shallowRef<{ value: T }>();

  return computed<T>({
    get() {
      void version.value;
      const value = binding();
      if (isReactiveAssign(value)) return ctx.store.get(value.target) as T;
      return local.value ? local.value.value : (value as T);
    },
    set(next) {
      const value = binding();
      if (!isReactiveAssign(value)) {
        local.value = { value: next };
        return;
      }
      resolveStateField<T>(
        value.target,
        value,
        ctx.store,
        ctx.evaluationContext,
        () => undefined,
        () => undefined,
      ).setValue(next);
    },
  });
}

/**
 * Joins a field to the Form around it, if any. The Form runs the vue-lang
 * validation with the field's rules; the message shown is Pine's own, in
 * the app's language, for the first rule that fails.
 */
export function useFieldRules(
  rules: () => unknown,
  value: () => unknown,
): ComputedRef<string | undefined> {
  const form = useFormValidation();
  const { t } = useI18n();
  const name = `field-${useId()}`;
  const parsed = computed(() => parseStructuredRules(rules()));
  if (form) {
    form.registerField(name, parsed.value, value);
    watch(parsed, (next) => form.registerField(name, next, value));
    onScopeDispose(() => form.unregisterField(name));
    // A shown error clears as soon as the value satisfies the rules.
    watch(value, (next) => {
      if (form.errors[name]) form.validateField(name, next, parsed.value);
    });
  }
  return computed(() => {
    if (!form?.errors[name]) return undefined;
    const failed = firstFailedRule(value(), rules());
    return failed ? t(`intelligentUi.rules.${failed.type}`, failed) : undefined;
  });
}

/**
 * The first rule a value breaks, with its argument, for the message. Each
 * rule goes through vue-lang's own validator, so the message always agrees
 * with what the Form blocks on.
 */
export function firstFailedRule(
  value: unknown,
  rules: unknown,
): { type: string; arg: string } | undefined {
  const failed = parseStructuredRules(rules).find(
    (rule) => validate(value, [rule]) !== undefined,
  );
  return failed && { type: failed.type, arg: String(failed.arg ?? "") };
}

const STEP_TYPES = new Set<string>(Object.values(ACTION_STEPS));

/** Whether running the action sends a message, which a Form checks first. */
function sendsMessage(plan: ActionPlan | undefined): boolean {
  return (
    !plan || plan.steps.some((step) => step.type === ACTION_STEPS.ToAssistant)
  );
}

/**
 * Run a Button's action. Inside a Form, an action that sends a message
 * runs only once every field passes its rules. A bare `@Set(...)` arrives as one step rather than
 * an Action([...]) plan, so it is wrapped before the runtime sees it.
 */
export function useRunAction(): (label: string, action: unknown) => void {
  const { triggerAction } = useOpenUI();
  const form = useFormValidation();
  return (label, action) => {
    let plan: ActionPlan | undefined;
    if (action && typeof action === "object") {
      if ("steps" in action) {
        plan = action as ActionPlan;
      } else if (
        "type" in action &&
        typeof action.type === "string" &&
        STEP_TYPES.has(action.type)
      ) {
        plan = { steps: [action as ActionPlan["steps"][number]] };
      }
    }
    if (form && sendsMessage(plan) && !form.validateForm()) return;
    // The runtime accepts a plan here although its declared type is narrower.
    triggerAction(
      label,
      undefined,
      plan as Parameters<typeof triggerAction>[2],
    );
  };
}
