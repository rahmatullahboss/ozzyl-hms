import { type ReactNode, useEffect, useRef, useState } from 'react';
import { shouldRenderMeasuredChart } from '../../lib/chartSizing';

interface SafeChartFrameProps {
  className?: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export default function SafeChartFrame({ className = '', children, fallback = null }: SafeChartFrameProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setReady(shouldRenderMeasuredChart(rect.width, rect.height));
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={className}>
      {ready ? children : fallback}
    </div>
  );
}
