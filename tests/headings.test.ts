import { describe, expect, it } from "vitest";
import { dropPartHeading, nestHeadings } from "@/lib/notes/headings";

describe("one outline for notes written block by block", () => {
  it("nests a block's own headings under the part heading, keeping their relative levels", () => {
    expect(nestHeadings("# Lenses\nText\n## Focal length\n### Example", 3)).toBe("### Lenses\nText\n#### Focal length\n##### Example");
    expect(nestHeadings("### Key Definitions\n#### Pixel", 3)).toBe("### Key Definitions\n#### Pixel");
  });

  it("leaves code blocks alone", () => {
    expect(nestHeadings("## Code\n```python\n# a comment\n```", 3)).toBe("### Code\n```python\n# a comment\n```");
  });

  it("drops a part heading the model wrote although the route already did", () => {
    expect(dropPartHeading("## Part 2: Lenses (pages 5-9)\n\n### Key Definitions")).toBe("### Key Definitions");
    expect(dropPartHeading("### Partial derivatives")).toBe("### Partial derivatives");
  });
});
