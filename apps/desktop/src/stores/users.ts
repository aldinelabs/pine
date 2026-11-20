import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  CreatePineUserRequest,
  PineUser,
  PineUsersApi,
  PineUsersState,
  SwitchPineUserResult,
  UpdatePineUserRequest,
} from "@/shared/users";

function api(): PineUsersApi | undefined {
  return window.pine?.users;
}

/** Why a change was refused, from the code the main process puts first. */
export function userErrorCode(
  error: unknown,
): "duplicate-name" | "damaged" | "trash-failed" | "protected" | "generic" {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(duplicate-name|damaged|trash-failed|protected):/.exec(
    message,
  );
  return (
    (match?.[1] as ReturnType<typeof userErrorCode> | undefined) ?? "generic"
  );
}

/** Pine's users, kept in step with every window. Desktop only. */
export const useUsersStore = defineStore("users", () => {
  const state = ref<PineUsersState | null>(null);
  let unsubscribe: (() => void) | null = null;
  let loading: Promise<void> | null = null;

  const isAvailable = computed(() => api() !== undefined);
  const users = computed<PineUser[]>(() => state.value?.users ?? []);
  const currentUser = computed(() =>
    users.value.find((user) => user.id === state.value?.currentUserId),
  );
  /** More than one user: the switcher and the picker exist. */
  const hasSeveralUsers = computed(() => users.value.length > 1);

  function load(): Promise<void> {
    const users = api();
    if (!users) return Promise.resolve();
    unsubscribe ??= users.onChanged((next) => {
      state.value = next;
    });
    loading ??= users
      .get()
      .then((next) => {
        state.value = next;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function apply(
    change: Promise<PineUsersState>,
  ): Promise<PineUsersState> {
    const next = await change;
    state.value = next;
    return next;
  }

  function create(request: CreatePineUserRequest): Promise<PineUsersState> {
    return apply(api()!.create(request));
  }

  function update(request: UpdatePineUserRequest): Promise<PineUsersState> {
    return apply(api()!.update(request));
  }

  function remove(id: string): Promise<PineUsersState> {
    return apply(api()!.remove(id));
  }

  function setAskAtLaunch(ask: boolean): Promise<PineUsersState> {
    return apply(api()!.setAskAtLaunch(ask));
  }

  function switchTo(id: string): Promise<SwitchPineUserResult> {
    return api()!.switchTo(id);
  }

  return {
    state,
    users,
    currentUser,
    hasSeveralUsers,
    isAvailable,
    load,
    create,
    update,
    remove,
    setAskAtLaunch,
    switchTo,
  };
});
