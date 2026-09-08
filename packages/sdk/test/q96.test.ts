import { describe, expect, it } from "vitest";
import { Q96 } from "../src/q96";

describe("scaffolding", () => {
  it("exposes the Q96 constant", () => {
    expect(Q96).toBe(79228162514264337593543950336n);
  });
});
