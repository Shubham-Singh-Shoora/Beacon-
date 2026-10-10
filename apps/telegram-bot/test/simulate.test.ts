import { describe, expect, it } from "vitest";
import { offlineDemo, runSimulation } from "../src/simulate";

describe("offline smoke test", () => {
  it("exercises all default alert transitions and labels every message as simulated", async () => {
    const messages: string[] = [];
    const sent = await runSimulation(
      offlineDemo(),
      { minutesLeft: 15 },
      {
        name: "test",
        async send(html) {
          messages.push(html);
        },
      },
    );
    expect(sent).toBe(6);
    expect(messages.every((message) => message.startsWith("<b>SIMULATION"))).toBe(true);
    expect(messages.join("\n")).toContain("DEMO");
  });
});
