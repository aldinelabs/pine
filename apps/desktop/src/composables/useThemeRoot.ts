import { getCurrentInstance } from "vue";

/**
 * The element a component resolves its theme colors from. Tokens differ by
 * place, such as the workbench card's surface, so drawings that bake colors
 * in read them where they show rather than from the document body.
 */
export function useThemeRoot(): () => Element {
  const instance = getCurrentInstance();
  return () => {
    const element: unknown = instance?.proxy?.$el;
    return element instanceof Element ? element : document.body;
  };
}
