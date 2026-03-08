module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  coverageDirectory: "./coverage",
  collectCoverageFrom: ["**/*.js", "!**/node_modules/**", "!**/coverage/**"],
  setupFilesAfterEnv: ["./jest.setup.js"],
};
