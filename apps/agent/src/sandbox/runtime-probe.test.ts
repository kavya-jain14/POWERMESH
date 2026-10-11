import { describe, expect, it } from "vitest";
import { parseNvidiaSmi } from "./runtime-probe";

describe("NVIDIA runtime probe", () => {
  it("parses bounded GPU capabilities from nvidia-smi CSV", () => {
    expect(
      parseNvidiaSmi(
        "0, NVIDIA GeForce RTX 4060 Laptop GPU, 8188, GPU-abc, 590.12\n" +
          "1, NVIDIA RTX 6000 Ada, 49140, GPU-def, 590.12\n",
      ),
    ).toEqual([
      {
        kind: "NVIDIA_CUDA",
        index: 0,
        name: "NVIDIA GeForce RTX 4060 Laptop GPU",
        memoryMb: 8188,
        uuid: "GPU-abc",
        driverVersion: "590.12",
      },
      {
        kind: "NVIDIA_CUDA",
        index: 1,
        name: "NVIDIA RTX 6000 Ada",
        memoryMb: 49140,
        uuid: "GPU-def",
        driverVersion: "590.12",
      },
    ]);
  });

  it("drops malformed probe rows", () => {
    expect(parseNvidiaSmi("bad row\n0, NVIDIA RTX, nope, GPU-x, 590.12")).toEqual([]);
  });
});
