import js from "@eslint/js";
import ts from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  eslintConfigPrettier,
  {
    files: ["**/*.vue", "**/*.ts", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "vue/html-self-closing": [
        "error",
        {
          html: {
            void: "always",
            normal: "any",
            component: "always",
          },
          svg: "always",
          math: "always",
        },
      ],
    },
  },
  {
    ignores: [
      "dist/**",
      "src-tauri/target/**",
      "node_modules/**",
      "src/services/cmds.ts",
    ],
  },
];
