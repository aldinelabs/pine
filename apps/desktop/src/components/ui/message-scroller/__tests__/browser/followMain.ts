/** Entry of the thinking follow page (scripts/verify-thinking-follow.mjs). */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import "./styles.css";
import ThinkingFollowScenario from "./ThinkingFollowScenario.vue";

createApp(ThinkingFollowScenario)
  .use(createPinia())
  .use(createAppI18n("en-US"))
  .mount("#app");
