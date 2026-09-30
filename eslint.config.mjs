import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "db/migrations/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];

export default config;
