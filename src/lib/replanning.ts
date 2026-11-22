import {
  schedule,
  type Policy,
  type ScheduleTask,
  type ExistingBlock,
  type Busy,
} from "./scheduler";
export type ReplanBlock = ExistingBlock & {
  id: string;
  version: number;
  flexibility?: string;
  provider_event_id?: string | null;
  run_id?: string;
};
export function replacementFor(input: {
  block: ReplanBlock;
  tasks: ScheduleTask[];
  blocks: ReplanBlock[];
  busy: Busy[];
  dependencies: { predecessor_task_id: string; successor_task_id: string }[];
  policy: Policy;
  now: string;
  missed?: boolean;
}) {
  const { block, policy } = input;
  const now = Date.parse(input.now),
    minutes = (Date.parse(block.end_at) - Date.parse(block.start_at)) / 60000;
  if (block.flexibility === "fixed")
    return {
      reason: "This is a fixed commitment. Change it in its source calendar.",
      replacement: null,
    };
  if (
    Date.parse(block.start_at) < now + policy.freeze_minutes * 60000 &&
    !(input.missed && Date.parse(block.end_at) <= now)
  )
    return {
      reason:
        "This block is inside the freeze window. Review the conflict in Planner.",
      replacement: null,
    };
  if (minutes < 25 || minutes > 90)
    return {
      reason:
        "This block needs a manual duration adjustment before replanning.",
      replacement: null,
    };
  const task = input.tasks.find((t) => t.id === block.task_id);
  if (!task)
    return { reason: "The linked task is unavailable.", replacement: null };
  const result = schedule({
    now: input.now,
    policy: {
      ...policy,
      min_session_minutes: minutes,
      max_session_minutes: minutes,
    },
    busy: input.busy,
    existing: input.blocks
      .filter((b) => b.id !== block.id && b.task_id !== task.id)
      .concat(
        input.blocks
          .filter((b) => b.id !== block.id && b.task_id === task.id)
          .map((b) => ({ ...b, task_id: "other:" + b.id })),
      ),
    dependencies: input.dependencies,
    tasks: input.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            eligible: true,
            estimated_minutes: minutes,
            actual_minutes: 0,
          }
        : { ...t, eligible: false },
    ),
  });
  const replacement = result.blocks.find((b) => b.task_id === task.id);
  return {
    replacement: replacement ?? null,
    reason: replacement
      ? "Move this work block; keep the task and its deadline."
      : (result.warnings.find((w) => w.task_id === task.id)?.reason ??
        "No slot fits before the deadline within your daily cap and work window."),
  };
}
