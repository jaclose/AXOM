import { writeFile, readFile } from "node:fs/promises";
import { AUTH_EMAILS, renderAxomEmail } from "../lib/api/emailTemplates.ts";

const check = process.argv.includes("--check");
for (const [name, definition] of Object.entries(AUTH_EMAILS)) {
  const email = renderAxomEmail(definition);
  for (const [extension, content] of [["html", email.html], ["txt", email.text]]) {
    const destination = new URL(`../supabase/templates/${name}.${extension}`, import.meta.url);
    if (check) {
      if (await readFile(destination, "utf8") !== `${content}\n`) throw new Error(`${name}.${extension} is out of date`);
    } else await writeFile(destination, `${content}\n`);
  }
}
console.log(check ? "AXOM email templates match their shared source." : "Generated three AXOM auth emails and plain-text counterparts.");
