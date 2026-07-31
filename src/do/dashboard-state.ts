import { DurableObject } from 'cloudflare:workers';

export interface DashboardState {
  todayIncome: number;
  todayExpense: number;
  mtdIncome: number;
  mtdExpense: number;
  lastUpdated: string;
}

export interface WSMessage {
  type: 'init' | 'income_update' | 'expense_update' | 'sync';
  data: DashboardState;
}

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  UPLOADS: R2Bucket;
  DASHBOARD_DO: DurableObjectNamespace;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  ALLOWED_ORIGINS: string;
}

// DashboardDO — Durable Object for real-time dashboard state
// Uses extends (not implements) as required by the Cloudflare Workers runtime
export class DashboardDO extends DurableObject<Env> {
  private connections: Set<WebSocket> = new Set();
  private dashboardState: DashboardState = {
    todayIncome: 0,
    todayExpense: 0,
    mtdIncome: 0,
    mtdExpense: 0,
    lastUpdated: new Date().toISOString(),
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }

    if (request.method === 'GET') {
      return Response.json(this.dashboardState);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    // Use the Hibernation API pattern for Cloudflare Workers
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.connections.add(client);
    this.sendInit(client);

    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string);
        await this.handleMessage(message);
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    });

    server.addEventListener('close', () => {
      this.connections.delete(client);
    });

    server.addEventListener('error', (event: Event) => {
      console.error('WebSocket error:', event);
      this.connections.delete(client);
    });

    return new Response(null, { webSocket: client, status: 101 });
  }

  private sendInit(client: WebSocket): void {
    const message: WSMessage = {
      type: 'init',
      data: { ...this.dashboardState },
    };
    client.send(JSON.stringify(message));
  }

  private async handleMessage(message: { type: string }): Promise<void> {
    if (message.type === 'sync') {
      await this.syncFromStorage();
      this.broadcast({ type: 'sync', data: { ...this.dashboardState } });
    }
  }

  async updateIncome(amount: number, isToday: boolean, isMTD: boolean): Promise<void> {
    if (isToday) this.dashboardState.todayIncome += amount;
    if (isMTD) this.dashboardState.mtdIncome += amount;
    this.dashboardState.lastUpdated = new Date().toISOString();
    await this.persistState();
    this.broadcast({ type: 'income_update', data: { ...this.dashboardState } });
  }

  async updateExpense(amount: number, isToday: boolean, isMTD: boolean): Promise<void> {
    if (isToday) this.dashboardState.todayExpense += amount;
    if (isMTD) this.dashboardState.mtdExpense += amount;
    this.dashboardState.lastUpdated = new Date().toISOString();
    await this.persistState();
    this.broadcast({ type: 'expense_update', data: { ...this.dashboardState } });
  }

  async syncFromStorage(): Promise<void> {
    const stored = await this.ctx.storage.get<DashboardState>('dashboardState');
    if (stored) this.dashboardState = stored;
  }

  async loadFromD1(db: D1Database, tenantId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    try {
      const incomeResult = await db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN date = ? THEN amount ELSE 0 END), 0) as today_income,
            COALESCE(SUM(CASE WHEN date >= ? THEN amount ELSE 0 END), 0) as mtd_income
           FROM income WHERE tenant_id = ?`,
        )
        .bind(today, monthStart, tenantId)
        .first<{ today_income: number; mtd_income: number }>();

      const expenseResult = await db
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN date = ? THEN amount ELSE 0 END), 0) as today_expense,
            COALESCE(SUM(CASE WHEN date >= ? THEN amount ELSE 0 END), 0) as mtd_expense
           FROM expenses WHERE tenant_id = ? AND status = 'approved'`,
        )
        .bind(today, monthStart, tenantId)
        .first<{ today_expense: number; mtd_expense: number }>();

      this.dashboardState = {
        todayIncome: incomeResult?.today_income || 0,
        todayExpense: expenseResult?.today_expense || 0,
        mtdIncome: incomeResult?.mtd_income || 0,
        mtdExpense: expenseResult?.mtd_expense || 0,
        lastUpdated: new Date().toISOString(),
      };

      await this.persistState();
    } catch (error) {
      console.error('Error loading from D1:', error);
    }
  }

  async persistState(): Promise<void> {
    await this.ctx.storage.put('dashboardState', this.dashboardState);
  }

  private broadcast(message: WSMessage): void {
    const payload = JSON.stringify(message);
    this.connections.forEach((client) => {
      try {
        client.send(payload);
      } catch (e) {
        console.error('Broadcast error:', e);
        this.connections.delete(client);
      }
    });
  }

  getState(): DashboardState {
    return { ...this.dashboardState };
  }
}
