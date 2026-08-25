import { Fraunces } from "next/font/google";

// Display face for the public landing only — the app chrome stays on Inter
// (loaded by the root layout). The variable is applied on the page wrapper.
export const editorial = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-editorial-var",
});
