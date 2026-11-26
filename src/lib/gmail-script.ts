/**
 * The Google Apps Script the owner pastes into script.google.com. It runs in
 * their own Google account, reads only course mail forwarded from SFU, and
 * posts it to Life OS with their private token. Every message is sent once
 * (a "Life OS/sent" label marks it).
 */
export function gmailScript(endpoint: string, token: string) {
  return `// Life OS: course email bridge. Runs in your Google account only.
const LIFE_OS_URL = ${JSON.stringify(endpoint)};
const LIFE_OS_TOKEN = ${JSON.stringify(token)};
// Course mail forwarded from SFU Outlook, Canvas and Crowdmark.
const QUERY = 'newer_than:3d -label:"Life OS/sent" (from:sfu.ca OR from:instructure.com OR from:crowdmark.com OR subject:(ECON OR PSYC OR GEOG OR PHIL OR SFU OR BUS OR MATH OR STAT))';

function sendCourseEmails() {
  const label = GmailApp.getUserLabelByName("Life OS/sent") || GmailApp.createLabel("Life OS/sent");
  const threads = GmailApp.search(QUERY, 0, 20);
  const emails = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      emails.push({
        id: m.getId(),
        subject: m.getSubject() || "",
        from: m.getFrom() || "",
        date: m.getDate().toISOString(),
        body: (m.getPlainBody() || "").slice(0, 20000),
      });
    });
  });
  if (!emails.length) return;
  for (let i = 0; i < emails.length; i += 25) {
    const r = UrlFetchApp.fetch(LIFE_OS_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + LIFE_OS_TOKEN },
      payload: JSON.stringify({ emails: emails.slice(i, i + 25) }),
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) throw new Error("Life OS said " + r.getResponseCode() + ": " + r.getContentText());
  }
  threads.forEach(function (t) { t.addLabel(label); });
}

// Run once: checks every hour from now on.
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendCourseEmails").timeBased().everyHours(1).create();
  sendCourseEmails();
}
`;
}
