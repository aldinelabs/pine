import {
  ACTION_STEPS,
  isReactiveAssign,
  resolveStateField,
  type ActionPlan,
} from "@openuidev/lang-core";
import { useOpenUI, useRenderNode } from "@openuidev/vue-lang";
import {
  computed,
  defineComponent,
  onScopeDispose,
  shallowRef,
  type InjectionKey,
  type WritableComputedRef,
} from "vue";

/** Sends a message to the session as if the user typed it. */
export interface IntelligentUiHost {
  send: (message: string) => void;
}

export const intelligentUiHostKey: InjectionKey<IntelligentUiHost> = Symbol(
  "intelligent-ui-host",
);

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

const STEP_TYPES = new Set<string>(Object.values(ACTION_STEPS));

/**
 * Run a Button's action. A bare `@Set(...)` arrives as one step rather than
 * an Action([...]) plan, so it is wrapped before the runtime sees it.
 */
export function useRunAction(): (label: string, action: unknown) => void {
  const { triggerAction } = useOpenUI();
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
    // The runtime accepts a plan here although its declared type is narrower.
    triggerAction(
      label,
      undefined,
      plan as Parameters<typeof triggerAction>[2],
    );
  };
}
