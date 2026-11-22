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
import { computed, onMounted, ref } from "vue";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useListFold } from "@/composables/useListFold";
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
  type ThirdPartyPackage,
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

type PackageRow =
  | {
      key: string;
      kind: "group";
      license: string;
      count: number;
      open: boolean;
    }
  | { key: string; kind: "package"; entry: ThirdPartyPackage };

/** License groups, each followed by its packages while it is open. */
const packageRows = computed<PackageRow[]>(() =>
  groups.value.flatMap(({ license, packages }) => {
    const open = isSearching.value || openGroups.value.has(license);
    const header: PackageRow = {
      key: `group:${license}`,
      kind: "group",
      license,
      count: packages.length,
      open,
    };
    if (!open) return [header];
    return [
      header,
      ...packages.map((entry): PackageRow => ({
        key: `package:${license}:${entry.name}@${entry.version}`,
        kind: "package",
        entry,
      })),
    ];
  }),
);

/** Groups fold open and closed like the session list; search jumps. */
let foldNext = false;
const { displayRows, setElement } = useListFold(packageRows, {
  canAnimate: () => {
    const animate = foldNext;
    foldNext = false;
    return animate;
  },
  gap: "0.25rem",
});

function toggleGroup(license: string): void {
  if (isSearching.value) return;
  const next = new Set(openGroups.value);
  if (!next.delete(license)) next.add(license);
  foldNext = true;
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

async function checkForUpdates(): Promise<void> {
  updateCheckResult.value = null;
  await updater.openDialog();
  if (updater.isAvailable) return;
  updateCheckResult.value = checkFailed.value ? "failed" : "current";
}
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
          <template v-for="row in displayRows" :key="row.renderKey">
            <Item
              v-if="row.kind === 'group'"
              :ref="(element) => setElement(row.renderKey, element)"
              data-slot="pine-about-license-group"
              as="button"
              type="button"
              size="xs"
              class="group/license hover:bg-muted active:bg-muted"
              :class="row.motion && 'pointer-events-none'"
              :data-state="row.open ? 'open' : 'closed'"
              :aria-expanded="row.open"
              :disabled="isSearching"
              :data-motion="row.motion"
              :inert="row.motion === 'leave' || undefined"
              @click="toggleGroup(row.license)"
            >
              <ItemMedia variant="icon">
                <ChevronRightIcon
                  aria-hidden="true"
                  class="transition-transform group-data-[state=open]/license:rotate-90 motion-reduce:transition-none"
                />
              </ItemMedia>
              <ItemContent class="min-w-0">
                <ItemTitle class="w-full">
                  <span class="truncate">{{ row.license }}</span>
                </ItemTitle>
              </ItemContent>
              <ItemActions class="text-xs text-muted-foreground tabular-nums">
                {{ row.count }}
              </ItemActions>
            </Item>
            <Item
              v-else
              :ref="(element) => setElement(row.renderKey, element)"
              data-slot="pine-about-package-row"
              as="button"
              type="button"
              size="xs"
              class="ml-7 w-auto hover:bg-muted active:bg-muted"
              :class="row.motion && 'pointer-events-none'"
              :data-motion="row.motion"
              :inert="row.motion === 'leave' || undefined"
              @click="openUrl(packageUrl(row.entry))"
            >
              <ItemContent class="min-w-0">
                <ItemTitle class="w-full font-normal">
                  <span class="truncate">{{ row.entry.name }}</span>
                </ItemTitle>
              </ItemContent>
              <ItemActions class="text-xs text-muted-foreground tabular-nums">
                {{ row.entry.version }}
              </ItemActions>
            </Item>
          </template>
        </section>
      </div>
    </FieldSet>
  </div>
</template>
