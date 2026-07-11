import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const plugins = {
  "@typescript-eslint": tseslint.plugin,
  "react-hooks": reactHooks,
  "react-refresh": reactRefresh,
};

const rules = {
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/switch-exhaustiveness-check": "error",
};

function typedLanguageOptions(project) {
  return {
    parser: tseslint.parser,
    parserOptions: {
      project,
      tsconfigRootDir: import.meta.dirname,
    },
  };
}

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "vite.config.{js,d.ts}"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: typedLanguageOptions("./tsconfig.app.json"),
    plugins,
    rules,
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: typedLanguageOptions("./tsconfig.test.json"),
    plugins,
    rules: {
      ...rules,
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["vite.config.ts"],
    languageOptions: typedLanguageOptions("./tsconfig.node.json"),
    plugins,
    rules,
  },
  {
    files: ["src/engine/exportSvg.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["../components/Canvas*", "../components/dev/**", "./preview*", "./gpu/**", "../experiments/**", "../hooks/**"], message: "SVG export must remain isolated from preview, WebGPU, diagnostics, experiments, and runtime hooks." },
        ],
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/experiments/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/experiments/**"], message: "Experiments require an explicit dev-only adapter; production runtime cannot import them directly." },
        ],
      }],
    },
  },
];
