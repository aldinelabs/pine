<script setup lang="ts">
import {
  BookOpenIcon,
  ChevronLeftIcon,
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
import { computed, nextTick, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import pineAppIcon from "../../../../resources/icon.png";
import { useDialogPages } from "@/composables/useDialogPages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Skeleton } from "@/components/ui/skeleton";
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
  type ThirdPartyLicenseCatalog,
} from "./licenseCatalog";

/**
 * Settings › About: Pine's version, links and license, then the open-source
 * software it ships or adapted. Selecting an entry shows its license text
 * as a second page inside the section.
 */

const PINE_LICENSE = "AGPL-3.0-or-later";
const PINE_COPYRIGHT = "© 2026 Aldine Labs";

interface LicenseDetail {
  name: string;
  version?: string;
  license: string;
  homepage?: string;
  text: string | null;
}

const { locale, t } = useI18n();
const showPage = useDialogPages();
const updater = useUpdaterStore();
const { checkFailed, isChecking } = storeToRefs(updater);
const canCheckForUpdates = typeof window.pine?.checkForUpdate === "function";

const root = useTemplateRef<HTMLElement>("root");
const pineVersion = ref<string | null>(null);
const isVersionLoading = ref(true);
const catalog = ref<ThirdPartyLicenseCatalog | null>(null);
const catalogFailed = ref(false);
const query = ref("");
const openGroups = ref(new Set<string>());
const detail = ref<LicenseDetail | null>(null);
const updateCheckResult = ref<"current" | "failed" | null>(null);
let listScrollTop = 0;

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

async function checkForUpdates(): Promise<void> {
  updateCheckResult.value = null;
  await updater.openDialog();
  if (updater.isAvailable) return;
  updateCheckResult.value = checkFailed.value ? "failed" : "current";
}

function isGroupOpen(license: string): boolean {
  return isSearching.value || openGroups.value.has(license);
}

function setGroupOpen(license: string, open: boolean): void {
  const next = new Set(openGroups.value);
  if (open) next.add(license);
  else next.delete(license);
  openGroups.value = next;
}

function textAt(index: number | null): string | null {
  return index === null ? null : (catalog.value?.texts[index] ?? null);
}

function scrollViewport(): HTMLElement | null {
  return (
    root.value?.closest<HTMLElement>("[data-slot=scroll-area-viewport]") ?? null
  );
}

function openDetail(next: LicenseDetail): void {
  listScrollTop = scrollViewport()?.scrollTop ?? 0;
  showPage("forward", () => (detail.value = next));
  void nextTick(() => {
    const viewport = scrollViewport();
    if (viewport) viewport.scrollTop = 0;
  });
}

async function openPineLicense(): Promise<void> {
  // Pine's own license text loads only when asked for.
  const { default: text } = await import("../../../../../../LICENSE?raw");
  openDetail({
    name: "Pine",
    version: pineVersion.value ?? undefined,
    license: PINE_LICENSE,
    homepage: PINE_REPOSITORY_URL,
    text,
  });
}

function closeDetail(): void {
  showPage("back", () => (detail.value = null));
  void nextTick(() => {
    const viewport = scrollViewport();
    if (viewport) viewport.scrollTop = listScrollTop;
  });
}
</script>

<template>
  <div ref="root" data-testid="pine-about" class="flex flex-col gap-6">
    <template v-if="detail">
      <div class="flex flex-col gap-4" data-testid="pine-about-license-detail">
        <Button
          data-testid="pine-about-license-back"
          variant="ghost"
          size="sm"
          class="-ml-2 self-start"
          @click="closeDetail"
        >
          <ChevronLeftIcon data-icon="inline-start" />
          {{ t("preferences.sections.about") }}
        </Button>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 class="text-base font-semibold break-all">{{ detail.name }}</h3>
          <span
            v-if="detail.version"
            class="text-sm text-muted-foreground tabular-nums"
            >{{ detail.version }}</span
          >
          <Badge variant="outline">{{ detail.license }}</Badge>
          <Button
            v-if="detail.homepage"
            variant="link"
            size="sm"
            class="h-auto px-0"
            @click="openUrl(detail.homepage)"
          >
            {{ t("preferences.about.homepage") }}
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </div>
        <pre
          v-if="detail.text"
          data-testid="pine-about-license-text"
          class="rounded-lg bg-muted/50 p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-text"
          >{{ detail.text }}</pre>
        <FieldDescription v-else>
          {{
            t("preferences.about.noLicenseText", { license: detail.license })
          }}
        </FieldDescription>
      </div>
    </template>

    <template v-else>
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
          <p class="text-sm text-muted-foreground">
            {{ t("preferences.about.by", { brand: "Aldine Labs" }) }}
          </p>
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
          data-testid="pine-about-update-result"
          class="text-sm text-muted-foreground"
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
          @click="openPineLicense"
        >
          <ItemMedia variant="icon">
            <ScaleIcon aria-hidden="true" />
          </ItemMedia>
          <ItemContent class="min-w-0">
            <ItemTitle>{{ t("preferences.about.pineLicense") }}</ItemTitle>
            <ItemDescription>{{ PINE_COPYRIGHT }}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon class="size-4 text-muted-foreground" />
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
              @click="
                openDetail({
                  name: project.name,
                  license: project.license,
                  homepage: project.url,
                  text: textAt(project.text),
                })
              "
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
              @update:open="
                (open: boolean) => setGroupOpen(group.license, open)
              "
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
                      class="transition-transform group-data-[state=open]/license:rotate-90 motion-reduce:transition-none"
                    />
                  </ItemMedia>
                  <ItemContent class="min-w-0">
                    <ItemTitle class="w-full">
                      <span class="truncate">{{ group.license }}</span>
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions
                    class="text-xs text-muted-foreground tabular-nums"
                  >
                    {{ group.packages.length }}
                  </ItemActions>
                </Item>
              </CollapsibleTrigger>
              <CollapsibleContent class="flex flex-col gap-0.5 pl-7">
                <Item
                  v-for="entry in group.packages"
                  :key="`${entry.name}@${entry.version}`"
                  data-slot="pine-about-package-row"
                  as="button"
                  type="button"
                  size="xs"
                  class="hover:bg-muted active:bg-muted"
                  @click="
                    openDetail({
                      name: entry.name,
                      version: entry.version,
                      license: entry.license,
                      homepage: entry.homepage,
                      text: textAt(entry.text),
                    })
                  "
                >
                  <ItemContent class="min-w-0">
                    <ItemTitle class="w-full font-normal">
                      <span class="truncate">{{ entry.name }}</span>
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions
                    class="text-xs text-muted-foreground tabular-nums"
                  >
                    {{ entry.version }}
                  </ItemActions>
                </Item>
              </CollapsibleContent>
            </Collapsible>
          </section>
        </div>
      </FieldSet>
    </template>
  </div>
</template>
