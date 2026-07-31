import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <Compass className="w-12 h-12 text-slate-300 mb-3" />
      <h1 className="text-4xl font-bold text-slate-900">404</h1>
      <h2 className="text-lg font-semibold text-slate-800 mt-2">Page not found</h2>
      <p className="text-sm text-slate-500 mt-1">
        The page you were looking for does not exist or has been moved.
      </p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
