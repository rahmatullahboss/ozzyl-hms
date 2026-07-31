interface LoadingSkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export default function LoadingSkeleton({ 
  className = '', 
  variant = 'rectangular',
  width = '100%',
  height = '1rem'
}: LoadingSkeletonProps) {
  const baseClasses = 'animate-pulse bg-[var(--color-border)]';
  
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <LoadingSkeleton width={60} height={20} />
          <LoadingSkeleton width={150} height={20} />
          <LoadingSkeleton width={120} height={20} />
          <LoadingSkeleton width={100} height={20} />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card p-6 space-y-4">
      <div className="flex justify-between">
        <LoadingSkeleton width={100} height={16} />
        <LoadingSkeleton variant="circular" width={40} height={40} />
      </div>
      <LoadingSkeleton width={80} height={32} />
      <LoadingSkeleton width={60} height={16} />
    </div>
  );
}

export function KPICardSkeleton() {
  return (
    <div className="card p-6 space-y-4">
      <div className="flex justify-between">
        <LoadingSkeleton width={80} height={16} />
        <LoadingSkeleton variant="circular" width={48} height={48} />
      </div>
      <LoadingSkeleton width={100} height={40} />
      <LoadingSkeleton width={60} height={16} />
    </div>
  );
}
