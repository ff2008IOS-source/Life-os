import { PASSWORD_RESET } from "./course-updates";

/**
 * The Google Apps Script the owner pastes into script.google.com. It runs in
 * their own Google account and posts new incoming mail (redirected from SFU
 * Outlook, plus Gmail's own) to Life OS with their private token.
 * Password-reset emails are skipped before anything is sent. It remembers
 * the newest email it sent; Life OS ignores repeats.
 */
export function gmailScript(endpoint: string, token: string) {
  return `// Life OS: email bridge. Runs in your Google account only.
const LIFE_OS_URL = ${JSON.stringify(endpoint)};
const LIFE_OS_TOKEN = ${JSON.stringify(token)};
// Password-reset emails never leave Gmail.
const PASSWORD_RESET = ${PASSWORD_RESET.toString()};

function isPasswordReset(subject, body) {
  return PASSWORD_RESET.test(subject) || PASSWORD_RESET.test(body.slice(0, 1500));
}

function post(emails) {
  const r = UrlFetchApp.fetch(LIFE_OS_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + LIFE_OS_TOKEN },
    payload: JSON.stringify({ emails: emails }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error("Life OS said " + r.getResponseCode() + ": " + r.getContentText());
}

function sendCourseEmails() {
  const props = PropertiesService.getUserProperties();
  const me = (Session.getActiveUser().getEmail() || "").toLowerCase();
  // First run looks back 3 days; after that, from the newest email already sent.
  const since = Number(props.getProperty("LIFE_OS_SINCE") || Date.now() - 3 * 86400000);
  const query = "after:" + Math.floor(since / 1000 - 600) + " -in:sent -in:drafts -in:chats";
  let newest = since;
  let batch = [];
  // Up to 250 conversations per run; anything left goes next hour.
  for (let start = 0; start < 250; start += 50) {
    const threads = GmailApp.search(query, start, 50);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        const when = m.getDate().getTime();
        const from = m.getFrom() || "";
        if (when < since - 600000 || m.isDraft()) return;
        if (me && from.toLowerCase().indexOf(me) !== -1) return; // your own replies
        const subject = m.getSubject() || "";
        const body = (m.getPlainBody() || "").slice(0, 10000);
        if (isPasswordReset(subject, body)) return;
        batch.push({ id: m.getId(), subject: subject, from: from, date: m.getDate().toISOString(), body: body });
        if (when > newest) newest = when;
        if (batch.length === 25) { post(batch); batch = []; }
      });
    });
    if (threads.length < 50) break;
  }
  if (batch.length) post(batch);
  props.setProperty("LIFE_OS_SINCE", String(newest));
}

// Run once: checks every hour from now on.
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendCourseEmails").timeBased().everyHours(1).create();
  sendCourseEmails();
}
`;
}
