/**
 * When a contact is due for a follow-up: the scheduled date has arrived;
 * with no date, 30 days after the last logged contact, or a follow-up noted
 * without a date (as the workbook writes them). A contact with nothing
 * recorded isn't flagged.
 */
export function followUpDue(
  c: {
    next_follow_up_date: string | null;
    relationship_notes?: string | null;
  },
  today: string,
  daysSinceLast: number | null,
) {
  if (c.next_follow_up_date) return c.next_follow_up_date <= today;
  if (daysSinceLast !== null) return daysSinceLast >= 30;
  return /^next follow-up:/im.test(c.relationship_notes ?? "");
}
