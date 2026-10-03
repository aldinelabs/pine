import {
  computed,
  inject,
  provide,
  toValue,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
} from "vue";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";

const SCOPED_PROJECT_ID_KEY: InjectionKey<ComputedRef<string>> =
  Symbol("scoped-project-id");

/**
 * Pin a subtree to one project. Sidebars stay mounted per project so that
 * switching tabs keeps their state; each instance must keep showing its own
 * project rather than whichever project became active.
 */
export function provideScopedProject(projectId: MaybeRefOrGetter<string>) {
  provide(
    SCOPED_PROJECT_ID_KEY,
    computed(() => toValue(projectId)),
  );
}

/** The project of the enclosing scope, or the window's active project. */
export function useScopedProject(): ComputedRef<PineProject | null> {
  const projectStore = useProjectStore();
  const scopedId = inject(SCOPED_PROJECT_ID_KEY, null);
  return computed(() =>
    scopedId
      ? projectStore.projectById(scopedId.value)
      : projectStore.activeProject,
  );
}
