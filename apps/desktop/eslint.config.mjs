import prettierConfig from "@vue/eslint-config-prettier";
import { withVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

export default withVueTs(
  { rootDir: import.meta.dirname },
  {
    ignores: [
      ".vite/**",
      "coverage/**",
      "dist/**",
      "out/**",
      "src/components/ui/**",
      "src/styles/shadcn-vue.css",
    ],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommendedTypeChecked,
  prettierConfig,
  {
    rules: {
      // Formatting is enforced by `prettier --check` (format:check).
      "prettier/prettier": "off",
      "vue/multi-word-component-names": ["error", { ignores: ["App"] }],
    },
  },
);
