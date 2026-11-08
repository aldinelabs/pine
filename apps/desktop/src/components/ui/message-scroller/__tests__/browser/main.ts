import { createApp } from "vue";
import { createPinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import "./styles.css";
import TranscriptScrollScenario from "./TranscriptScrollScenario.vue";

createApp(TranscriptScrollScenario)
  .use(createPinia())
  .use(createAppI18n("en-US"))
  .mount("#app");
