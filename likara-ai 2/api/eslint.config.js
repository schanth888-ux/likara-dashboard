// ESLint 9 flat config. Deliberately minimal — catches real bugs (unused
// vars, undefined references, accidental == instead of ===) without
// bikeshedding style rules a formatter should own instead.
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // "smart" allows the common, deliberate `x == null` idiom (matches both
      // null and undefined in one check) while still requiring === everywhere
      // else — "always" would flag that correct idiom as an error.
      eqeqeq: ["error", "smart"],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
  {
    files: ["tests/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["node_modules/**", "coverage/**"],
  },
];
