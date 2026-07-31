import { Hono } from 'hono';
import type { Env, Variables } from '../../../types';
import catalog from './catalog';
import orders from './orders';
import reports from './reports';
import pacs from './pacs';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Master data & catalog (imaging types, items, templates, film types, stats)
app.route('/', catalog);

// Requisitions / orders
app.route('/requisitions', orders);

// Reports
app.route('/reports', reports);

// PACS / DICOM studies
app.route('/pacs', pacs);

export default app;
