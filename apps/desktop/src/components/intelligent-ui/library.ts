import type { Library } from "@openuidev/vue-lang";
import {
  createIntelligentUiLibrary,
  type IntelligentUiComponentName,
} from "@/shared/intelligentUi";
import IuiBadge from "./IuiBadge.vue";
import IuiButton from "./IuiButton.vue";
import IuiCallout from "./IuiCallout.vue";
import IuiCard from "./IuiCard.vue";
import IuiChart from "./IuiChart.vue";
import IuiCheckbox from "./IuiCheckbox.vue";
import IuiGrid from "./IuiGrid.vue";
import IuiHeading from "./IuiHeading.vue";
import IuiInput from "./IuiInput.vue";
import IuiList from "./IuiList.vue";
import IuiMarkdown from "./IuiMarkdown.vue";
import IuiProgress from "./IuiProgress.vue";
import IuiRadioGroup from "./IuiRadioGroup.vue";
import IuiSegmentedControl from "./IuiSegmentedControl.vue";
import IuiSelect from "./IuiSelect.vue";
import IuiSeparator from "./IuiSeparator.vue";
import IuiSlider from "./IuiSlider.vue";
import IuiStack from "./IuiStack.vue";
import IuiStat from "./IuiStat.vue";
import IuiSwitch from "./IuiSwitch.vue";
import IuiTab from "./IuiTab.vue";
import IuiTable from "./IuiTable.vue";
import IuiTabs from "./IuiTabs.vue";
import IuiText from "./IuiText.vue";
import IuiTextarea from "./IuiTextarea.vue";

const renderers: Record<IntelligentUiComponentName, unknown> = {
  Stack: IuiStack,
  Grid: IuiGrid,
  Card: IuiCard,
  Tabs: IuiTabs,
  Tab: IuiTab,
  Separator: IuiSeparator,
  Heading: IuiHeading,
  Text: IuiText,
  Markdown: IuiMarkdown,
  List: IuiList,
  Badge: IuiBadge,
  Stat: IuiStat,
  Callout: IuiCallout,
  Button: IuiButton,
  Input: IuiInput,
  Textarea: IuiTextarea,
  Select: IuiSelect,
  Slider: IuiSlider,
  Switch: IuiSwitch,
  Checkbox: IuiCheckbox,
  RadioGroup: IuiRadioGroup,
  SegmentedControl: IuiSegmentedControl,
  Table: IuiTable,
  Progress: IuiProgress,
  Chart: IuiChart,
};

type Renderer = Library["components"][string]["component"];

/** Pine's Intelligent UI library: shared schemas with native renderers. */
export const intelligentUiLibrary: Library = createIntelligentUiLibrary(
  renderers as Record<IntelligentUiComponentName, Renderer>,
);
