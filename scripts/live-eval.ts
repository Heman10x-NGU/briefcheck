import { fixtures } from "../src/shared/fixtures.js";
import { reviewSchema } from "../src/shared/schema.js";
import { createProvider } from "../src/server/providers.js";
import { review } from "../src/server/review.js";
if (!process.argv.includes("--confirm-live-costs"))
  throw new Error(
    "Not run: add --confirm-live-costs only after authorizing transmission to the selected provider and API charges.",
  );
if (!["typesafe", "subq"].includes(process.env.BRIEFCHECK_PROVIDER ?? ""))
  throw new Error(
    "Not run: explicitly set BRIEFCHECK_PROVIDER=typesafe or subq.",
  );
const provider = createProvider();
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
