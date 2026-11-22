<script setup lang="ts">
import {
  BookOpenIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  ExternalLinkIcon,
  MessageSquareWarningIcon,
  NotebookTextIcon,
  RefreshCwIcon,
  ScaleIcon,
  SearchIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { I18nT, useI18n } from "vue-i18n";
import pineAppIcon from "../../../../resources/icon.png";
import aldineOnDark from "@/assets/aldine/aldine-horizontal-on-dark.svg";
import aldineOnLight from "@/assets/aldine/aldine-horizontal-on-light.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import {
  PINE_DOCS_URL,
  PINE_ISSUES_URL,
  PINE_RELEASES_URL,
  PINE_REPOSITORY_URL,
} from "@/shared/window";
import { useUpdaterStore } from "@/stores/updater";
import {
  filterReferencedProjects,
  groupPackagesByLicense,
  loadLicenseCatalog,
  normalizeQuery,
  packageUrl,
  type ThirdPartyLicenseCatalog,
} from "./licenseCatalog";

/**
 * Settings › About: Pine's version, links and license, then the open-source
 * software it ships or adapted, packages grouped by license. Every entry
 * opens in the browser.
 */

const PINE_LICENSE_URL = `${PINE_REPOSITORY_URL}/blob/main/LICENSE`;
const PINE_COPYRIGHT = "© 2026 Aldine Labs";

const { locale, t } = useI18n();
const updater = useUpdaterStore();
const { checkFailed, isChecking } = storeToRefs(updater);
const canCheckForUpdates = typeof window.pine?.checkForUpdate === "function";

const pineVersion = ref<string | null>(null);
const isVersionLoading = ref(true);
const catalog = ref<ThirdPartyLicenseCatalog | null>(null);
const catalogFailed = ref(false);
const query = ref("");
const openGroups = ref(new Set<string>());
const updateCheckResult = ref<"current" | "failed" | null>(null);
/** The result line keeps its place; it only fades, so nothing shifts. */
const isUpdateResultShown = ref(false);
let updateResultTimer: ReturnType<typeof setTimeout> | undefined;
const updateResultLine = ref<HTMLElement | null>(null);
let isUnmounted = false;

const docsUrl = computed(() =>
  locale.value.startsWith("zh") ? PINE_DOCS_URL.zh : PINE_DOCS_URL.en,
);
const links = computed(() => [
  {
    id: "docs",
    icon: BookOpenIcon,
    label: t("preferences.about.docs"),
    url: docsUrl.value,
  },
  {
    id: "source",
    icon: CodeXmlIcon,
    label: t("preferences.about.source"),
    url: PINE_REPOSITORY_URL,
  },
  {
    id: "releases",
    icon: NotebookTextIcon,
    label: t("preferences.about.releaseNotes"),
    url: PINE_RELEASES_URL,
  },
  {
    id: "issues",
    icon: MessageSquareWarningIcon,
    label: t("preferences.about.feedback"),
    url: PINE_ISSUES_URL,
  },
]);

const isSearching = computed(() => normalizeQuery(query.value).length > 0);
const groups = computed(() =>
  catalog.value
    ? groupPackagesByLicense(catalog.value.packages, query.value)
    : [],
);

/**
 * Groups fold like the session list's: one height animation on the group's
 * content, however many packages it holds. Search opens groups at once.
 */
function isGroupOpen(license: string): boolean {
  return isSearching.value || openGroups.value.has(license);
}

function setGroupOpen(license: string, open: boolean): void {
  if (isSearching.value) return;
  const next = new Set(openGroups.value);
  if (open) next.add(license);
  else next.delete(license);
  openGroups.value = next;
}

const referenced = computed(() =>
  catalog.value
    ? filterReferencedProjects(catalog.value.referenced, query.value)
    : [],
);
const hasResults = computed(
  () => groups.value.length > 0 || referenced.value.length > 0,
);

onMounted(() => {
  window.pine
    ?.getAppVersion?.()
    .then((version) => (pineVersion.value = version))
    .catch(() => undefined)
    .finally(() => (isVersionLoading.value = false));
  loadLicenseCatalog()
    .then((loaded) => (catalog.value = loaded))
    .catch(() => (catalogFailed.value = true));
});

function openUrl(url: string): void {
  void window.pine?.openExternalUrl(url);
}

/** How long "Pine is up to date." stays before it fades out. */
const UP_TO_DATE_VISIBLE_MS = 5000;

async function checkForUpdates(): Promise<void> {
  clearTimeout(updateResultTimer);
  isUpdateResultShown.value = false;
  await updater.openDialog();
  if (updater.isAvailable) return;
  if (isUnmounted) return;
  updateCheckResult.value = checkFailed.value ? "failed" : "current";
  // The first result mounts hidden; settle that style before showing it so
  // it fades in rather than appearing at full opacity.
  await nextTick();
  void updateResultLine.value?.offsetWidth;
  if (isUnmounted) return;
  isUpdateResultShown.value = true;
  if (updateCheckResult.value === "current") {
    updateResultTimer = setTimeout(
      () => (isUpdateResultShown.value = false),
      UP_TO_DATE_VISIBLE_MS,
    );
  }
}

onBeforeUnmount(() => {
  isUnmounted = true;
  clearTimeout(updateResultTimer);
});
</script>

<template>
  <div data-testid="pine-about" class="flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <img
        :src="pineAppIcon"
        alt=""
        class="size-16 shrink-0 select-none"
        draggable="false"
      />
      <div class="flex min-w-0 flex-col gap-1">
        <h3 class="text-lg font-semibold leading-tight">Pine</h3>
        <Skeleton v-if="isVersionLoading" class="h-5 w-28" />
        <p
          v-else-if="pineVersion"
          data-testid="pine-about-version"
          class="text-sm text-muted-foreground tabular-nums"
        >
          {{ t("preferences.about.version", { version: pineVersion }) }}
        </p>
        <I18nT
          keypath="preferences.about.by"
          tag="p"
          scope="global"
          data-testid="pine-about-by"
          class="text-sm text-muted-foreground"
        >
          <template #brand>
            <img
              :src="aldineOnLight"
              alt="Aldine Labs"
              class="inline-block h-[1.4em] align-[-0.35em] select-none dark:hidden"
              draggable="false"
            />
            <img
              :src="aldineOnDark"
              alt="Aldine Labs"
              class="hidden h-[1.4em] align-[-0.35em] select-none dark:inline-block"
              draggable="false"
            />
          </template>
        </I18nT>
      </div>
    </div>
    <p class="text-sm">{{ t("preferences.about.tagline") }}</p>

    <div v-if="canCheckForUpdates" class="flex flex-wrap items-center gap-3">
      <Button
        data-testid="pine-about-check-updates"
        variant="outline"
        size="sm"
        :disabled="isChecking"
        @click="checkForUpdates"
      >
        <RefreshCwIcon
          data-icon="inline-start"
          :class="isChecking ? 'animate-spin motion-reduce:animate-none' : ''"
        />
        {{
          isChecking
            ? t("preferences.about.checking")
            : t("preferences.about.checkForUpdates")
        }}
      </Button>
      <span
        v-if="updateCheckResult"
        ref="updateResultLine"
        data-testid="pine-about-update-result"
        :data-visible="isUpdateResultShown || undefined"
        :aria-hidden="!isUpdateResultShown || undefined"
        :class="
          isUpdateResultShown ? 'visible opacity-100' : 'invisible opacity-0'
        "
        class="text-sm text-muted-foreground transition-[opacity,visibility] duration-500 ease-out-expo motion-reduce:transition-none"
        role="status"
      >
        {{
          updateCheckResult === "current"
            ? t("preferences.about.upToDate")
            : t("preferences.about.checkFailed")
        }}
      </span>
    </div>

    <FieldSet>
      <FieldLegend variant="label" class="text-xs text-muted-foreground">
        {{ t("preferences.about.links") }}
      </FieldLegend>
      <ItemGroup class="gap-1">
        <Item
          v-for="link in links"
          :key="link.id"
          :data-testid="`pine-about-link-${link.id}`"
          as="button"
          type="button"
          size="xs"
          class="hover:bg-muted active:bg-muted"
          @click="openUrl(link.url)"
        >
          <ItemMedia variant="icon">
            <component :is="link.icon" aria-hidden="true" />
          </ItemMedia>
          <ItemContent class="min-w-0">
            <ItemTitle>{{ link.label }}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ExternalLinkIcon class="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
      </ItemGroup>
    </FieldSet>

    <FieldSet>
      <FieldLegend variant="label" class="text-xs text-muted-foreground">
        {{ t("preferences.about.license") }}
      </FieldLegend>
      <Item
        data-testid="pine-about-pine-license"
        as="button"
        type="button"
        size="sm"
        variant="muted"
        class="hover:bg-muted active:bg-muted"
        @click="openUrl(PINE_LICENSE_URL)"
      >
        <ItemMedia variant="icon">
          <ScaleIcon aria-hidden="true" />
        </ItemMedia>
        <ItemContent class="min-w-0">
          <ItemTitle>{{ t("preferences.about.pineLicense") }}</ItemTitle>
          <ItemDescription>{{ PINE_COPYRIGHT }}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ExternalLinkIcon class="size-4 text-muted-foreground" />
        </ItemActions>
      </Item>
    </FieldSet>

    <FieldSet>
      <FieldLegend variant="label" class="text-xs text-muted-foreground">
        {{ t("preferences.about.openSource") }}
      </FieldLegend>
      <FieldDescription>
        {{ t("preferences.about.openSourceDescription") }}
      </FieldDescription>

      <div
        v-if="catalogFailed"
        data-testid="pine-about-licenses-failed"
        class="text-sm text-destructive"
      >
        {{ t("preferences.about.loadFailed") }}
      </div>
      <div
        v-else-if="!catalog"
        data-testid="pine-about-licenses-loading"
        class="flex flex-col gap-3"
      >
        <Skeleton class="h-9 w-full rounded-md" />
        <Skeleton v-for="row in 6" :key="row" class="h-8 w-full" />
      </div>
      <div v-else class="flex flex-col gap-4">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            v-model="query"
            data-testid="pine-about-license-search"
            type="search"
            :placeholder="t('preferences.about.search')"
            :aria-label="t('preferences.about.search')"
          />
        </InputGroup>

        <p
          v-if="!hasResults"
          data-testid="pine-about-license-empty"
          class="text-sm text-muted-foreground"
        >
          {{ t("preferences.about.noResults") }}
        </p>

        <section v-if="referenced.length > 0" class="flex flex-col gap-1">
          <h4 class="px-2 text-sm font-medium">
            {{ t("preferences.about.referenced") }}
          </h4>
          <p class="px-2 pb-1 text-xs text-muted-foreground">
            {{ t("preferences.about.referencedDescription") }}
          </p>
          <Item
            v-for="project in referenced"
            :key="project.name"
            data-slot="pine-about-referenced-row"
            as="button"
            type="button"
            size="xs"
            class="hover:bg-muted active:bg-muted"
            @click="openUrl(project.url)"
          >
            <ItemContent class="min-w-0">
              <ItemTitle class="w-full">
                <span class="truncate">{{ project.name }}</span>
              </ItemTitle>
            </ItemContent>
            <ItemActions class="text-xs text-muted-foreground">
              <span class="max-sm:hidden">{{
                t(`preferences.about.kinds.${project.kind}`)
              }}</span>
              <Badge variant="outline">{{ project.license }}</Badge>
            </ItemActions>
          </Item>
        </section>

        <section v-if="groups.length > 0" class="flex flex-col gap-1">
          <h4 class="px-2 pb-1 text-sm font-medium">
            {{
              t("preferences.about.packages", {
                count: catalog.packages.length,
              })
            }}
          </h4>
          <Collapsible
            v-for="group in groups"
            :key="group.license"
            :open="isGroupOpen(group.license)"
            @update:open="(open: boolean) => setGroupOpen(group.license, open)"
          >
            <CollapsibleTrigger as-child>
              <Item
                data-slot="pine-about-license-group"
                as="button"
                type="button"
                size="xs"
                class="group/license hover:bg-muted active:bg-muted"
                :disabled="isSearching"
              >
                <ItemMedia variant="icon">
                  <ChevronRightIcon
                    aria-hidden="true"
                    class="transition-transform duration-500 ease-out-expo group-data-[state=open]/license:rotate-90 motion-reduce:transition-none"
                  />
                </ItemMedia>
                <ItemContent class="min-w-0">
                  <ItemTitle class="w-full">
                    <span class="truncate">{{ group.license }}</span>
                  </ItemTitle>
                </ItemContent>
                <ItemActions class="text-xs text-muted-foreground tabular-nums">
                  {{ group.packages.length }}
                </ItemActions>
              </Item>
            </CollapsibleTrigger>
            <CollapsibleContent
              class="license-group-content overflow-hidden"
              :data-instant="isSearching || undefined"
              :style="{
                animationDuration: `${DURATION_MS}ms`,
                animationTimingFunction: EASE_OUT_EXPO,
              }"
            >
              <div class="flex flex-col gap-0.5 pt-0.5 pl-7">
                <!-- Plain buttons: a group can hold hundreds of packages. -->
                <button
                  v-for="entry in group.packages"
                  :key="`${entry.name}@${entry.version}`"
                  data-slot="pine-about-package-row"
                  type="button"
                  class="license-package-row flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
                  @click="openUrl(packageUrl(entry))"
                >
                  <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                  <span
                    class="shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {{ entry.version }}
                  </span>
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>
    </FieldSet>
  </div>
</template>

<style scoped>
.license-group-content[data-state="open"] {
  animation-name: license-group-expand;
}

.license-group-content[data-state="closed"] {
  animation-name: license-group-collapse;
}

/* Search opens and closes groups at once, as does reduced motion. */
.license-group-content[data-instant] {
  animation-name: none;
}

@media (prefers-reduced-motion: reduce) {
  .license-group-content[data-state] {
    animation-name: none;
  }
}

/* Rows out of view skip layout and paint until they scroll near. */
.license-package-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 2.25rem;
}

@keyframes license-group-expand {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
}

@keyframes license-group-collapse {
  from {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}
</style>
