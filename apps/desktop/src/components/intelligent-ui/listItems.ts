import type { ElementNode } from "@openuidev/lang-core";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

export type ListEntry = Omit<IntelligentUiProps<"ListItem">, "title"> & {
  title: string;
};

/** List items as entries: a string is a title alone; other values drop. */
export function listEntries(items: unknown): ListEntry[] {
  if (!Array.isArray(items)) return [];
  return items.flat().flatMap((item: unknown): ListEntry[] => {
    if (typeof item === "string" || typeof item === "number")
      return [{ title: String(item) }];
    const element = item as ElementNode | null;
    if (element?.type !== "element" || element.typeName !== "ListItem")
      return [];
    const props = element.props as Partial<IntelligentUiProps<"ListItem">>;
    return [
      {
        title: String(props.title ?? ""),
        description: props.description,
        marker: props.marker,
        children: props.children,
      },
    ];
  });
}
