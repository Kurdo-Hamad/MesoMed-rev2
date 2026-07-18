// Deliberate cycle fixture (MM-QA-004 F-16): a → b → a must fail lint.
import { b } from "./b";
export const a: string = `a${b}`;
