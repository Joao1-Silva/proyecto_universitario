import tsParser from "@typescript-eslint/parser"

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "electron-dist/**",
      "backend/**",
      "public/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {},
  },
]
