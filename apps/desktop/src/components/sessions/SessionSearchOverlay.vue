<script setup lang="ts">
import { History } from "@lucide/vue";
import { useDebounceFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { projectIconComponent } from "@/lib/projectIcons";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import SessionCommandInput from "./SessionCommandInput.vue";
import SessionSnippet from "./SessionSnippet.vue";

const props = defineProps<{
  open: boolean;
  purpose?: "attach" | "open";
}>();

const emit = defineEmits<{
  select: [session: ProjectSessionSearchResult];
  "update:open": [open: boolean];
}>();

const { locale, t } = useI18n();
const tabNavigation = useContentTabNavigation();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { activeSessionTab } = tabNavigation;
const { isSearching, searchResults } = storeToRefs(sessionStore);
const displayName = useProjectDisplayName();
const openProject = useDraftProjectOpener();
const query = ref("");
const filterRefreshToken = computed(
  () =>
    `${query.value}:${searchResults.value.map((session) => session.id).join(",")}`,
);

const dateFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      month: "short",
      day: "numeric",
    }),
);

const runSearch = useDebounceFn(async () => {
  try {
    await sessionStore.search(query.value);
  } catch (error) {
    handleError(error, {
      id: "sessions.search",
      title: t("errors.sessionSearch.title"),
      description: t("errors.sessionSearch.description"),
    });
  }
}, 120);

watch(
  () => props.open,
  (open) => {
    if (open) void runSearch();
  },
  { immediate: true },
);

watch(query, () => {
  if (props.open) void runSearch();
});

function sessionTitle(session: ProjectSessionSearchResult): string {
  return session.name || session.preview || t("sessions.newSession");
}

function sessionSnippet(
  session: ProjectSessionSearchResult,
): string | undefined {
  const snippet = session.snippet || session.preview;
  return snippet?.replaceAll(/\s+/g, " ").trim();
}

async function selectSession(
  session: ProjectSessionSearchResult,
): Promise<void> {
  emit("select", session);
  emit("update:open", false);
  // Sessions open in their own project, which may not be open yet.
  if (props.purpose !== "attach" && (await openProject(session.projectId)))
    tabNavigation.openSession(session, session.projectId);
}
</script>

<template>
  <CommandDialog
    :open="open"
    :title="
      props.purpose === 'attach'
        ? t('sessions.attachTitle')
        : t('sessions.searchTitle')
    "
    :description="
      props.purpose === 'attach'
        ? t('sessions.attachDescription')
        : t('sessions.searchDescription')
    "
    @update:open="emit('update:open', $event)"
  >
    <SessionCommandInput
      :query="query"
      :placeholder="t('sessions.searchPlaceholder')"
      :refresh-token="filterRefreshToken"
      @update:query="query = $event"
    />

    <CommandList
      class="min-h-72 [&>[role=presentation]]:flex [&>[role=presentation]]:min-h-72 [&>[role=presentation]]:flex-col"
    >
      <CommandEmpty class="flex flex-1 items-center justify-center py-0">
        <span v-if="isSearching" class="inline-flex items-center gap-2">
          <Spinner />
          {{ t("sessions.searching") }}
        </span>
        <template v-else>{{ t("sessions.noResults") }}</template>
      </CommandEmpty>

      <CommandGroup v-if="searchResults.length > 0" :key="filterRefreshToken">
        <CommandItem
          v-for="session in searchResults"
          :key="session.id"
          :value="session.id"
          class="data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[highlighted]:*:[svg]:text-foreground"
          @select="selectSession(session)"
        >
          <History aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <span class="sr-only">{{ query }}&#8203;</span>
            <span class="block truncate">
              <SessionSnippet :query="query" :text="sessionTitle(session)" />
            </span>
            <p
              v-if="query && sessionSnippet(session)"
              class="mt-0.5 truncate text-xs font-normal text-muted-foreground"
            >
              <SessionSnippet
                :leading-context="12"
                :query="query"
                :text="sessionSnippet(session) ?? ''"
              />
            </p>
          </div>
          <span
            v-if="projectStore.projectById(session.projectId)"
            data-testid="session-search-project"
            class="flex max-w-36 shrink-0 items-center gap-1 text-xs text-muted-foreground"
          >
            <component
              :is="
                projectIconComponent(
                  projectStore.projectById(session.projectId),
                )
              "
              aria-hidden="true"
              class="size-3.5"
            />
            <span class="truncate">{{
              displayName(projectStore.projectById(session.projectId))
            }}</span>
          </span>
          <CommandShortcut class="tracking-normal">
            {{
              activeSessionTab?.state === "bound" &&
              session.id === activeSessionTab.sessionId
                ? t("sessions.current")
                : dateFormatter.format(new Date(session.updatedAt))
            }}
          </CommandShortcut>
        </CommandItem>
      </CommandGroup>

      <div
        v-if="!query && searchResults.length === 0"
        class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        <span v-if="isSearching" class="inline-flex items-center gap-2">
          <Spinner />
          {{ t("sessions.searching") }}
        </span>
        <template v-else>{{ t("sessions.noSessions") }}</template>
      </div>
    </CommandList>
  </CommandDialog>
</template>
