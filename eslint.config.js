import js from "@eslint/js";
import ts from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  ...ts.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.vue"],
  })),
  ...pluginVue.configs["flat/recommended"],
  eslintConfigPrettier,
  {
    files: ["injected/**/*.js"],
    rules: {
      "id-match": ["error", "^[A-Za-z_$][A-Za-z0-9_$]*$", { properties: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**", "./*/**"],
              message: "跨目录引用使用 @injected/ 别名，同目录可使用相对路径。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.vue", "**/*.ts", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["**/*.mjs", "**/*.cjs"],
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
    files: ["**/*.ts", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
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
