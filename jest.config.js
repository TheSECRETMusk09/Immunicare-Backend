module.exports = {
  testEnvironment: "node",
  setupFiles: ["./tests/setup/testEnv.js"],
  testMatch: ["**/__tests__/**/*.test.js", "**/tests/**/*.test.js"],
  coverageDirectory: "./coverage",
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/coverage/**",
    "!**/tests/**",
    "!**/logs/**",
  ],
  setupFilesAfterEnv: ["./jest.setup.js"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/system/"],
};
