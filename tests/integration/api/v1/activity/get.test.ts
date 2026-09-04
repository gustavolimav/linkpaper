import orchestrator from "tests/orchestrator";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.cleanDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/activity", () => {
  describe("Anonymous user", () => {
    test("Without session cookie", async () => {
      const response = await fetch("http://localhost:3000/api/v1/activity");

      expect(response.status).toBe(401);
    });
  });

  describe("Authenticated user", () => {
    test("A link-created event appears with the owner as actor", async () => {
      const { user, cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie, {
        title: "Series A Deck.pdf",
      });
      await orchestrator.createShareLink(cookie, document.id, {
        label: "Investor link",
      });

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });

      expect(response.status).toBe(200);

      const responseBody = await response.json();

      expect(responseBody.total).toBe(1);
      expect(responseBody.events).toHaveLength(1);
      expect(responseBody.events[0]).toMatchObject({
        event_type: "link_created",
        document_id: document.id,
        document_title: "Series A Deck.pdf",
        actor_name: user.username,
        actor_email: null,
        link_label: "Investor link",
        is_revisit: false,
      });
    });

    test("A view event appears with the viewer's name/email and reading detail", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie);
      const link = await orchestrator.createShareLink(cookie, document.id);

      await orchestrator.recordView(link.token, {
        viewer_name: "Elena Vasquez",
        viewer_email: "elena@example.com",
        time_on_page: 480,
        pages_viewed: 1,
      });

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });

      const responseBody = await response.json();

      const viewEvent = responseBody.events.find(
        (event: { event_type: string }) => event.event_type === "view",
      );
      expect(viewEvent).toMatchObject({
        document_id: document.id,
        actor_name: "Elena Vasquez",
        actor_email: "elena@example.com",
        pages_viewed: 1,
        page_count: document.page_count,
        time_on_page: 480,
        is_revisit: false,
      });
    });

    test("A second view from the same viewer/link is flagged as a revisit", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie);
      const link = await orchestrator.createShareLink(cookie, document.id);

      const firstView = await orchestrator.recordView(link.token, {
        viewer_fingerprint: "fp-1",
        viewer_name: "Repeat Visitor",
      });
      await orchestrator.pushBackLinkViewCreatedAt(firstView.id, 60);

      await orchestrator.recordView(link.token, {
        viewer_fingerprint: "fp-1",
        viewer_name: "Repeat Visitor",
      });

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });

      const responseBody = await response.json();

      const viewEvents = responseBody.events.filter(
        (event: { event_type: string }) => event.event_type === "view",
      );
      expect(viewEvents).toHaveLength(2);

      // ordered by created_at DESC: the most recent (revisit) comes first
      expect(viewEvents[0].is_revisit).toBe(true);
      expect(viewEvents[1].is_revisit).toBe(false);
    });

    test("Events are ordered by created_at DESC across both event types", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie);
      const link = await orchestrator.createShareLink(cookie, document.id, {
        label: "First link",
      });
      await orchestrator.recordView(link.token, { viewer_name: "Viewer" });

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });

      const responseBody = await response.json();

      expect(responseBody.total).toBe(2);
      // the view happened after the link was created
      expect(responseBody.events[0].event_type).toBe("view");
      expect(responseBody.events[1].event_type).toBe("link_created");
    });

    test("A blocked_download event appears with the requester's name/email, interleaved by created_at DESC", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie, {
        title: "Confidential.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "a.docx",
        buffer: Buffer.from("fake docx bytes"),
      });
      const link = await orchestrator.createShareLink(cookie, document.id, {
        allow_download: false,
      });

      const fileResponse = await fetch(
        `http://localhost:3000/api/v1/share/${link.token}/file`,
        {
          headers: {
            "X-Viewer-Email": "blocked@example.com",
            "X-Viewer-Name": "Blocked Visitor",
          },
        },
      );
      expect(fileResponse.status).toBe(403);

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });
      const responseBody = await response.json();

      const blockedEvents = responseBody.events.filter(
        (event: { event_type: string }) =>
          event.event_type === "blocked_download",
      );
      expect(blockedEvents).toHaveLength(1);
      expect(blockedEvents[0]).toMatchObject({
        document_id: document.id,
        document_title: "Confidential.docx",
        actor_name: "Blocked Visitor",
        actor_email: "blocked@example.com",
      });

      // interleaved correctly among the other event (link_created) by
      // created_at DESC: the blocked attempt happened after link creation
      expect(responseBody.events[0].event_type).toBe("blocked_download");
      expect(responseBody.events[1].event_type).toBe("link_created");
    });

    test("A blocked_download event with no viewer headers still appears, with actor fields null", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie, {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "a.docx",
        buffer: Buffer.from("fake docx bytes"),
      });
      const link = await orchestrator.createShareLink(cookie, document.id, {
        allow_download: false,
      });

      const fileResponse = await fetch(
        `http://localhost:3000/api/v1/share/${link.token}/file`,
        { headers: {} },
      );
      expect(fileResponse.status).toBe(403);

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: cookie },
      });
      const responseBody = await response.json();

      const blockedEvent = responseBody.events.find(
        (event: { event_type: string }) =>
          event.event_type === "blocked_download",
      );
      expect(blockedEvent).toMatchObject({
        document_id: document.id,
        actor_name: null,
        actor_email: null,
      });
    });

    test("Flipping allow_download to true afterwards does not remove or alter the persisted blocked_download event", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie, {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "a.docx",
        buffer: Buffer.from("fake docx bytes"),
      });
      const link = await orchestrator.createShareLink(cookie, document.id, {
        allow_download: false,
      });

      await fetch(`http://localhost:3000/api/v1/share/${link.token}/file`);

      const beforeResponse = await fetch(
        "http://localhost:3000/api/v1/activity",
        { headers: { Cookie: cookie } },
      );
      const beforeBody = await beforeResponse.json();
      const beforeEvent = beforeBody.events.find(
        (event: { event_type: string }) =>
          event.event_type === "blocked_download",
      );
      expect(beforeEvent).toBeDefined();

      await fetch(
        `http://localhost:3000/api/v1/documents/${document.id}/links/${link.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ allow_download: true }),
        },
      );

      const afterResponse = await fetch(
        "http://localhost:3000/api/v1/activity",
        { headers: { Cookie: cookie } },
      );
      const afterBody = await afterResponse.json();
      const afterEvent = afterBody.events.find(
        (event: { event_type: string }) =>
          event.event_type === "blocked_download",
      );

      expect(afterEvent).toEqual(beforeEvent);
    });

    test("Does not include another workspace's activity", async () => {
      const { cookie: ownerCookie } = await orchestrator.createUserSession();
      const { cookie: strangerCookie } = await orchestrator.createUserSession();

      const document = await orchestrator.uploadDocument(ownerCookie);
      await orchestrator.createShareLink(ownerCookie, document.id);

      const response = await fetch("http://localhost:3000/api/v1/activity", {
        headers: { Cookie: strangerCookie },
      });

      const responseBody = await response.json();

      expect(responseBody.total).toBe(0);
      expect(responseBody.events).toHaveLength(0);
    });

    test("Supports pagination via page and per_page", async () => {
      const { cookie } = await orchestrator.createUserSession();
      const document = await orchestrator.uploadDocument(cookie);
      await orchestrator.createShareLink(cookie, document.id, {
        label: "Link 1",
      });
      await orchestrator.createShareLink(cookie, document.id, {
        label: "Link 2",
      });
      await orchestrator.createShareLink(cookie, document.id, {
        label: "Link 3",
      });

      const response = await fetch(
        "http://localhost:3000/api/v1/activity?page=1&per_page=2",
        { headers: { Cookie: cookie } },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();

      expect(responseBody.total).toBe(3);
      expect(responseBody.events).toHaveLength(2);
      // ordered by created_at DESC: most recently created link first
      expect(responseBody.events[0].link_label).toBe("Link 3");
      expect(responseBody.events[1].link_label).toBe("Link 2");
    });
  });
});
