/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface Service {
  id: number;
  name: string;
  name_bn?: string;
  description?: string;
  icon?: string;
  category?: string;
}

interface ServiceCardProps {
  service: Service;
}

export const ServiceCard: FC<ServiceCardProps> = ({ service }) => (
  <div class="card">
    <div class="card-body" style="text-align:center">
      <div style="font-size:2.5rem;margin-bottom:0.75rem">{service.icon || '🏥'}</div>
      <h3 style="font-size:1.05rem;font-weight:600;margin-bottom:0.25rem">{service.name}</h3>
      {service.name_bn && (
        <p style="font-size:0.85rem;opacity:0.5;margin-bottom:0.5rem">{service.name_bn}</p>
      )}
      {service.description && (
        <p style="font-size:0.9rem;opacity:0.7;line-height:1.5">{service.description}</p>
      )}
      {service.category && (
        <span class="badge" style="margin-top:0.75rem">{service.category}</span>
      )}
    </div>
  </div>
);

interface ServiceListProps {
  services: Service[];
}

export const ServiceList: FC<ServiceListProps> = ({ services }) => (
  <div class="grid grid-3">
    {services.map((svc) => (
      <ServiceCard service={svc} />
    ))}
  </div>
);
