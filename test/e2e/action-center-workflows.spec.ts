import { expect, test, type Page, type Route } from '@playwright/test';
import { BASE_SLUG_PATH, loginAs } from '../../web/e2e/helpers/auth';

const NOW = '2026-07-15T10:00:00.000Z';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installApiFallback(page: Page) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    if (method === 'GET') return json(route, { data: {} });
    return json(route, { data: {}, message: 'ok' });
  });
}

const actionSummary = {
  data: {
    approvals: {
      totalPending: 0,
      highPriority: 0,
      olderThan24h: 0,
      todayApproved: 0,
      rejectedToday: 0,
      totalPendingAmount: 0,
    },
    exceptions: { open: 1, critical: 1, slaBreached: 0 },
    collections: {
      open: 1,
      followupDue: 1,
      exposure: 80,
      exposureMinor: 8_000,
      currencyCode: 'BDT',
      amountsByCurrency: [{ currencyCode: 'BDT', totalDueMinor: 8_000, totalInvoices: 1 }],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
    },
    tasks: { open: 1, overdue: 1, assignedToMe: 1 },
    resolvedToday: 0,
    nextBestAction: {
      workstream: 'exceptions',
      href: '/action/exceptions?status=open',
      label: 'Review critical exception',
      priority: 'critical',
    },
    capabilities: {
      persistentExceptions: true,
      persistentCollections: true,
      persistentTasks: true,
    },
  },
};

async function mockActionSummary(page: Page) {
  await page.route('**/api/action-center/summary**', (route) => json(route, actionSummary));
}

interface ExceptionState {
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved';
  assignedTo: number | null;
  assignedToName: string | null;
  resolutionCode: string | null;
  resolutionNote: string | null;
  updatedAt: string;
  events: Array<Record<string, unknown>>;
}

function exceptionDetail(state: ExceptionState) {
  return {
    id: 42,
    ruleKey: 'cash.stale_handover',
    fingerprint: 'handover:42',
    sourceType: 'cash_handover',
    sourceId: '42',
    module: 'cash',
    severity: 'critical',
    title: 'Stale cash handover',
    description: 'Pending handover is older than 24 hours.',
    sourceHref: null,
    status: state.status,
    assignedTo: state.assignedTo,
    assignedToName: state.assignedToName,
    firstDetectedAt: '2026-07-14T06:00:00.000Z',
    lastDetectedAt: state.updatedAt,
    acknowledgedBy: state.status === 'open' ? null : 1,
    acknowledgedAt: state.status === 'open' ? null : NOW,
    resolvedBy: state.status === 'resolved' ? 1 : null,
    resolvedAt: state.status === 'resolved' ? state.updatedAt : null,
    resolutionCode: state.resolutionCode,
    resolutionNote: state.resolutionNote,
    dismissedBy: null,
    dismissedAt: null,
    dismissalReason: null,
    snoozedUntil: null,
    metadata: {},
    slaAgeHours: 28,
    createdAt: '2026-07-14T06:00:00.000Z',
    updatedAt: state.updatedAt,
  };
}

async function mockExceptionWorkflow(page: Page) {
  const state: ExceptionState = {
    status: 'open',
    assignedTo: null,
    assignedToName: null,
    resolutionCode: null,
    resolutionNote: null,
    updatedAt: NOW,
    events: [{
      id: 1,
      eventType: 'created',
      actorId: 1,
      actorName: 'Admin User',
      oldStatus: null,
      newStatus: 'open',
      note: 'Detected by control rule.',
      metadata: {},
      createdAt: NOW,
    }],
  };

  await page.route('**/api/action-center/exceptions?**', (route) => json(route, {
    data: {
      items: [exceptionDetail(state)],
      summary: {
        total: 1,
        open: state.status === 'open' ? 1 : 0,
        acknowledged: state.status === 'acknowledged' ? 1 : 0,
        in_progress: state.status === 'in_progress' ? 1 : 0,
        snoozed: 0,
        resolved: state.status === 'resolved' ? 1 : 0,
        dismissed: 0,
        critical: 1,
        warning: 0,
        info: 0,
      },
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    },
  }));
  await page.route('**/api/action-center/exceptions/42/events', (route) => json(route, { data: state.events }));
  await page.route('**/api/action-center/exceptions/42', (route) => json(route, { data: exceptionDetail(state) }));
  await page.route(/\/api\/action-center\/exceptions\/42\/(acknowledge|assign|start|resolve)$/, async (route) => {
    const action = route.request().url().split('/').at(-1);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const oldStatus = state.status;
    if (action === 'acknowledge') state.status = 'acknowledged';
    if (action === 'assign') {
      state.assignedTo = Number(body.assignedTo);
      state.assignedToName = 'Admin User';
    }
    if (action === 'start') state.status = 'in_progress';
    if (action === 'resolve') {
      state.status = 'resolved';
      state.resolutionCode = String(body.resolutionCode);
      state.resolutionNote = String(body.note);
    }
    state.updatedAt = new Date(Date.parse(state.updatedAt) + 1_000).toISOString();
    state.events.push({
      id: state.events.length + 1,
      eventType: action,
      actorId: 1,
      actorName: 'Admin User',
      oldStatus,
      newStatus: state.status,
      note: body.note ?? null,
      metadata: {},
      createdAt: state.updatedAt,
    });
    return json(route, { data: exceptionDetail(state) });
  });

  return state;
}

interface CollectionState {
  status: 'new' | 'contacted' | 'promised';
  caseId: number | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  updatedAtUtc: string | null;
  events: Array<Record<string, unknown>>;
}

function collectionItem(state: CollectionState) {
  return {
    sourceKey: 'legacy-bill:101',
    source: { sourceType: 'invoice', legacyBillId: 101 },
    invoiceNumber: 'INV-101',
    patientId: 1,
    patientName: 'Rahim Uddin',
    patientMobile: '01700000001',
    currencyCode: 'BDT',
    totalMinor: 10_000,
    paidMinor: 2_000,
    creditedMinor: 0,
    dueMinor: 8_000,
    issuedAtUtc: '2026-07-14T06:00:00.000Z',
    financialStatus: 'open',
    caseId: state.caseId,
    collectionStatus: state.status,
    assignedTo: 1,
    assignedToName: 'Admin User',
    nextFollowupAtUtc: null,
    promiseDate: state.promiseDate,
    promiseAmountMinor: state.promiseAmountMinor,
    promiseCurrencyCode: state.promiseAmountMinor ? 'BDT' : null,
    latestNote: state.latestNote,
    lastContactedAtUtc: state.lastContactedAtUtc,
    closedAtUtc: null,
    createdAtUtc: NOW,
    updatedAtUtc: state.updatedAtUtc,
    daysOutstanding: 1,
    authorityMode: 'legacy',
    paymentHref: '/billing?collectBillId=101',
    paymentCapability: 'available',
  };
}

async function mockCollectionWorkflow(page: Page) {
  const state: CollectionState = {
    status: 'new',
    caseId: null,
    latestNote: null,
    lastContactedAtUtc: null,
    promiseDate: null,
    promiseAmountMinor: null,
    updatedAtUtc: null,
    events: [],
  };
  const list = () => ({
    data: {
      items: [collectionItem(state)],
      summary: {
        totalDueMinor: 8_000,
        totalInvoices: 1,
        currentMinor: 8_000,
        days30Minor: 0,
        days60Minor: 0,
        days90PlusMinor: 0,
        followupDue: 0,
        promisedAmountMinor: state.promiseAmountMinor ?? 0,
        disputedAmountMinor: 0,
        currencyCode: 'BDT',
        amountsByCurrency: [{
          currencyCode: 'BDT',
          totalDueMinor: 8_000,
          totalInvoices: 1,
          currentMinor: 8_000,
          days30Minor: 0,
          days60Minor: 0,
          days90PlusMinor: 0,
          promisedAmountMinor: state.promiseAmountMinor ?? 0,
          disputedAmountMinor: 0,
        }],
        supportedSourceTypes: ['invoice'],
        authorityMode: 'legacy',
        shadowMismatchCount: 0,
        agingCounts: { '0-7': 1, '8-30': 0, '31-60': 0, '60+': 0 },
      },
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    },
  });

  await page.route('**/api/action-center/collections?**', (route) => json(route, list()));
  await page.route('**/api/action-center/collections/invoice/legacy-bill:101/events', (route) => json(route, { data: state.events }));
  await page.route('**/api/action-center/collections/invoice/legacy-bill:101', (route) => json(route, { data: collectionItem(state) }));
  await page.route(/\/api\/action-center\/collections\/invoice\/legacy-bill:101\/(contact|promise)$/, async (route) => {
    const action = route.request().url().split('/').at(-1);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.caseId = 10;
    state.updatedAtUtc = state.updatedAtUtc
      ? new Date(Date.parse(state.updatedAtUtc) + 1_000).toISOString()
      : NOW;
    if (action === 'contact') {
      state.status = 'contacted';
      state.latestNote = String(body.note);
      state.lastContactedAtUtc = state.updatedAtUtc;
    } else {
      state.status = 'promised';
      state.promiseDate = String(body.promiseDate);
      state.promiseAmountMinor = Number(body.promiseAmountMinor);
      state.latestNote = String(body.note);
    }
    state.events.push({
      id: state.events.length + 1,
      eventType: action === 'contact' ? 'contacted' : 'promise_recorded',
      actorId: 1,
      actorName: 'Admin User',
      oldStatus: action === 'contact' ? 'new' : 'contacted',
      newStatus: state.status,
      note: state.latestNote,
      metadata: body,
      createdAtUtc: state.updatedAtUtc,
    });
    return json(route, { data: collectionItem(state) });
  });
  return state;
}

interface TaskState {
  status: 'open' | 'completed';
  assignedTo: number | null;
  assignedToName: string | null;
  completedBy: number | null;
  completedByName: string | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  updatedAtUtc: string;
  events: Array<Record<string, unknown>>;
}

function taskDetail(state: TaskState) {
  return {
    id: 42,
    title: 'Investigate discount exception',
    description: 'Review the high discount before end of shift.',
    sourceType: 'exception',
    sourcePublicId: 'exception-case:42',
    sourceHref: null,
    sourceMetadata: { exceptionCaseId: 42 },
    priority: 'critical',
    status: state.status,
    assignedTo: state.assignedTo,
    assignedToName: state.assignedToName,
    dueAtUtc: '2099-07-20T10:00:00.000Z',
    completedBy: state.completedBy,
    completedByName: state.completedByName,
    completedAtUtc: state.completedAtUtc,
    completionNote: state.completionNote,
    createdBy: 1,
    createdByName: 'Admin User',
    createdAtUtc: NOW,
    updatedAtUtc: state.updatedAtUtc,
    isOverdue: false,
    sourceStatusSummary: { status: 'open', severity: 'critical' },
  };
}

async function mockTaskWorkflow(page: Page) {
  const state: TaskState = {
    status: 'open',
    assignedTo: null,
    assignedToName: null,
    completedBy: null,
    completedByName: null,
    completedAtUtc: null,
    completionNote: null,
    updatedAtUtc: NOW,
    events: [{
      id: 1,
      eventType: 'created',
      actorId: 1,
      actorName: 'Admin User',
      oldStatus: null,
      newStatus: 'open',
      note: 'Created from exception.',
      metadata: {},
      createdAtUtc: NOW,
    }],
  };
  await page.route('**/api/action-center/tasks?**', (route) => json(route, {
    data: {
      items: [taskDetail(state)],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    },
  }));
  await page.route('**/api/action-center/tasks/42/events', (route) => json(route, { data: state.events }));
  await page.route('**/api/action-center/tasks/42', (route) => json(route, { data: taskDetail(state) }));
  await page.route('**/api/staff', (route) => json(route, {
    staff: [{ id: 1, name: 'Admin User' }, { id: 8, name: 'Task Owner' }],
  }));
  await page.route(/\/api\/action-center\/tasks\/42\/(assign|complete)$/, async (route) => {
    const action = route.request().url().split('/').at(-1);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const oldStatus = state.status;
    state.updatedAtUtc = new Date(Date.parse(state.updatedAtUtc) + 1_000).toISOString();
    if (action === 'assign') {
      state.assignedTo = Number(body.assignedTo);
      state.assignedToName = state.assignedTo === 8 ? 'Task Owner' : 'Admin User';
    } else {
      state.status = 'completed';
      state.completedBy = 1;
      state.completedByName = 'Admin User';
      state.completedAtUtc = state.updatedAtUtc;
      state.completionNote = String(body.note);
    }
    state.events.push({
      id: state.events.length + 1,
      eventType: action === 'assign' ? 'assigned' : 'completed',
      actorId: 1,
      actorName: 'Admin User',
      oldStatus,
      newStatus: state.status,
      note: body.note ?? null,
      metadata: {},
      createdAtUtc: state.updatedAtUtc,
    });
    return json(route, { data: taskDetail(state) });
  });
  return state;
}

interface ReviewState {
  isApproved: -1 | 0 | 1;
  reasonCode: string | null;
  note: string | null;
  events: Array<Record<string, unknown>>;
}

function reviewItem(state: ReviewState) {
  return {
    id: 42,
    reviewer_name: 'Patient A',
    target_type: 'hospital',
    doctor_name: null,
    rating: 2,
    review_text: 'The waiting time was too long and my phone number was included: 01700000000.',
    is_approved: state.isApproved,
    created_at: '2026-07-15 10:00:00',
    provider_reply: null,
    provider_reply_at_utc: null,
    moderation_reason_code: state.reasonCode,
    moderation_note: state.note,
    moderated_at_utc: state.isApproved === 0 ? null : NOW,
  };
}

async function mockReviewWorkflow(page: Page) {
  const state: ReviewState = { isApproved: 0, reasonCode: null, note: null, events: [] };
  await page.route('**/api/v1/marketplace/reviews/all?**', (route) => json(route, {
    data: [reviewItem(state)],
    pagination: { page: 1, limit: 20, total: 1 },
  }));
  await page.route('**/api/v1/marketplace/reviews/42/moderation-events', (route) => json(route, { data: state.events }));
  await page.route('**/api/v1/marketplace/reviews/42/reject', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.isApproved = -1;
    state.reasonCode = String(body.reasonCode);
    state.note = body.note ? String(body.note) : null;
    state.events.push({
      id: 1,
      reviewId: 42,
      eventType: 'rejected',
      actorId: 1,
      actorName: 'Admin User',
      reasonCode: state.reasonCode,
      note: state.note,
      oldState: 0,
      newState: -1,
      metadata: {},
      createdAtUtc: NOW,
    });
    return json(route, { message: 'Review rejected' });
  });
  return state;
}

async function preparePage(page: Page) {
  await installApiFallback(page);
  await mockActionSummary(page);
}

async function spaNavigate(page: Page, targetPath: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  await page.waitForURL((url) => `${url.pathname}${url.search}` === targetPath);
}

test.describe('Unified Action Center browser workflows', () => {
  test('admin opens the canonical Action Center and legacy aliases redirect with query intent', async ({ page }) => {
    await preparePage(page);
    await mockExceptionWorkflow(page);
    await mockCollectionWorkflow(page);
    await mockTaskWorkflow(page);
    await mockReviewWorkflow(page);

    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/action`);
    await expect(page.getByRole('heading', { name: 'Action Center' })).toBeVisible();

    await spaNavigate(page, `${BASE_SLUG_PATH}/alerts?severity=critical`);
    await expect(page).toHaveURL(/\/action\/exceptions\?severity=critical$/);

    await spaNavigate(page, `${BASE_SLUG_PATH}/cash/followups?search=INV-101`);
    await expect(page).toHaveURL(/\/action\/collections\?followup=due&search=INV-101$/);

    await spaNavigate(page, `${BASE_SLUG_PATH}/tasks?view=overdue`);
    await expect(page).toHaveURL(/\/action\/tasks\?view=overdue$/);

    await spaNavigate(page, `${BASE_SLUG_PATH}/review-moderation?status=pending`);
    await expect(page).toHaveURL(/\/patient-experience\/reviews\?status=pending$/);
  });

  test('admin acknowledges, assigns, starts, and resolves an exception with evidence', async ({ page }) => {
    await preparePage(page);
    const state = await mockExceptionWorkflow(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/action/exceptions`);

    await page.getByRole('button', { name: 'Stale cash handover' }).click();
    await expect(page.getByRole('dialog', { name: 'Stale cash handover' })).toBeVisible();

    await page.getByRole('button', { name: /acknowledge/i }).click();
    await page.getByRole('button', { name: /assign to me/i }).click();
    await page.getByRole('button', { name: /start investigation/i }).click();
    await expect(page.getByRole('dialog', { name: 'Stale cash handover' })).toContainText('In progress');

    await page.getByLabel(/resolution code/i).fill('verified');
    await page.getByLabel(/resolution note/i).fill('Cash verified against the handover register.');
    await expect(page.getByRole('button', { name: /resolve case/i })).toBeEnabled();
    await page.getByRole('button', { name: /resolve case/i }).click();

    await expect.poll(() => state.status).toBe('resolved');
    expect(state.assignedTo).toBe(1);
    expect(state.resolutionCode).toBe('verified');
    expect(state.resolutionNote).toBe('Cash verified against the handover register.');
  });

  test('collector records contact evidence and a promise to pay', async ({ page }) => {
    await preparePage(page);
    const state = await mockCollectionWorkflow(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/action/collections`);

    await page.getByRole('button', { name: 'Open INV-101' }).first().click();
    const collectionDialog = page.getByRole('dialog', { name: /INV-101/ });
    await expect(collectionDialog).toBeVisible();

    await page.getByLabel(/contact channel/i).selectOption('phone');
    await page.getByLabel(/^outcome$/i).fill('Patient answered');
    await page.getByLabel(/contact note/i).fill('Explained the outstanding balance.');
    await page.getByRole('button', { name: /record contact/i }).click();
    await expect.poll(() => state.status).toBe('contacted');
    await expect(collectionDialog).toContainText('Contact recorded');

    await page.getByLabel(/promise date/i).fill('2099-07-25');
    await page.getByLabel(/promise amount/i).fill('50.25');
    await page.getByLabel(/promise note/i).fill('Patient committed to partial payment.');
    await page.getByRole('button', { name: /record promise/i }).click();

    await expect.poll(() => state.status).toBe('promised');
    expect(state.promiseDate).toBe('2099-07-25');
    expect(state.promiseAmountMinor).toBe(5_025);
  });

  test('collector requests write-off and a separate approver approves it', async () => {
    test.skip(
      true,
      'Blocked by the explicitly gated Phase 4 receivable_write_off approval implementation; Task 8 must not simulate financial authority.',
    );
  });

  test('admin assigns and completes a source-linked task with a required completion note', async ({ page }) => {
    await preparePage(page);
    const state = await mockTaskWorkflow(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/action/tasks`);

    await page.getByRole('button', { name: 'Investigate discount exception' }).click();
    await expect(page.getByRole('heading', { name: 'Investigate discount exception' })).toBeVisible();

    await page.getByRole('button', { name: /^assign$/i }).click();
    const assignDialog = page.getByRole('dialog', { name: /assign task/i });
    await assignDialog.getByRole('combobox', { name: /assignee/i }).selectOption('8');
    await assignDialog.getByRole('textbox', { name: /note \(optional\)/i }).fill('Hand over to task owner.');
    await assignDialog.getByRole('button', { name: /save assignment/i }).click();
    await expect.poll(() => state.assignedTo).toBe(8);

    await page.getByRole('button', { name: /^complete$/i }).click();
    const completeDialog = page.getByRole('dialog', { name: /complete task/i });
    await completeDialog.getByRole('textbox', { name: /note \(required\)/i }).fill('Verified and completed with source evidence.');
    await completeDialog.getByRole('button', { name: /complete task/i }).click();

    await expect.poll(() => state.status).toBe('completed');
    expect(state.completionNote).toBe('Verified and completed with source evidence.');
  });

  test('moderator rejects a review with a structured reason and optional note', async ({ page }) => {
    await preparePage(page);
    const state = await mockReviewWorkflow(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/patient-experience/reviews`);

    await page.getByRole('button', { name: /The waiting time was too long/ }).click();
    await expect(page.getByRole('dialog', { name: /review details/i })).toBeVisible();
    await page.getByRole('button', { name: /^reject$/i }).click();
    await page.getByLabel(/rejection reason/i).selectOption('personal_information');
    await page.getByLabel(/moderation note/i).fill('Contains a patient phone number.');
    await page.getByRole('button', { name: /reject review/i }).click();

    await expect.poll(() => state.isApproved).toBe(-1);
    expect(state.reasonCode).toBe('personal_information');
    expect(state.note).toBe('Contains a patient phone number.');
  });

  test('Action Center stays responsive and keyboard operable across supported widths', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preparePage(page);
    await mockTaskWorkflow(page);
    await loginAs(page, 'hospital_admin', `${BASE_SLUG_PATH}/action/tasks`);

    for (const viewport of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole('button', { name: 'Investigate discount exception' })).toBeVisible();
      expect(await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return Math.max(0, root.scrollWidth - window.innerWidth);
      })).toBeLessThanOrEqual(1);

      const viewButtonBox = await page.getByRole('button', { name: /my tasks/i }).boundingBox();
      expect(viewButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    const taskButton = page.getByRole('button', { name: 'Investigate discount exception' });
    await taskButton.focus();
    await expect(taskButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Investigate discount exception' })).toBeVisible();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
    const assignButton = page.getByRole('button', { name: /^assign$/i });
    const assignButtonBox = await assignButton.boundingBox();
    expect(assignButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await assignButton.focus();
    await page.keyboard.press('Enter');
    const assignDialog = page.getByRole('dialog', { name: /assign task/i });
    await expect(assignDialog).toBeVisible();
    await expect(assignDialog.getByRole('combobox', { name: /assignee/i })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(assignDialog).toBeHidden();
    await expect(assignButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Investigate discount exception' })).toBeHidden();
    await expect(taskButton).toBeFocused();
  });

  test('browser Back restores Action Center URL-backed filters', async ({ page }) => {
    await preparePage(page);
    await mockTaskWorkflow(page);
    await mockExceptionWorkflow(page);
    const filtered = `${BASE_SLUG_PATH}/action/tasks?view=overdue&priority=critical&sourceType=exception&search=discount`;
    await loginAs(page, 'hospital_admin', filtered);

    await expect(page.getByRole('button', { name: /overdue/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: /^priority$/i })).toHaveValue('critical');
    await expect(page.getByRole('combobox', { name: /^source$/i })).toHaveValue('exception');
    await expect(page.getByRole('searchbox', { name: /^search$/i })).toHaveValue('discount');

    await spaNavigate(page, `${BASE_SLUG_PATH}/action/exceptions`);
    await page.goBack();

    await expect(page).toHaveURL(filtered);
    await expect(page.getByRole('button', { name: /overdue/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: /^priority$/i })).toHaveValue('critical');
    await expect(page.getByRole('combobox', { name: /^source$/i })).toHaveValue('exception');
    await expect(page.getByRole('searchbox', { name: /^search$/i })).toHaveValue('discount');
  });
});
