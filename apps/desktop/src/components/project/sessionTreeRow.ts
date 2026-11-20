/**
 * Classes for a row button of the sidebar session tree. The highlight reaches
 * back over the 24px indent to where the row above it starts, so the status
 * column under the parent's icon sits inside it; the start padding grows by
 * the same 24px, keeping the text where the indent puts it.
 */
export const SESSION_TREE_ROW_CLASS =
  "-ms-6 w-[calc(100%+1.5rem)] translate-x-0 ps-9";
