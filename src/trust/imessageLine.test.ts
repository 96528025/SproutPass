import { describe, expect, it } from "vitest";
import { displayNumber, normalizeNumber, parseLines, petLine, serverLine } from "./imessageLine";

describe("normalizeNumber / displayNumber", () => {
  it("reads common US formats", () => {
    expect(normalizeNumber("+1 (310) 555-0111")).toBe("+13105550111");
    expect(normalizeNumber("310.555.0111")).toBe("+13105550111");
    expect(normalizeNumber("13105550111")).toBe("+13105550111");
    expect(normalizeNumber("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk", () => {
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("555-0111")).toBeNull();
    expect(normalizeNumber(42)).toBeNull();
  });
  it("formats US numbers for people", () => {
    expect(displayNumber("+13105550111")).toBe("+1 (310) 555-0111");
    expect(displayNumber("+442079460958")).toBe("+442079460958");
  });
});

describe("parseLines", () => {
  it("maps parent keys to the pet's line", () => {
    expect(parseLines("mina=+13105550111, jo: +1 (310) 555-0112")).toEqual({ mina: "+13105550111", jo: "+13105550112" });
  });
  it("skips bad entries and survives no env at all", () => {
    expect(parseLines("mina=nope,jo=3105550112")).toEqual({ jo: "+13105550112" });
    expect(parseLines(undefined)).toEqual({});
  });
});

describe("petLine", () => {
  it("builds a tap-to-text link and a QR text from the build's numbers", () => {
    expect(petLine("jo", { parent: {} }, "jo=+13105550112")).toEqual({
      number: "+13105550112",
      display: "+1 (310) 555-0112",
      smsHref: "sms:+13105550112?&body=hi",
      qrText: "SMSTO:+13105550112:hi",
      connected: null,
    });
  });
  it("prefers the server's public field, with its connected flag", () => {
    const closet = { parent: { imessage: { lineNumber: "+1 310 555 0199", connected: true } } };
    expect(petLine("jo", closet, "jo=+13105550112")).toMatchObject({ number: "+13105550199", connected: true });
    expect(serverLine({ imessage: { connected: false } })).toEqual({ number: null, connected: false });
  });
  it("is null when nobody knows the number (never guesses one)", () => {
    expect(petLine("sam", {}, "jo=+13105550112")).toBeNull();
    expect(petLine(null, null, undefined)).toBeNull();
  });
});
