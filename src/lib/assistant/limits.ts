export type AssistantLimits = {
  available_tokens: number;
  remaining_requests: number;
  daily_limit: number;
  reason: "disabled" | "daily" | "provider" | "busy" | "tokens" | null;
  retry_at: string | null;
  reset_at: string;
};
export function limitMessage(limit: AssistantLimits) {
  switch (limit.reason) {
    case "daily":
      return `You've used today's ${limit.daily_limit}-message allowance. It resets at midnight in Vancouver.`;
    case "provider":
      return "Groq's free allowance is temporarily full. Your draft is kept.";
    case "busy":
      return "Another answer is still being prepared. Your draft is kept.";
    case "disabled":
      return "Enable the assistant in AI settings to chat.";
    default:
      return "The current free token window is full. Your draft is kept.";
  }
}
