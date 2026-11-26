import { PASSWORD_RESET } from "./course-updates";

/**
 * The Google Apps Script the owner pastes into script.google.com. It runs in
 * their own Google account and posts SFU mail only: mail redirected from
 * SFU Outlook (to, cc or from an sfu.ca address), and older SFU mail
 * forwarded as attachments. Password-reset emails are skipped before
 * anything is sent. It remembers the newest email it handled; Life OS
 * ignores repeats.
 */
export function gmailScript(endpoint: string, token: string) {
  return `// Life OS: SFU email bridge. Runs in your Google account only.
const LIFE_OS_URL = ${JSON.stringify(endpoint)};
const LIFE_OS_TOKEN = ${JSON.stringify(token)};
// SFU mail only. Your Gmail's own mail is never sent.
const SFU = "{to:sfu.ca cc:sfu.ca from:sfu.ca}";
// Choose setUp and press Run once: checks every 5 minutes from now on.
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendCourseEmails").timeBased().everyMinutes(5).create();
  sendCourseEmails();
}

// Password-reset emails never leave Gmail.
const PASSWORD_RESET = ${PASSWORD_RESET.toString()};

function isPasswordReset_(subject, body) {
  return PASSWORD_RESET.test(subject || "") || PASSWORD_RESET.test((body || "").slice(0, 1500));
}

function post_(emails) {
  const r = UrlFetchApp.fetch(LIFE_OS_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + LIFE_OS_TOKEN },
    payload: JSON.stringify({ emails: emails }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error("Life OS said " + r.getResponseCode() + ": " + r.getContentText());
}

// Older emails you forward from Outlook arrive as attached .eml files.
function attachedEmails_(m) {
  return m.getAttachments({ includeInlineImages: false }).filter(function (a) {
    return a.getContentType() === "message/rfc822" || /\\.eml$/i.test(a.getName());
  });
}

function sendCourseEmails() {
  const props = PropertiesService.getUserProperties();
  const me = (Session.getActiveUser().getEmail() || "").toLowerCase();
  // First run looks back 3 days; after that, from the newest email handled.
  const since = Number(props.getProperty("LIFE_OS_SINCE") || Date.now() - 3 * 86400000);
  const query = SFU + " after:" + Math.floor(since / 1000 - 600) + " -in:sent -in:drafts -in:chats";
  let newest = since;
  let batch = [];
  let size = 0;
  function add(item) {
    const n = JSON.stringify(item).length;
    if (batch.length && (batch.length === 25 || size + n > 800000)) { post_(batch); batch = []; size = 0; }
    batch.push(item);
    size += n;
  }
  // Up to 250 conversations per run; anything left goes on the next run.
  for (let start = 0; start < 250; start += 50) {
    const threads = GmailApp.search(query, start, 50);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        const when = m.getDate().getTime();
        const from = m.getFrom() || "";
        // Already handled on an earlier run (the search overlaps by 10 minutes).
        if (when <= since || m.isDraft()) return;
        if (me && from.toLowerCase().indexOf(me) !== -1) return; // your own replies
        if (when > newest) newest = when;
        const id = m.getHeader("Message-ID") || m.getId();
        const eml = attachedEmails_(m);
        if (eml.length) {
          eml.forEach(function (a, i) {
            add({ id: id + "#" + i, raw: a.getDataAsString().slice(0, 400000) });
          });
          return;
        }
        const subject = m.getSubject() || "";
        const body = (m.getPlainBody() || "").slice(0, 10000);
        if (isPasswordReset_(subject, body)) return;
        add({
          id: id,
          subject: subject,
          from: from,
          to: [m.getTo(), m.getCc()].filter(String).join(", ").slice(0, 4000),
          date: m.getDate().toISOString(),
          body: body,
        });
      });
    });
    if (threads.length < 50) break;
  }
  if (batch.length) post_(batch);
  props.setProperty("LIFE_OS_SINCE", String(newest));
}

`;
}
