import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Navigate from dist/utils/version.js to package.json at project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const packagePath = join(__dirname, "..", "..", "package.json");

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

export const VERSION: string = pkg.version;
