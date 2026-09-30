<script setup lang="ts">
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  CheckIcon,
  HeartIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UnplugIcon,
  WrenchIcon,
} from "@lucide/vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { injectListboxRootContext, ListboxContent, ListboxItem } from "reka-ui";
import type { Component, HTMLAttributes } from "vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandSeparator, useCommand } from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  PineDecisionsModelDescriptor,
  PineImageModelDescriptor,
  PineModelDescriptor,
  PineProviderDescriptor,
} from "@/shared/models";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { pineModelKey, useModelsStore } from "@/stores/models";
import ModelCapabilities from "./ModelCapabilities.vue";
import ProviderIcon from "./ProviderIcon.vue";

type PickerView = "models" | "providers";
type PickerAction = "manage" | "back" | "add-custom-model";

interface PickerRowBase {
  /** Stable identity for the row inside the virtualized list. */
  id: string;
  /** Row height in pixels; the virtualizer positions rows from this value. */
  height: number;
  /** Text the search matches against, mirroring the rendered row text. */
  text: string;
}

type PickerRow =
  | (PickerRowBase & {
      kind: "action";
      action: PickerAction;
      icon: Component;
      label: string;
      value: string;
    })
  | (PickerRowBase & { kind: "heading"; heading: string })
  | (PickerRowBase & { kind: "separator" })
  | (PickerRowBase & {
      kind: "model";
      model: PineModelDescriptor;
      groupId: string;
    })
  | (PickerRowBase & { kind: "image"; model: PineImageModelDescriptor })
  | (PickerRowBase & { kind: "decisions"; model: PineDecisionsModelDescriptor })
  | (PickerRowBase & { kind: "provider"; provider: PineProviderDescriptor });

const ROW_HEIGHT = {
  action: 32,
  heading: 28,
  model: 50,
  provider: 50,
  separator: 9,
} as const;

/**
 * Rows render through reka's ListboxItem instead of the generated CommandItem:
 * CommandItem keeps per-instance filter scores and memoizes its wrapper props,
 * both of which break inside a windowed list. The style string mirrors
 * `components/ui/command/CommandItem.vue`; `h-full` fills the windowed row.
 */
const ROW_CLASS =
  "relative flex h-full w-full cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-2xl [&_svg:not([class*=size-])]:size-4 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:*:[svg]:text-foreground";

const props = withDefaults(
  defineProps<{
    favoriteKeys: readonly string[];
    purpose?: "session" | "utility" | "image" | "decisions";
    sessionId?: string;
    view: PickerView;
    class?: HTMLAttributes["class"];
  }>(),
  { purpose: "session" },
);

const emit = defineEmits<{
  addCustomModel: [];
  deleteCustomModel: [model: PineModelDescriptor];
  deleteCustomProvider: [provider: PineProviderDescriptor];
  disconnectProvider: [provider: PineProviderDescriptor];
  editCustomModel: [model: PineModelDescriptor];
  editCustomProvider: [provider: PineProviderDescriptor];
  selectDecisionsModel: [model: PineDecisionsModelDescriptor];
  selectImageModel: [model: PineImageModelDescriptor];
  selectModel: [model: PineModelDescriptor];
  selectProvider: [provider: PineProviderDescriptor];
  selectView: [view: PickerView];
}>();

const { t } = useI18n();
const modelsStore = useModelsStore();
const autoApprovalStore = useAutoApprovalStore();
const { filterState } = useCommand();
const listbox = injectListboxRootContext();
const contentRef = ref<{ $el?: HTMLElement } | null>(null);
const scrollElement = ref<HTMLElement | null>(null);

const isDecisionsPurpose = computed(() => props.purpose === "decisions");
const isImagePurpose = computed(() => props.purpose === "image");
const sessionSelection = computed(() =>
  modelsStore.selectionFor(props.sessionId),
);

const providerModelGroups = computed(() =>
  modelsStore.providers
    .filter((provider) => provider.configured)
    .map((provider) => ({
      heading: provider.name,
      id: `provider:${provider.id}`,
      models: modelsStore.models.filter(
        (model) => model.providerId === provider.id,
      ),
    }))
    .filter((group) => group.models.length > 0),
);

const availableModels = computed(() =>
  providerModelGroups.value.flatMap((group) => group.models),
);

const modelGroups = computed(() =>
  [
    {
      heading: t("models.favorites"),
      id: "favorites",
      models: availableModels.value.filter((model) =>
        props.favoriteKeys.includes(pineModelKey(model)),
      ),
    },
    {
      heading: t("models.recommended"),
      id: "recommended",
      models: availableModels.value.filter((model) =>
        modelsStore.isRecommended(model),
      ),
    },
    ...providerModelGroups.value,
  ].filter((group) => group.models.length > 0),
);

/**
 * Image models are a separate pi-ai catalog served by OpenRouter only, so the
 * image purpose skips favorites, capabilities, and custom-model management.
 */
const imageModelGroups = computed(() =>
  modelsStore.imageModels.length > 0
    ? [
        {
          heading: modelsStore.imageModels[0]?.providerName ?? "",
          id: "image-models",
          models: modelsStore.imageModels,
        },
      ]
    : [],
);

function rowId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function modelRowText(model: { id: string; name: string }): string {
  // Mirrors the rendered row text ("name" then "id" with nothing between).
  return `${model.name}${model.id}`;
}

function providerRowText(provider: PineProviderDescriptor): string {
  return `${provider.name}${provider.id}`;
}

const rows = computed<PickerRow[]>(() => {
  const needle = filterState.search.normalize("NFC").toLowerCase();
  const includes = (text: string): boolean =>
    needle.length === 0 || text.normalize("NFC").toLowerCase().includes(needle);
  const result: PickerRow[] = [];

  if (props.view === "providers") {
    const actionRows: PickerRow[] = [
      {
        action: "back",
        height: ROW_HEIGHT.action,
        icon: ArrowLeftIcon,
        id: rowId("action", "back"),
        kind: "action",
        label: t("models.picker.backToModels"),
        text: t("models.picker.backToModels"),
        value: "back models",
      },
      {
        action: "add-custom-model",
        height: ROW_HEIGHT.action,
        icon: PlusIcon,
        id: rowId("action", "add-custom-model"),
        kind: "action",
        label: t("models.picker.addCustomModel"),
        text: t("models.picker.addCustomModel"),
        value: "add custom model provider endpoint",
      },
    ];
    const actions = actionRows.filter((row) => includes(row.text));

    if (actions.length > 0) {
      result.push(...actions, {
        height: ROW_HEIGHT.separator,
        id: rowId("separator", "providers"),
        kind: "separator",
        text: "",
      });
    }

    const providers = modelsStore.providers.filter((provider) =>
      includes(providerRowText(provider)),
    );
    if (providers.length > 0) {
      result.push(
        {
          heading: t("providers.picker.all"),
          height: ROW_HEIGHT.heading,
          id: rowId("heading", "providers"),
          kind: "heading",
          text: t("providers.picker.all"),
        },
        ...providers.map((provider): PickerRow => ({
          height: ROW_HEIGHT.provider,
          id: rowId("provider", provider.id),
          kind: "provider",
          provider,
          text: providerRowText(provider),
        })),
      );
    }

    return result;
  }

  if (includes(t("models.picker.manageServiceOrModel"))) {
    result.push({
      action: "manage",
      height: ROW_HEIGHT.action,
      icon: WrenchIcon,
      id: rowId("action", "manage"),
      kind: "action",
      label: t("models.picker.manageServiceOrModel"),
      text: t("models.picker.manageServiceOrModel"),
      value: "manage configure provider service model",
    });
    result.push({
      height: ROW_HEIGHT.separator,
      id: rowId("separator", "models"),
      kind: "separator",
      text: "",
    });
  }

  if (isDecisionsPurpose.value) {
    const visible = modelsStore.decisionsModels.filter((model) =>
      includes(modelRowText(model)),
    );
    if (visible.length > 0) {
      result.push({
        kind: "heading",
        heading: "OpenRouter",
        height: ROW_HEIGHT.heading,
        id: rowId("heading", "decisions-models"),
        text: "OpenRouter",
      });
      result.push(
        ...visible.map((model): PickerRow => ({
          kind: "decisions",
          model,
          height: ROW_HEIGHT.model,
          id: rowId("decisions", model.id),
          text: modelRowText(model),
        })),
      );
    }
    return result;
  }

  if (isImagePurpose.value) {
    for (const group of imageModelGroups.value) {
      const visible = group.models.filter((model) =>
        includes(modelRowText(model)),
      );
      if (visible.length === 0) continue;

      result.push({
        heading: group.heading,
        height: ROW_HEIGHT.heading,
        id: rowId("heading", group.id),
        kind: "heading",
        text: group.heading,
      });
      result.push(
        ...visible.map((model): PickerRow => ({
          height: ROW_HEIGHT.model,
          id: rowId("image", `${group.id}:${model.providerId}:${model.id}`),
          kind: "image",
          model,
          text: modelRowText(model),
        })),
      );
    }

    return result;
  }

  for (const group of modelGroups.value) {
    const visible = group.models.filter((model) =>
      includes(modelRowText(model)),
    );
    if (visible.length === 0) continue;

    result.push({
      heading: group.heading,
      height: ROW_HEIGHT.heading,
      id: rowId("heading", group.id),
      kind: "heading",
      text: group.heading,
    });
    result.push(
      ...visible.map((model): PickerRow => ({
        groupId: group.id,
        height: ROW_HEIGHT.model,
        // The same model can appear in both the favorites and the recommended
        // group, so the row identity has to include its group.
        id: rowId("model", `${group.id}:${model.providerId}:${model.id}`),
        kind: "model",
        model,
        text: modelRowText(model),
      })),
    );
  }

  return result;
});

const isEmpty = computed(
  () =>
    !rows.value.some(
      (row) =>
        row.kind === "model" ||
        row.kind === "image" ||
        row.kind === "decisions" ||
        row.kind === "provider",
    ),
);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    estimateSize: (index: number) =>
      rows.value[index]?.height ?? ROW_HEIGHT.model,
    getItemKey: (index: number) => rows.value[index]?.id ?? index,
    getScrollElement: () => scrollElement.value,
    overscan: 8,
  })),
);

/** Rows inside the viewport, paired with their reserved window slot. */
const visibleRows = computed(() =>
  virtualizer.value.getVirtualItems().flatMap((item) => {
    const row = rows.value[item.index];
    return row ? [{ ...item, row }] : [];
  }),
);

function attachScrollElement(): void {
  scrollElement.value = contentRef.value?.$el ?? null;
}

watch(contentRef, attachScrollElement, { flush: "post" });

// Rows are re-laid out from scratch on every keystroke, so keep the viewport at
// the top instead of leaving the reader in the middle of a shorter list.
watch(
  () => filterState.search,
  () => {
    if (scrollElement.value) scrollElement.value.scrollTop = 0;
  },
);

const typeahead = ref("");
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

function highlightRowAt(index: number): void {
  if (!rows.value[index]) return;
  virtualizer.value.scrollToIndex(index, { align: "auto" });
  requestAnimationFrame(() => {
    const element = scrollElement.value?.querySelector<HTMLElement>(
      `[data-row-index="${index}"] [data-reka-collection-item]`,
    );
    if (element) listbox.changeHighlight(element);
  });
}

/**
 * The listbox only mounts the visible window, so Home/End and typeahead are
 * resolved against the full row list instead of the mounted items.
 */
function handleListKeydown(event: KeyboardEvent): void {
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    highlightRowAt(event.key === "Home" ? 0 : rows.value.length - 1);
    return;
  }
  if (
    event.key.length !== 1 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }
  typeahead.value += event.key.toLowerCase();
  clearTimeout(typeaheadTimer);
  typeaheadTimer = setTimeout(() => {
    typeahead.value = "";
  }, 500);
  const index = rows.value.findIndex((row) =>
    row.text.toLowerCase().includes(typeahead.value),
  );
  if (index >= 0) highlightRowAt(index);
}

onUnmounted(() => {
  clearTimeout(typeaheadTimer);
});

function isSelected(model: PineModelDescriptor): boolean {
  const selected =
    props.purpose === "utility"
      ? modelsStore.utilitySelection
      : sessionSelection.value;
  return (
    selected?.providerId === model.providerId && selected.modelId === model.id
  );
}

function isImageModelSelected(model: PineImageModelDescriptor): boolean {
  const selected = modelsStore.imageSelection;
  return (
    selected?.providerId === model.providerId && selected.modelId === model.id
  );
}

function canConfigure(provider: PineProviderDescriptor): boolean {
  return provider.authMethods.length > 0;
}

function runAction(row: PickerRow & { kind: "action" }): void {
  if (row.action === "manage") emit("selectView", "providers");
  else if (row.action === "back") emit("selectView", "models");
  else emit("addCustomModel");
}

/**
 * Picking a row resets the query, matching the generated CommandItem behavior,
 * so the next open starts from the full list.
 */
function withSearchReset(action: () => void): void {
  filterState.search = "";
  action();
}
</script>

<template>
  <ListboxContent
    ref="contentRef"
    data-slot="command-list"
    :class="
      cn(
        'no-scrollbar h-[50vh] min-h-72 max-h-[50vh] scroll-py-1 overflow-x-hidden overflow-y-auto p-1 outline-none',
        props.class,
      )
    "
    @keydown="handleListKeydown"
  >
    <div
      :style="{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }"
    >
      <div
        v-for="{ index, key, row, size, start } in visibleRows"
        :key="String(key)"
        :data-row-index="index"
        :style="{
          height: `${size}px`,
          left: '0px',
          overflowAnchor: 'none',
          position: 'absolute',
          top: '0px',
          transform: `translateY(${start}px)`,
          width: '100%',
        }"
      >
        <div
          v-if="row.kind === 'heading'"
          class="flex h-full w-full items-center px-2 text-xs font-medium text-muted-foreground"
        >
          {{ row.heading }}
        </div>

        <CommandSeparator
          v-else-if="row.kind === 'separator'"
          class="my-1 w-full"
        />

        <ListboxItem
          v-else-if="row.kind === 'action'"
          :class="ROW_CLASS"
          data-picker-row="action"
          :data-value="row.value"
          :value="row.value"
          @select="withSearchReset(() => runAction(row))"
        >
          <component :is="row.icon" aria-hidden="true" />
          {{ row.label }}
        </ListboxItem>

        <ListboxItem
          v-else-if="row.kind === 'image'"
          :class="ROW_CLASS"
          data-picker-row="image"
          :data-value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          :value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          @select="withSearchReset(() => emit('selectImageModel', row.model))"
        >
          <CheckIcon
            v-if="isImageModelSelected(row.model)"
            aria-hidden="true"
          />
          <ImageIcon v-else aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate">{{ row.model.name }}</span>
            <span class="truncate text-xs font-normal text-muted-foreground">
              {{ row.model.id }}
            </span>
          </span>
        </ListboxItem>

        <ListboxItem
          v-else-if="row.kind === 'decisions'"
          :class="ROW_CLASS"
          data-picker-row="decisions"
          :data-value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          :value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          @select="
            withSearchReset(() => emit('selectDecisionsModel', row.model))
          "
        >
          <CheckIcon
            v-if="autoApprovalStore.settings.decisionsModel === row.model.id"
            aria-hidden="true"
          />
          <ShieldCheckIcon v-else aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate">{{ row.model.name }}</span>
            <span class="truncate text-xs font-normal text-muted-foreground">{{
              row.model.id
            }}</span>
          </span>
        </ListboxItem>

        <ListboxItem
          v-else-if="row.kind === 'provider'"
          :class="ROW_CLASS"
          data-picker-row="provider"
          :data-value="`${row.provider.name} ${row.provider.id}`"
          :disabled="
            !row.provider.isCustom &&
            !row.provider.configured &&
            !canConfigure(row.provider)
          "
          :value="`${row.provider.name} ${row.provider.id}`"
          @select="withSearchReset(() => emit('selectProvider', row.provider))"
        >
          <ProviderIcon
            :provider-id="row.provider.id"
            :provider-name="row.provider.name"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate">{{ row.provider.name }}</span>
            <span class="truncate text-xs font-normal text-muted-foreground">
              {{ row.provider.id }} ·
              {{
                t("providers.modelCount", {
                  count: row.provider.modelCount,
                })
              }}
            </span>
          </span>
          <span
            data-slot="provider-actions"
            class="ml-auto flex shrink-0 items-center gap-1"
          >
            <Badge v-if="row.provider.configured" variant="secondary">
              {{ t("providers.connected") }}
            </Badge>
            <template v-if="row.provider.isCustom">
              <Badge variant="outline">
                {{ t("providers.custom.label") }}
              </Badge>
              <Button
                type="button"
                data-testid="custom-provider-edit"
                variant="ghost"
                size="icon-sm"
                :aria-label="t('providers.custom.edit')"
                :title="t('providers.custom.edit')"
                @pointerdown.stop
                @click.stop="emit('editCustomProvider', row.provider)"
              >
                <PencilIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                data-testid="custom-provider-delete"
                variant="ghost"
                size="icon-sm"
                :aria-label="t('providers.custom.delete')"
                :title="t('providers.custom.delete')"
                @pointerdown.stop
                @click.stop="emit('deleteCustomProvider', row.provider)"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </template>
            <Button
              v-if="row.provider.configured && !row.provider.isCustom"
              type="button"
              data-testid="provider-disconnect"
              variant="ghost"
              size="icon-sm"
              :aria-label="
                t('providers.disconnect', {
                  provider: row.provider.name,
                })
              "
              :title="
                t('providers.disconnect', {
                  provider: row.provider.name,
                })
              "
              @pointerdown.stop
              @click.stop="emit('disconnectProvider', row.provider)"
            >
              <UnplugIcon aria-hidden="true" />
            </Button>
          </span>
        </ListboxItem>

        <ListboxItem
          v-else
          :class="ROW_CLASS"
          data-picker-row="model"
          :data-value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          :value="`${row.model.providerName} ${row.model.name} ${row.model.id}`"
          @select="withSearchReset(() => emit('selectModel', row.model))"
        >
          <CheckIcon v-if="isSelected(row.model)" aria-hidden="true" />
          <ProviderIcon
            v-else
            :provider-id="row.model.providerId"
            :provider-name="row.model.providerName"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate">{{ row.model.name }}</span>
            <span class="truncate text-xs font-normal text-muted-foreground">
              {{ row.model.id }}
            </span>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-1">
            <ModelCapabilities
              :model="row.model"
              :recommended="
                purpose === 'session' && modelsStore.isRecommended(row.model)
              "
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :aria-label="
                modelsStore.isFavorite(row.model)
                  ? t('models.picker.removeFavorite', {
                      model: row.model.name,
                    })
                  : t('models.picker.addFavorite', {
                      model: row.model.name,
                    })
              "
              :aria-pressed="modelsStore.isFavorite(row.model)"
              @pointerdown.stop
              @click.stop="modelsStore.toggleFavorite(row.model)"
            >
              <HeartIcon
                aria-hidden="true"
                :class="
                  cn({
                    'fill-current': modelsStore.isFavorite(row.model),
                  })
                "
              />
            </Button>
            <template
              v-if="row.model.isCustom && row.groupId.startsWith('provider:')"
            >
              <Button
                type="button"
                data-testid="custom-model-edit"
                variant="ghost"
                size="icon-xs"
                :aria-label="t('models.picker.editCustomModel')"
                :title="t('models.picker.editCustomModel')"
                @pointerdown.stop
                @click.stop="emit('editCustomModel', row.model)"
              >
                <PencilIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                data-testid="custom-model-delete"
                variant="ghost"
                size="icon-xs"
                :aria-label="t('models.picker.deleteCustomModel')"
                :title="t('models.picker.deleteCustomModel')"
                @pointerdown.stop
                @click.stop="emit('deleteCustomModel', row.model)"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </template>
          </span>
        </ListboxItem>
      </div>
    </div>

    <div
      v-if="isEmpty"
      data-slot="command-empty"
      class="py-6 text-center text-sm"
    >
      <span v-if="modelsStore.isLoading" class="inline-flex items-center gap-2">
        <Spinner />
        {{ t("models.loading") }}
      </span>
      <template v-else>
        {{
          view === "providers"
            ? t("providers.picker.empty")
            : isDecisionsPurpose
              ? t("models.picker.decisionsEmpty")
              : isImagePurpose
                ? t("models.picker.imageEmpty")
                : t("models.picker.empty")
        }}
      </template>
    </div>
  </ListboxContent>
</template>
