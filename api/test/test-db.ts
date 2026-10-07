/**
 * Test database guard. Tests only ever touch a database whose name ends in
 * "_test", so they can never modify development or production data.
 */
export function getTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: TEST_DATABASE_URL must point to a database whose name ends in "_test"`,
    );
  }
  return url;
}

export const dbTestsEnabled = () => getTestDatabaseUrl() !== undefined;
