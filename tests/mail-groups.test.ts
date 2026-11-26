import { expect, it } from "vitest";
import { isPerson, mailGroup } from "@/lib/mail-groups";

it("puts real people first and folds automatic mail into groups", () => {
  expect(isPerson("Kaden Hruska <kaden@sfu.ca>")).toBe(true);
  expect(isPerson("SFU Residence & Housing Department <housing@sfu.ca>")).toBe(
    false,
  );
  expect(isPerson("donotreply@sfu.ca")).toBe(false);
  expect(
    mailGroup({
      title: 'Kaden Hruska shared the folder "2026 2027" with you',
      sender: "Kaden Hruska <drive-shares-noreply@google.com>",
    }),
  ).toBe("Other");
  expect(
    mailGroup({
      title: "Coffee next week?",
      sender: "Kaden Hruska <kaden@sfu.ca>",
    }),
  ).toBe("People");
  expect(
    mailGroup({
      title: "Residence Community Wide Evacuation Drill",
      sender: "SFU Residence & Housing Department",
    }),
  ).toBe("Housing");
  expect(
    mailGroup({
      title: "Study Credit Notification",
      sender: "Research Participation System",
    }),
  ).toBe("Research credits");
  expect(
    mailGroup({
      title: "Fall 2026 (1267) Enrolment Date",
      sender: "urecords@sfu.ca",
    }),
  ).toBe("Registrar & enrolment");
  expect(
    mailGroup({
      title: "New Tutorial Section Added to BUS 275 D100 (Spring 2027)",
      sender: "Beedie Undergraduate Scheduling",
    }),
  ).toBe("Registrar & enrolment");
  expect(mailGroup({ title: "Due Items", sender: "libcirc@sfu.ca" })).toBe(
    "Library",
  );
  expect(mailGroup({ title: "Course Invitation", sender: "SFU Canvas" })).toBe(
    "Canvas",
  );
  expect(
    mailGroup({
      title: "Thank you! We are working on your SFU Bookstore Online order",
      sender: "eshop@sfu.ca",
    }),
  ).toBe("Orders & accounts");
});
