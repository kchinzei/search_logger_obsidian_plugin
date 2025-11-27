// eslint.config.mjs
import js from "@eslint/js";
import ts from "typescript-eslint";

export default [
  //
  // 1. Ignore patterns (replacement for .eslintignore)
  //
  {
    ignores: [
      "node_modules/",
      "dist/",
      // Add any others:
      // '*.js.map',
      // 'build/',
    ],
  },

  //
  // 2. Base JS rules
  //
  js.configs.recommended,

  //
  // 3. TypeScript rules
  //
  ...ts.configs.recommended,

  //
  // 4. Project-specific overrides
  //
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Add your own rules here
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["*.mjs", "*.config.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
  },
];
