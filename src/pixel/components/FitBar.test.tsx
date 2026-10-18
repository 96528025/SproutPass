import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FitBar } from "./FitBar";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("FitBar date text", () => {
  it("shows month and day only when the date is under ~300 days away", () => {
    const html = renderToStaticMarkup(<FitBar until="2026-08-27" now="2026-05-20" from="2026-05-15" />);
    expect(text(html)).toContain("Fits until about Aug 27 99 days left");
    expect(html).not.toContain("2026");
  });

  it("adds the year when the date is more than ~300 days away", () => {
    // V3 repro: a 2T item snapped on May 15, 2026 predicted to fit until Nov 26, 2028.
    const html = renderToStaticMarkup(<FitBar until="2028-11-26" now="2026-05-15" from="2026-05-15" />);
    expect(text(html)).toContain("Fits until about Nov 26, 2028");
    expect(text(html)).toContain("926 days left");
  });

  it("counts calendar days across the November daylight-saving change", () => {
    const html = renderToStaticMarkup(<FitBar until="2026-11-17" now="2026-10-18" />);
    expect(text(html)).toContain("30 days left");
  });

  it("shows no date once the item is past its outgrow date", () => {
    const html = renderToStaticMarkup(<FitBar until="2026-08-27" now="2026-09-20" from="2026-05-15" />);
    expect(text(html)).toContain("Probably outgrown");
    expect(text(html)).toContain("24 days over");
  });
});
