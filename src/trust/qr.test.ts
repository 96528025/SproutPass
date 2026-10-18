// The QR encoder behind /bag/pet's "scan to text your pet". Decoding was also checked end to end with OpenCV's
// QR reader (all 8 masks, versions 1, 2, 4 and 6); these tests pin the parts with published reference values.
import { describe, expect, it } from "vitest";
import { dataCodewords, encodeQr, finalCodewords, formatBits, qrPath, rsDivisor, rsRemainder } from "./qr";

describe("Reed–Solomon", () => {
  it("matches the reference HELLO WORLD 1-M error correction codewords", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe("format bits (level M)", () => {
  it("matches the standard's table", () => {
    const table = [
      "101010000010010", "101000100100101", "101111001111100", "101101101001011",
      "100010111111001", "100000011001110", "100111110010111", "100101010100000",
    ];
    table.forEach((bits, mask) => expect(formatBits(mask).toString(2).padStart(15, "0")).toBe(bits));
  });
});

describe("data codewords", () => {
  it("byte mode header, the bytes, terminator and 0xEC/0x11 padding", () => {
    const cw = dataCodewords(new TextEncoder().encode("hi"), 1);
    expect(cw).toHaveLength(16);
    // 0100 | 00000010 | 01101000 | 01101001 | 0000 → 0x40 0x26 0x86 0x90, then pads
    expect(cw.slice(0, 4)).toEqual([0x40, 0x26, 0x86, 0x90]);
    expect(cw.slice(4)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]);
  });
  it("interleaves blocks for multi-block versions", () => {
    const data = Array.from({ length: 64 }, (_, i) => i);
    const out = finalCodewords(data, 4); // 2 blocks of 32 + 18 EC each
    expect(out).toHaveLength(100);
    expect(out.slice(0, 4)).toEqual([0, 32, 1, 33]);
  });
});

describe("encodeQr", () => {
  it("picks the smallest version that fits and draws the fixed patterns", () => {
    const q = encodeQr("SMSTO:+13105550111:hi");
    expect(q.version).toBe(2);
    expect(q.size).toBe(25);
    const m = q.modules;
    // finder corners, the timing row, and the always-dark module
    for (const [x, y] of [[0, 0], [6, 0], [0, 6], [24, 0], [0, 24], [18, 18], [8, 17]]) expect(m[y][x]).toBe(true);
    for (let x = 8; x <= 16; x++) expect(m[6][x]).toBe(x % 2 === 0);
  });
  it("refuses text too long for version 6", () => {
    expect(() => encodeQr("x".repeat(107))).toThrow();
    expect(encodeQr("x".repeat(106)).version).toBe(6);
  });
  it("draws one square per dark module inside a quiet zone", () => {
    const q = encodeQr("hi");
    const dark = q.modules.flat().filter(Boolean).length;
    expect(qrPath(q).match(/M/g)).toHaveLength(dark);
    expect(qrPath(q).startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
