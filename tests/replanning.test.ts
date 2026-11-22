import { it, expect } from "vitest";
import { replacementFor } from "@/lib/replanning";
import { DEFAULT_POLICY } from "@/lib/scheduler";
const task = {
  id: "t",
  title: "Study",
  status: "planned",
  area: "academics",
  eligible: true,
  estimated_minutes: 90,
  actual_minutes: 0,
  priority: 3,
  due_date: "2026-11-12",
  due_at: null,
};
const block = {
  id: "b",
  version: 1,
  task_id: "t",
  start_at: "2026-11-09T22:00:00Z",
  end_at: "2026-11-09T22:45:00Z",
  status: "planned" as const,
  flexibility: "flexible",
};
const input = {
  block,
  tasks: [task],
  blocks: [block],
  busy: [{ start_at: "2026-11-09T22:00:00Z", end_at: "2026-11-09T23:00:00Z" }],
  dependencies: [],
  policy: DEFAULT_POLICY,
  now: "2026-11-09T18:00:00Z",
};
it("replaces a conflicting 45-minute allocation rather than duplicating or scheduling the entire task", () => {
  const proposal = replacementFor(input);
  expect(proposal.replacement?.minutes).toBe(45);
  expect(proposal.replacement?.task_id).toBe("t");
  expect(input.block.start_at).toBe("2026-11-09T22:00:00Z");
  expect(task.due_date).toBe("2026-11-12");
});
it("does not silently move frozen, fixed or impossible blocks", () => {
  expect(
    replacementFor({ ...input, now: "2026-11-09T21:30:00Z" }).reason,
  ).toMatch(/freeze/);
  expect(
    replacementFor({ ...input, block: { ...block, flexibility: "fixed" } })
      .replacement,
  ).toBeNull();
  expect(
    replacementFor({ ...input, tasks: [{ ...task, due_date: "2026-11-08" }] })
      .replacement,
  ).toBeNull();
});
it("permits explicit replanning of one missed occurrence but not ordinary past moves", () => {
  const past = {
    ...block,
    start_at: "2026-11-08T22:00:00Z",
    end_at: "2026-11-08T22:45:00Z",
  };
  expect(replacementFor({ ...input, block: past }).replacement).toBeNull();
  expect(
    replacementFor({ ...input, block: past, missed: true }).replacement
      ?.minutes,
  ).toBe(45);
});
