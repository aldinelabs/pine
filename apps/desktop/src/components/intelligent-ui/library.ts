import type { Library } from "@openuidev/vue-lang";
import {
  createIntelligentUiLibrary,
  type IntelligentUiComponentName,
} from "@/shared/intelligentUi";
import IuiAccordion from "./IuiAccordion.vue";
import IuiAccordionItem from "./IuiAccordionItem.vue";
import IuiBadge from "./IuiBadge.vue";
import IuiBox from "./IuiBox.vue";
import IuiButton from "./IuiButton.vue";
import IuiCallout from "./IuiCallout.vue";
import IuiCaption from "./IuiCaption.vue";
import IuiCard from "./IuiCard.vue";
import IuiCarousel from "./IuiCarousel.vue";
import IuiChart from "./IuiChart.vue";
import IuiCheckbox from "./IuiCheckbox.vue";
import IuiCode from "./IuiCode.vue";
import IuiForm from "./IuiForm.vue";
import IuiGrid from "./IuiGrid.vue";
import IuiHeading from "./IuiHeading.vue";
import IuiIcon from "./IuiIcon.vue";
import IuiImage from "./IuiImage.vue";
import IuiInput from "./IuiInput.vue";
import IuiLabel from "./IuiLabel.vue";
import IuiLink from "./IuiLink.vue";
import IuiList from "./IuiList.vue";
import IuiListItem from "./IuiListItem.vue";
import IuiMarkdown from "./IuiMarkdown.vue";
import IuiMath from "./IuiMath.vue";
import IuiPopover from "./IuiPopover.vue";
import IuiProgress from "./IuiProgress.vue";
import IuiQuote from "./IuiQuote.vue";
import IuiRadioGroup from "./IuiRadioGroup.vue";
import IuiRow from "./IuiRow.vue";
import IuiSegmentedControl from "./IuiSegmentedControl.vue";
import IuiSelect from "./IuiSelect.vue";
import IuiSeparator from "./IuiSeparator.vue";
import IuiSlider from "./IuiSlider.vue";
import IuiSpacer from "./IuiSpacer.vue";
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
  Row: IuiRow,
  Box: IuiBox,
  Spacer: IuiSpacer,
  Grid: IuiGrid,
  Card: IuiCard,
  Tabs: IuiTabs,
  Tab: IuiTab,
  Accordion: IuiAccordion,
  AccordionItem: IuiAccordionItem,
  Carousel: IuiCarousel,
  Popover: IuiPopover,
  Separator: IuiSeparator,
  Heading: IuiHeading,
  Text: IuiText,
  Caption: IuiCaption,
  Label: IuiLabel,
  Markdown: IuiMarkdown,
  List: IuiList,
  ListItem: IuiListItem,
  Link: IuiLink,
  Quote: IuiQuote,
  Code: IuiCode,
  Math: IuiMath,
  Badge: IuiBadge,
  Icon: IuiIcon,
  Image: IuiImage,
  Stat: IuiStat,
  Callout: IuiCallout,
  Button: IuiButton,
  Form: IuiForm,
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
