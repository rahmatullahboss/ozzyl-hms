import { Hono } from 'hono';
import type { Env, Variables } from '../../../types';
import { assessmentRoutes } from './assessments';
import { problemListRoutes } from './problem-list';
import { historyRoutes } from './history';
import { diagnosisRoutes } from './diagnosis';
import { dietRoutes } from './diet';
import { glucoseRoutes } from './glucose';
import { carePlanRoutes } from './care-plans';
import { clinicalFormsRoutes } from './forms';
import { sdohRoutes } from './sdoh';
import { rosRoutes } from './ros';
import { eyeExamRoutes } from './eye-exam';
import { vitalsRoutes } from './vitals';
import { allergyRoutes } from './allergies';
import { medicationRoutes } from './medications';
import { noteRoutes } from './notes';
import { imageRoutes } from './images';
import { encounterRoutes } from './encounters';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

const clinicalRoutes = new Hono<ClinicalEnv>();

// Mount sub-routes
clinicalRoutes.route('/assessments', assessmentRoutes);
clinicalRoutes.route('/problems', problemListRoutes);
clinicalRoutes.route('/history', historyRoutes);
clinicalRoutes.route('/diagnosis', diagnosisRoutes);
clinicalRoutes.route('/diet', dietRoutes);
clinicalRoutes.route('/glucose', glucoseRoutes);
clinicalRoutes.route('/care-plans', carePlanRoutes);
clinicalRoutes.route('/forms', clinicalFormsRoutes);
clinicalRoutes.route('/sdoh', sdohRoutes);
clinicalRoutes.route('/ros', rosRoutes);
clinicalRoutes.route('/eye-exam', eyeExamRoutes);
clinicalRoutes.route('/vitals', vitalsRoutes);
clinicalRoutes.route('/allergies', allergyRoutes);
clinicalRoutes.route('/medications', medicationRoutes);
clinicalRoutes.route('/notes', noteRoutes);
clinicalRoutes.route('/images', imageRoutes);
clinicalRoutes.route('/encounters', encounterRoutes);

export default clinicalRoutes;
