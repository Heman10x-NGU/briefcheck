import { fixtures } from "../src/shared/fixtures.js";
import { reviewSchema } from "../src/shared/schema.js";
import { TypeSafeProvider } from "../src/server/providers.js";
import { review } from "../src/server/review.js";
if (!process.argv.includes("--confirm-live-costs"))
  throw new Error(
    "Not run: add --confirm-live-costs only after authorizing TypeSafe transmission and API charges.",
  );
if (process.env.BRIEFCHECK_PROVIDER !== "typesafe")
  throw new Error("Not run: explicitly set BRIEFCHECK_PROVIDER=typesafe.");
const provider = new TypeSafeProvider(process.env.TYPESAFE_API_KEY ?? "");
console.log(
  "Opt-in synthetic fixture smoke evaluation. This is not an accuracy benchmark. At most four sequential API requests; no retries.",
);
for (const fixture of fixtures) {
  const report = await review(reviewSchema.parse(fixture.input), provider);
  console.log(JSON.stringify({ fixture: fixture.id, report }));
  if (report.error) {
    process.exitCode = 1;
    break;
  }
}
