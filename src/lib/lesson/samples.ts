/**
 * Hand-written lessons that work with no API key. They show every kind of
 * board item (title, text tones, bullets, boxed maths, derivation steps,
 * tables, figures, plots, flowcharts, pointing) and double as render fixtures.
 * All content goes through the same validator as AI output.
 */
import { beatsFromObject, type Beat } from "@/lib/board/schema";
import type { Lesson, Outline } from "./types";

interface SampleDef {
  id: string;
  topic: string;
  level: Lesson["level"];
  outline: Outline;
  sections: Record<string, unknown[]>;
}

const pythagoras: SampleDef = {
  id: "sample-pythagoras",
  topic: "Pythagorean theorem",
  level: "school",
  outline: {
    title: "The Pythagorean Theorem",
    subject: "Mathematics",
    summary: "Why the sides of every right triangle obey a² + b² = c², and how to use it.",
    objectives: ["Identify the hypotenuse of a right triangle", "State and prove a² + b² = c²", "Solve real problems with it"],
    sections: [
      { id: "s1", title: "Right triangles", goal: "Hook with a ladder problem; define legs and hypotenuse with a labelled triangle." },
      { id: "s2", title: "The theorem and a visual proof", goal: "State a² + b² = c² and prove it with the four-triangle square." },
      { id: "s3", title: "Using it: the ladder problem", goal: "Solve the ladder problem step by step; table of Pythagorean triples; recap." },
    ],
  },
  sections: {
    s1: [
      {
        say: "Hi! Imagine a five metre ladder leaning against a wall, with its foot three metres away. How high up the wall does it reach? By the end of this lesson you'll answer that in ten seconds.",
        draw: [{ type: "title", text: "The Pythagorean Theorem" }],
      },
      {
        say: "Everything today is about one special shape: the right triangle, a triangle with one angle of exactly ninety degrees.",
        draw: [{ type: "heading", text: "Right triangles" }],
      },
      {
        say: "Let me draw one. This little square in the corner marks the right angle. I'll call the two sides that make the corner a and b.",
        draw: [
          {
            type: "figure",
            id: "tri",
            size: "half",
            height: 62,
            caption: "a right triangle",
            shapes: [
              { shape: "polygon", points: [[15, 52], [80, 52], [15, 10]], fill: true },
              { shape: "rect", x: 15, y: 46, w: 6, h: 6, color: "yellow" },
              { shape: "text", x: 47, y: 58, text: "a", color: "blue", size: "lg" },
              { shape: "text", x: 9, y: 31, text: "b", color: "green", size: "lg" },
              { shape: "text", x: 52, y: 26, text: "c", color: "red", size: "lg" },
            ],
          },
        ],
      },
      {
        say: "The longest side, opposite the right angle, has a special name: the hypotenuse. We call it c. It's always the longest side.",
        draw: [{ type: "text", tone: "definition", size: "half", text: "**Hypotenuse** $c$: the side opposite the right angle, always the longest." }],
        point: "tri",
      },
      {
        say: "Quick question for you: in a right triangle, can a leg ever be longer than the hypotenuse? Think about it, then we'll see why not.",
        draw: [{ type: "text", tone: "tip", text: "Legs $a$, $b$ make the right angle. The hypotenuse $c$ faces it." }],
      },
    ],
    s2: [
      {
        say: "Now the big idea, discovered thousands of years ago and named after Pythagoras.",
        draw: [{ type: "heading", text: "The theorem and a visual proof" }],
      },
      {
        say: "In any right triangle, a squared plus b squared equals c squared. The square on the hypotenuse equals the sum of the squares on the other two sides.",
        draw: [{ type: "math", id: "law", latex: "a^2 + b^2 = c^2", boxed: true, label: "Pythagoras' theorem" }],
      },
      {
        say: "But why is it true? Here's a beautiful proof. Draw a big square with side a plus b, and inside it place four copies of our triangle. The space left in the middle is a tilted square with side c.",
        draw: [
          {
            type: "figure",
            size: "half",
            height: 78,
            shapes: [
              { shape: "rect", x: 25, y: 10, w: 60, h: 60 },
              { shape: "polygon", points: [[49, 10], [85, 34], [61, 70], [25, 46]], color: "yellow", fill: true },
              { shape: "text", x: 37, y: 5, text: "a", color: "blue" },
              { shape: "text", x: 67, y: 5, text: "b", color: "green" },
              { shape: "text", x: 64, y: 31, text: "c", color: "red" },
              { shape: "text", x: 55, y: 42, text: "$c^2$", color: "yellow", size: "lg" },
            ],
          },
        ],
      },
      {
        say: "Now count the area of the big square two ways. Directly, it's a plus b, all squared. Or, it's the middle square plus four triangles, each one half a times b.",
        draw: [
          {
            type: "steps",
            size: "half",
            lines: [
              { latex: "(a+b)^2 = c^2 + 4\\cdot\\tfrac{1}{2}ab", note: "same area, two ways" },
              { latex: "a^2 + 2ab + b^2 = c^2 + 2ab", note: "expand" },
              { latex: "a^2 + b^2 = c^2", note: "cancel 2ab" },
            ],
          },
        ],
      },
      {
        say: "The two a b terms cancel, and we're left with exactly our theorem. That's a complete proof, using nothing but area.",
        draw: [],
        point: "law",
      },
    ],
    s3: [
      {
        say: "Let's go back to our ladder and solve it.",
        draw: [{ type: "heading", text: "Using it: the ladder problem" }],
      },
      {
        say: "The wall and the ground make a right angle. The ladder is the hypotenuse, five metres. The foot is three metres out, and the height h is what we want.",
        draw: [
          {
            type: "figure",
            size: "half",
            height: 66,
            shapes: [
              { shape: "line", x1: 8, y1: 58, x2: 92, y2: 58 },
              { shape: "line", x1: 70, y1: 58, x2: 70, y2: 6, color: "gray" },
              { shape: "line", x1: 34, y1: 58, x2: 70, y2: 10, color: "orange", label: "5 m" },
              { shape: "rect", x: 64, y: 52, w: 6, h: 6, color: "yellow" },
              { shape: "text", x: 52, y: 63, text: "3 m", color: "blue" },
              { shape: "text", x: 80, y: 34, text: "$h = ?$", color: "green" },
            ],
          },
        ],
      },
      {
        say: "Put the numbers into the theorem: three squared plus h squared equals five squared. So h squared is twenty five minus nine, which is sixteen, and h is four metres.",
        draw: [
          {
            type: "steps",
            size: "half",
            lines: [
              { latex: "3^2 + h^2 = 5^2" },
              { latex: "h^2 = 25 - 9 = 16" },
              { latex: "h = 4\\ \\text{m}", note: "answer" },
            ],
          },
        ],
      },
      {
        say: "Three, four, five is a Pythagorean triple: whole numbers that fit perfectly. Examiners love these, so remember a few.",
        draw: [
          {
            type: "table",
            headers: ["a", "b", "c", "check"],
            rows: [
              ["3", "4", "5", "9 + 16 = 25"],
              ["5", "12", "13", "25 + 144 = 169"],
              ["8", "15", "17", "64 + 225 = 289"],
            ],
          },
        ],
      },
      {
        say: "To recap: it only works for right triangles, c is always the side opposite the right angle, and you can rearrange it to find any side. Try this: what's the diagonal of a six by eight rectangle?",
        draw: [
          {
            type: "bullets",
            items: ["Only for right triangles", "$c$ = hypotenuse, the longest side", "Find a leg: $b = \\sqrt{c^2 - a^2}$"],
          },
        ],
      },
    ],
  },
};

const newton: SampleDef = {
  id: "sample-newton",
  topic: "Newton's second law of motion",
  level: "senior",
  outline: {
    title: "Newton's Second Law: F = ma",
    subject: "Physics",
    summary: "How net force, mass and acceleration are linked, with graphs and a worked numerical.",
    objectives: ["State F = ma and its units", "Read force-acceleration graphs", "Solve numericals with F = ma"],
    sections: [
      { id: "s1", title: "Force changes motion", goal: "Shopping-cart hook; free body diagram of a pushed block." },
      { id: "s2", title: "F = ma and its units", goal: "Boxed law, definition of the newton, table of quantities." },
      { id: "s3", title: "Seeing it on a graph", goal: "Plot a against F for three masses; slope = 1/m." },
      { id: "s4", title: "Worked example and recap", goal: "Car numerical step by step; flowchart from force to motion." },
    ],
  },
  sections: {
    s1: [
      {
        say: "Here's something you already know. Pushing an empty shopping cart is easy, but a full one barely moves with the same push. Newton turned that feeling into one of the most powerful equations in physics.",
        draw: [{ type: "title", text: "Newton's Second Law: F = ma" }],
      },
      {
        say: "Let's start with a block on a smooth floor.",
        draw: [{ type: "heading", text: "Force changes motion" }],
      },
      {
        say: "I push it with a force F to the right. In red, the force. The block, of mass m, starts speeding up: that's an acceleration a, in blue, in the same direction as the force.",
        draw: [
          {
            type: "figure",
            id: "fbd",
            size: "half",
            height: 52,
            shapes: [
              { shape: "line", x1: 6, y1: 44, x2: 94, y2: 44, color: "gray" },
              { shape: "rect", x: 28, y: 24, w: 26, h: 20, label: "m", fill: true },
              { shape: "arrow", x1: 55, y1: 34, x2: 88, y2: 34, color: "red", label: "F" },
              { shape: "arrow", x1: 30, y1: 15, x2: 52, y2: 15, color: "blue", label: "a" },
            ],
          },
        ],
      },
      {
        say: "Two observations. A bigger force gives a bigger acceleration. And a bigger mass, with the same force, gives a smaller acceleration. Keep both in mind.",
        draw: [
          {
            type: "bullets",
            size: "half",
            items: ["Bigger $F$ → bigger $a$", "Bigger $m$ → smaller $a$"],
          },
        ],
      },
    ],
    s2: [
      {
        say: "Put those two ideas together and you get the second law.",
        draw: [{ type: "heading", text: "F = ma and its units" }],
      },
      {
        say: "The net force on a body equals its mass times its acceleration. Net force is important: it's the total of all forces, not just one push.",
        draw: [{ type: "math", id: "law2", latex: "F_{\\text{net}} = m\\,a", boxed: true, label: "Newton's second law" }],
      },
      {
        say: "This also defines the unit of force. One newton is the force that gives one kilogram an acceleration of one metre per second squared.",
        draw: [{ type: "text", tone: "definition", text: "**1 newton** (N) $= 1\\ \\text{kg}\\cdot\\text{m/s}^2$" }],
      },
      {
        say: "Here are the three quantities with their SI units. Board exams often ask you to write exactly this.",
        draw: [
          {
            type: "table",
            headers: ["Quantity", "Symbol", "SI unit"],
            rows: [
              ["Net force", "$F$", "newton (N)"],
              ["Mass", "$m$", "kilogram (kg)"],
              ["Acceleration", "$a$", "$\\text{m/s}^2$"],
            ],
          },
        ],
      },
      {
        say: "Exam tip: acceleration is always in the direction of the net force, not necessarily the direction of motion. A ball thrown up is moving up, but accelerating down.",
        draw: [{ type: "text", tone: "important", text: "$a$ points along the **net force**, not always along the velocity." }],
      },
    ],
    s3: [
      {
        say: "Now let's see the law as a picture.",
        draw: [{ type: "heading", text: "Seeing it on a graph" }],
      },
      {
        say: "Rearranged, the acceleration is force divided by mass. So if I plot acceleration against force, I get straight lines through the origin, one for each mass.",
        draw: [
          { type: "math", size: "half", latex: "a = \\frac{F}{m}" },
          {
            type: "plot",
            size: "half",
            functions: [
              { expr: "x/1", label: "$m=1$ kg" },
              { expr: "x/2", label: "$m=2$ kg" },
              { expr: "x/4", label: "$m=4$ kg" },
            ],
            xMin: 0,
            xMax: 10,
            yMin: 0,
            yMax: 10,
            xLabel: "F (N)",
            yLabel: "a (m/s²)",
          },
        ],
      },
      {
        say: "Notice the steepest line belongs to the lightest mass. The slope of each line is one over m. So from a graph, you can find the mass: it's one over the slope.",
        draw: [{ type: "text", tone: "tip", size: "half", text: "Slope of $a$–$F$ graph $= \\dfrac{1}{m}$" }],
      },
    ],
    s4: [
      {
        say: "Let's solve a typical numerical.",
        draw: [{ type: "heading", text: "Worked example and recap" }],
      },
      {
        say: "A car of mass twelve hundred kilograms speeds up from rest to twenty metres per second in eight seconds. What net force acts on it?",
        draw: [{ type: "text", tone: "example", text: "$m = 1200$ kg, $u = 0$, $v = 20$ m/s, $t = 8$ s. Find $F$." }],
      },
      {
        say: "First the acceleration: change in velocity over time, twenty over eight, which is two point five metres per second squared. Then force is mass times acceleration: twelve hundred times two point five, which is three thousand newtons.",
        draw: [
          {
            type: "steps",
            lines: [
              { latex: "a = \\frac{v-u}{t} = \\frac{20-0}{8} = 2.5\\ \\text{m/s}^2", note: "find a first" },
              { latex: "F = ma = 1200 \\times 2.5", note: "apply F = ma" },
              { latex: "F = 3000\\ \\text{N}", note: "answer" },
            ],
          },
        ],
        point: "law2",
      },
      {
        say: "So here's the whole chain in one picture: a net force causes acceleration, acceleration changes velocity, and that's how motion changes.",
        draw: [
          {
            type: "flowchart",
            direction: "LR",
            nodes: [
              { id: "f", label: "Net force F", shape: "round" },
              { id: "a", label: "Acceleration a = F/m" },
              { id: "v", label: "Velocity changes" },
              { id: "m", label: "Motion changes", shape: "round" },
            ],
            edges: [
              { from: "f", to: "a", label: "÷ m" },
              { from: "a", to: "v", label: "over time" },
              { from: "v", to: "m" },
            ],
          },
        ],
      },
      {
        say: "Your turn: what force does it take to give a two kilogram ball an acceleration of five metres per second squared? Pause me, work it out, then hit play.",
        draw: [{ type: "text", tone: "question", text: "Try it: $m = 2$ kg, $a = 5$ m/s². $F = ?$" }],
      },
    ],
  },
};

const photosynthesis: SampleDef = {
  id: "sample-photosynthesis",
  topic: "Photosynthesis",
  level: "school",
  outline: {
    title: "Photosynthesis: How Plants Make Food",
    subject: "Biology",
    summary: "What plants take in, what they make, and where it happens.",
    objectives: ["Write the photosynthesis equation", "Name the inputs and outputs", "Compare the light and dark reactions"],
    sections: [
      { id: "s1", title: "Inputs and outputs", goal: "Hook; flowchart of sunlight, CO₂ and water into glucose and oxygen." },
      { id: "s2", title: "The equation and where it happens", goal: "Balanced equation; chloroplast; light vs dark reactions table; recap." },
    ],
  },
  sections: {
    s1: [
      {
        say: "Every bite of food you've ever eaten started with a plant catching sunlight. Today, let's find out how a leaf turns light, air and water into food.",
        draw: [{ type: "title", text: "Photosynthesis: How Plants Make Food" }],
      },
      {
        say: "First, what goes in and what comes out?",
        draw: [{ type: "heading", text: "Inputs and outputs" }],
      },
      {
        say: "Three things go into the leaf: sunlight, carbon dioxide from the air, and water from the roots. In the chloroplast they're turned into glucose, the plant's food, and oxygen is released.",
        draw: [
          {
            type: "flowchart",
            id: "flow",
            direction: "TB",
            nodes: [
              { id: "sun", label: "Sunlight", shape: "round" },
              { id: "co2", label: "CO₂ from air", shape: "round" },
              { id: "h2o", label: "Water from roots", shape: "round" },
              { id: "chl", label: "Chloroplast (chlorophyll)" },
              { id: "glu", label: "Glucose (food)", shape: "round" },
              { id: "o2", label: "Oxygen released", shape: "round" },
            ],
            edges: [
              { from: "sun", to: "chl" },
              { from: "co2", to: "chl" },
              { from: "h2o", to: "chl" },
              { from: "chl", to: "glu" },
              { from: "chl", to: "o2" },
            ],
          },
        ],
      },
      {
        say: "That oxygen is the air you're breathing right now. So photosynthesis feeds the plant and keeps us alive.",
        draw: [{ type: "text", tone: "tip", text: "Light energy is stored as **chemical energy** in glucose." }],
      },
    ],
    s2: [
      {
        say: "Let's write it the way your exam wants it.",
        draw: [{ type: "heading", text: "The equation and where it happens" }],
      },
      {
        say: "Six carbon dioxide plus six water, using light energy and chlorophyll, gives one glucose and six oxygen. Count the atoms: it's balanced.",
        draw: [
          {
            type: "math",
            boxed: true,
            latex: "6\\,CO_2 + 6\\,H_2O \\xrightarrow[\\text{chlorophyll}]{\\text{light}} C_6H_{12}O_6 + 6\\,O_2",
            label: "balanced equation",
          },
        ],
      },
      {
        say: "It happens in two stages. The light reactions need sunlight and split water to release oxygen. The dark reactions, or Calvin cycle, use that energy to build glucose from carbon dioxide.",
        draw: [
          {
            type: "table",
            headers: ["", "Light reactions", "Dark reactions"],
            rows: [
              ["Where", "Thylakoid (grana)", "Stroma"],
              ["Needs light?", "Yes", "No (uses ATP, NADPH)"],
              ["Produces", "O₂, ATP, NADPH", "Glucose"],
            ],
          },
        ],
      },
      {
        say: "Recap: carbon dioxide and water in, glucose and oxygen out, powered by light in the chloroplast. Here's one to think about: why do plants kept in the dark slowly die?",
        draw: [
          {
            type: "bullets",
            items: ["Inputs: $CO_2$, $H_2O$, light", "Outputs: glucose, $O_2$", "Site: chloroplast"],
          },
        ],
        point: "flow",
      },
    ],
  },
};

export const SAMPLES = [pythagoras, newton, photosynthesis];

export const SAMPLE_CARDS = SAMPLES.map((s) => ({
  id: s.id,
  title: s.outline.title,
  subject: s.outline.subject,
  summary: s.outline.summary,
}));

export function buildSampleLesson(id: string): Lesson | null {
  const def = SAMPLES.find((s) => s.id === id);
  if (!def) return null;
  const now = Date.now();
  const sections: Lesson["sections"] = {};
  for (const sec of def.outline.sections) {
    const beats: Beat[] = (def.sections[sec.id] ?? []).flatMap((b) => beatsFromObject(b));
    sections[sec.id] = { status: "ready", beats };
  }
  return {
    id: def.id,
    topic: def.topic,
    level: def.level,
    language: "english",
    depth: "standard",
    status: "ready",
    outline: def.outline,
    sections,
    qa: [],
    chat: [],
    ink: {},
    progress: { index: 0 },
    sample: true,
    createdAt: now,
    updatedAt: now,
  };
}
