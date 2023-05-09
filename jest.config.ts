import { Config } from "@jest/types";

const config: Config.InitialOptions = {
  verbose: true,
  testTimeout: 10*60*1000,
  transform: {
    "^.+\\.ts?$": "ts-jest",
  },
  testMatch: [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/*.e2e.ts"
  ],
  reporters: [
    "default",
    "jest-junit"
  ]
};
export default config;